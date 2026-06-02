# Security-Definer and RLS Inventory - 2026-06-02

## Scope

This is a migration-backed inventory for audit finding F-010. It is not a full
Codex Security scan and does not prove every function is safe. It records the
current security-definer, row-level-security, policy, grant, and caller surface
visible from the repository.

## Scan Results

Commands:

- `rg -n "^\\s*security\\s+definer\\b" supabase/migrations -g"*.sql"`
- `rg -n "enable row level security" supabase/migrations -g"*.sql"`
- `rg -n "create policy" supabase/migrations -g"*.sql"`
- `rg -n "\\.rpc\\(" app lib -g"*.ts" -g"*.tsx"`

Counts:

- 128 actual `security definer` declarations in migrations.
- 52 `enable row level security` migration occurrences.
- 225 `create policy` migration occurrences.
- 0 security-definer declarations missing a nearby `set search_path` in the migration scan.

Important caveat:

- Function owners are not explicit in the migrations. Live ownership and final
  execute grants must be verified from the database catalog before closing F-010.

## Highest-Risk Review Queue

| Priority | Surface | Evidence | Why It Matters | Next Verification |
| --- | --- | --- | --- | --- |
| P1 | Schedules core RPCs | `20260225140000_schedules_module.sql`: 25 security-definer functions, 8 RLS enables, 32 policies | Broad shift, roster, publish, claim, copy, template, notification, and audit operations; many grants include `anon, authenticated`. | SQL tests for view/edit/publish/claim/template denied and allowed states across at least two clients. |
| P1 | Quizzes and quiz attempt/authoring RPCs | `20260227170000_quizzes_module.sql`: 24 functions, 13 RLS enables, 52 policies; plus 5 attempt RPCs and 4 authoring RPCs | Quiz authoring, assignment, attempt, scoring, review, audit, and score-event functions can affect training/compliance records. | SQL tests for learner, reviewer, manager, unrelated user, and anonymous access. |
| P1 | Schedule time off | `20260302170000_schedule_time_off_suite.sql`: 17 functions, 5 RLS enables, 20 policies | Entitlement, carryover, allocation, request, decision, and balance logic is business-critical and permission-sensitive. | SQL tests for requester, manager, non-manager, inactive code, and cross-client access. |
| P2 | Social workspace | `20260221130500_social_workspace.sql`: 5 functions, 5 RLS enables, 24 policies; later fallback migration redefines 2 access helpers | Social page/post/comment membership helpers gate many page and API mutations. | Verify owner/member/non-member access for pages, posts, comments, images, reads, and reactions. |
| P2 | Task/subtask and audit RPCs | `20260221223000_tasks_subtask_parent_access_rls_patch.sql`, `20260221224500_subtask_rpc_security_definer_fix.sql`, `20260302123000_task_audit_log.sql` | Task creation, assignees, parent access, and audit trails touch the customer's core workflow. | SQL tests for assignee, watcher, unrelated user, disabled profile, and parent/subtask access. |
| P2 | Inventory and employee info permission helpers | `20260223120000_inventory_tables.sql`, `20260225120000_add_inventory_page_permission.sql`, employee-info RPC call sites | Dynamic columns and records are permission-gated by helper functions and page permission checks. | Verify read/manage-column separation and export route access. |
| P2 | Scout | `20260413222000_scout_module.sql`: 2 functions, 2 RLS enables, 7 policies | Role scout jobs and runs may contain sensitive generated or customer-specific operational data. | Verify access/manage split and status history visibility. |

## Module Counts

| Migration | Security Definer | RLS Enables | Policies |
| --- | ---: | ---: | ---: |
| `20260225140000_schedules_module.sql` | 25 | 8 | 32 |
| `20260227170000_quizzes_module.sql` | 24 | 13 | 52 |
| `20260302170000_schedule_time_off_suite.sql` | 17 | 5 | 20 |
| `20260301113000_quizzes_remove_client_scope.sql` | 9 | 0 | 0 |
| `20260221130500_social_workspace.sql` | 5 | 5 | 24 |
| `20260226183000_schedule_client_billable_settings.sql` | 5 | 3 | 12 |
| `20260227171000_quiz_attempt_rpcs.sql` | 5 | 0 | 0 |
| `20260227172000_quiz_authoring_rpcs.sql` | 4 | 0 | 0 |
| `20260223120000_inventory_tables.sql` | 2 | 3 | 12 |
| `20260413222000_scout_module.sql` | 2 | 2 | 7 |
| `20260302123000_task_audit_log.sql` | 2 | 1 | 4 |
| `20260221143000_social_owner_email_fallback_and_insert_relax.sql` | 2 | 0 | 3 |
| `20260225152000_schedule_overnight_shift_auto_split.sql` | 2 | 0 | 0 |
| `20260225141000_schedule_job_codes_manage_functions.sql` | 2 | 0 | 0 |
| `20260221224500_subtask_rpc_security_definer_fix.sql` | 2 | 0 | 0 |
| `20260220213000_performance_nav_unread_paths.sql` | 2 | 0 | 0 |
| `20260225120000_add_inventory_page_permission.sql` | 2 | 0 | 0 |
| `20260301150000_assignment_groups.sql` | 1 | 2 | 8 |
| `20260221162000_social_comment_threads_and_post_views.sql` | 1 | 1 | 4 |
| `20260220113001_personal_page_share_links.sql` | 1 | 1 | 4 |
| `20260301193000_notification_preferences_mentions_schedule.sql` | 1 | 1 | 3 |
| Other one-off security-definer migrations | 13 | 0 | mixed |
| RLS/policy-only migrations | 0 | 5 | 29 |

