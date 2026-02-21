# Social Workspace Scope

## Objective
Create an internal social module under `/social` for work updates, inspired by Yammer-style pages, where access is private-by-default and managers explicitly invite members.

## Delivered MVP
- Left-nav item: `Social` (`/social`) with existing page-level permissions.
- Social hub:
  - Create social pages.
  - View accessible social pages with owner, member count, post count, and last activity.
- Social page detail (`/social/[pageId]`):
  - Feed with posts (text + image gallery).
  - Comments per post.
  - Page access management (add member, assign `member` or `manager`, remove member).
- Image upload API for posts: `/api/social/pages/[pageId]/images`.
- DB schema + RLS in `sql/social.sql`.

## Access Model
### Layer 1: module access
- Global page key: `social`.
- Users must have `/permissions` access to view or edit Social.

### Layer 2: per-page access
- Social pages are private by default.
- Only the page owner (creator), explicit members, and admins can access a page.
- Managers and owners can add/remove members and change roles.

## Data Model
`sql/social.sql` introduces:
- `social_pages`
- `social_page_members` (`member` | `manager`)
- `social_posts`
- `social_post_images`
- `social_post_comments`

Helper functions:
- `can_access_social_page(uuid)`
- `can_manage_social_page(uuid)`
- `can_access_social_post(uuid)`
- `can_manage_social_post(uuid)`
- `can_manage_social_comment(uuid)`

Storage bucket:
- `social-post-images` (public)
- Path format: `{page_id}/{uploader_user_id}/{timestamp-random-filename}`

## UX Direction
### Social hub
- High-contrast hero introducing the module and privacy model.
- Fast page creation card.
- Page cards with clear context and activity signal.

### Social page
- Header with page identity and owner.
- Primary composer optimized for quick updates.
- Image-first posting flow with preview/remove before submit.
- Feed cards with readable hierarchy and low visual noise.
- Comments kept near each post for quick context.
- Access panel for manager actions without leaving the page.

## Rollout Notes
1. Run `sql/permissions_admin_member.sql` with the new `social` page key update.
2. Run `sql/social.sql` to create social tables/functions/policies/bucket.
3. Grant member access to `Social` in `/admin/users/[userId]/permissions`.
4. Create first social page and add members.

## Recommended Next Phases
1. Notifications: mentions/new post/comment digests.
2. Rich posts: links, emoji reactions, post pinning.
3. Moderation: edit/delete post/comment controls with audit trail.
4. Discovery: search/filter by page and by post content.
5. Analytics: engagement metrics per page.
