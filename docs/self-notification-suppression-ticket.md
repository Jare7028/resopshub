# Ticket: Global Self-Notification Suppression

## Summary
Stop generating notifications when the action actor and notification recipient are the same user.

Rule: if `actor_user_id = user_id`, do not create a notification.

## Problem
Users currently receive notifications for actions they just performed (for example: completing a task, creating a post/page, or assigning a task to themselves). These are redundant and create noise.

## Scope
- Applies globally across:
  - all workspaces/projects
  - all action types
  - all notification channels backed by `public.notifications`
- Keep notifications for other users unchanged.
- No exceptions.

## Out of Scope
- New user-configurable setting (this is a system rule, not a preference toggle).
- Notifications with no actor (`actor_user_id is null`) such as system/cron reminders.

## Implementation Plan
1. Add a DB-level guard trigger on `public.notifications` to enforce the rule centrally.
2. Keep/align existing path-level safeguards where they already exist.
3. Add regression tests for both positive and negative cases.
4. Optionally clean up existing historical self-notifications.

## Technical Changes

### 1) DB safety net (required)
Create migration (`sql/20260302100000_notifications_suppress_self.sql`) to add:

- Function:
  - `public.suppress_self_notifications()`
  - `before insert` behavior:
    - if `new.actor_user_id is not null and new.actor_user_id = new.user_id` then `return null;`
    - else `return new;`

- Trigger:
  - `notifications_suppress_self_insert`
  - `before insert on public.notifications`
  - `for each row execute function public.suppress_self_notifications()`

Rationale: this enforces the rule for all current and future notification producers, including SQL triggers, API paths, and scripts.

### 2) Existing producer paths to verify
- Task trigger function:
  - `sql/notifications_preferences_patch.sql`
  - `public.handle_task_notifications()`
- Mention notifications:
  - `lib/mentionNotifications.ts`
  - already removes self recipient via `mentionMap.delete(input.actorAuthUserId)`, keep as defense in depth.
- Feature suggestion notification triggers:
  - `sql/notifications_preferences_patch.sql`
  - already guard when actor equals recipient; keep as-is.

### 3) Optional one-time cleanup
If product wants old noise removed:

```sql
delete from public.notifications
where actor_user_id is not null
  and actor_user_id = user_id;
```

## Acceptance Criteria
1. When a user updates their own task status, no notification is created for that same user.
2. When a user creates a task and assigns it to themselves, no "task assigned" notification is created for them.
3. When a user creates/edits their own content (for example social page/post/comment), no self-notification is created.
4. When a user action affects other users, those other users still receive notifications as before.
5. Notifications with `actor_user_id is null` (system-generated) still behave unchanged.
6. Rule is global and automatic; no workspace override and no per-action exceptions.
7. Attempting to insert a self-notification directly into `public.notifications` is suppressed by DB trigger.

## QA Test Cases

### TC1: Self task update suppression
1. User A opens a task assigned to User A.
2. User A changes status to `completed`.
3. Verify no new row in `public.notifications` for User A tied to that action.
4. Verify notification bell count does not increase for User A.

### TC2: Self-assignment suppression
1. User A creates a task assigned to User A.
2. Verify no `task_assigned` notification for User A.

### TC3: Cross-user still works
1. User A assigns a task to User B.
2. Verify User B receives `task_assigned`.
3. Verify User A does not receive a notification for that action unless explicitly targeted by another rule.

### TC4: Mention self suppression
1. User A writes content with `@UserA`.
2. Verify no `user_mentioned` notification for User A.

### TC5: Mention other user still works
1. User A writes content with `@UserB`.
2. Verify User B receives `user_mentioned`.

### TC6: System notification unaffected
1. Run due/overdue reminder flow where `actor_user_id` is null.
2. Verify reminder rows are still inserted and shown to recipient.

### TC7: DB guard regression
1. Attempt direct insert into `public.notifications` with `actor_user_id = user_id`.
2. Verify row is not inserted.
3. Attempt insert with different actor and recipient.
4. Verify row is inserted.

## Rollout Checklist
1. Apply SQL migration in staging.
2. Execute QA test cases TC1-TC7 in staging.
3. Apply SQL migration in production.
4. (Optional) Run one-time cleanup query in production.
5. Monitor notification row volume and support feedback for 48 hours.

## Risks
- If any legitimate flow relies on self-notifications, it will stop after rollout.
- DB trigger suppression is silent by design; rely on QA and monitoring for validation.

## Definition of Done
- Migration merged and applied.
- All acceptance criteria met.
- QA evidence attached for TC1-TC7.
- No increase in notification-related errors after release.