## Security-Definer Function Groups

### Schedules

Core schedule functions include `schedule_can_view_client`,
`schedule_can_edit_client`, `schedule_can_publish_client`,
`schedule_can_unpublish_client`, `schedule_can_manage_templates_client`,
`schedule_can_claim_open_shift_client`, `schedule_can_manage_job_codes`,
`schedule_can_view_audit_client`, `schedule_week_is_visible`,
`schedule_log_audit_event`, `schedule_notify_users`,
`schedule_before_shift_write`, `schedule_sync_roster_for_client`,
`schedule_get_or_create_week`, `schedule_add_roster_user`,
`schedule_remove_roster_user`, `schedule_notify_week_team`,
`schedule_upsert_shift`, `schedule_delete_shift`,
`schedule_claim_open_shift`, `schedule_publish_week`,
`schedule_unpublish_week`, `schedule_copy_previous_week`,
`schedule_create_template_from_week`, and `schedule_apply_template_to_week`.

Additional schedule functions include job-code management, overnight shift
split fixes, roster sync fixes, billable settings, notification preference
support, and time-off functions.

### Quizzes

Quiz helper and permission functions include `quiz_current_user_matches`,
`quiz_client_id_for_quiz`, `quiz_client_id_for_version`,
`quiz_client_id_for_assignment`, `quiz_client_id_for_attempt`,
`quiz_client_id_for_attempt_answer`, `quiz_can_view_client`,
`quiz_can_manage_client`, `quiz_can_assign_client`,
`quiz_can_review_client`, `quiz_can_view_reports_client`,
`quiz_can_regrade_client`, `quiz_can_view_quiz`, `quiz_can_manage_quiz`,
`quiz_can_view_version`, `quiz_can_manage_version`,
`quiz_can_assign_version`, `quiz_can_take_version`,
`quiz_can_access_assignment`, `quiz_can_view_attempt`,
`quiz_can_manage_attempt`, `quiz_can_review_attempt_answer`,
`quiz_log_audit_event`, and `quiz_log_score_event`.

Attempt and authoring RPCs include `quiz_start_attempt`,
`quiz_save_attempt_answer`, `quiz_submit_attempt`,
`quiz_review_attempt_answer`, `quiz_finalize_attempt_scoring`,
`quiz_create_definition_with_version`, `quiz_add_version_question`,
`quiz_publish_version`, and `quiz_assign_version_to_user`.

### Social, Personal, Inventory, Tasks, and Scout

Social functions include `can_access_social_page`,
`can_manage_social_page`, `can_access_social_post`,
`can_manage_social_post`, `can_manage_social_comment`, and
`social_comment_parent_guard`.

Personal/share functions include `resolve_personal_page_share_link`.

Inventory functions include `can_access_inventory` and
`can_manage_inventory_columns`.

Task functions include `can_create_subtask_under`,
`create_subtask_with_assignees`, `task_log_audit_event`, and
`task_capture_audit_event`.

Scout functions include `can_access_scout` and `can_manage_scout`.

## Current App Callers

High-traffic app callers from `.rpc(...)` scan include:

- Tasks: `task_list_page`, `update_task_inline`, `replace_task_assignees`, `task_log_audit_event`.
- Schedules: `schedule_can_edit_client`, `schedule_upsert_shift`, `schedule_publish_week`, `schedule_unpublish_week`, `schedule_claim_open_shift`, `schedule_copy_previous_week`, `schedule_time_off_*`.
- Quizzes: `quiz_create_definition_with_version`, `quiz_add_version_question`, `quiz_publish_version`, `quiz_assign_version_to_user`, `quiz_start_attempt`, `quiz_save_attempt_answer`, `quiz_submit_attempt`, `quiz_review_attempt_answer`, `quiz_finalize_attempt_scoring`.
- Social: `can_access_social_page`, `can_manage_social_page`, `can_manage_social_post`, `can_manage_social_comment`, `social_page_summaries_for_user`.
- Inventory and employee info: `can_access_inventory`, `can_manage_inventory_columns`, `inventory_records_page`, `can_access_employee_info`, `can_manage_employee_info_columns`, `employee_info_records_page`.
- Client pages: `client_page_access_list`, `can_view_client_page`, `can_edit_client_page`.

## Required Follow-Up

1. Query the live database catalog for final function owner, volatility,
   `prosecdef`, `proconfig`, and execute grants.
2. Add SQL regression tests for the P1 queue: schedules, quizzes, and time off.
3. Add representative denied-state tests for social, tasks, inventory, employee
   info, and scout.
4. Require every new security-definer migration to include `set search_path`,
   explicit grants, and a short access-model comment.
5. Decide whether broad `grant execute ... to anon, authenticated` is necessary
   for each mutation RPC. Prefer `authenticated` only unless anonymous share
   flows genuinely require `anon`.

Useful live verification query:

```sql
select
  n.nspname as schema_name,
  p.proname as function_name,
  pg_get_userbyid(p.proowner) as owner_name,
  p.prosecdef as security_definer,
  p.provolatile as volatility,
  p.proconfig as config,
  acl.grantee::regrole::text as grantee,
  acl.privilege_type
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
left join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl on true
where n.nspname = 'public'
  and p.prosecdef
order by p.proname, grantee;
```
