# Vercel Logging

The app now emits structured JSON logs from server runtime paths using `lib/vercelLogger.ts`.

## Log Levels

Set `LOG_LEVEL` in Vercel project environment variables:

- `debug`
- `info` (default)
- `warn`
- `error`

Only logs at or above `LOG_LEVEL` are emitted.

## Event Coverage Added

- Social page creation flow: `app/(app)/social/page.tsx`
- Social image upload API: `app/api/social/pages/[pageId]/images/route.ts`
- Page permission middleware: `lib/supabase/middleware.ts`

## How to Filter in Vercel Logs

Search by event names such as:

- `social.page.create.insert_failed`
- `social.page.create.permission_check_error`
- `social.post.create.insert_failed`
- `social.comment.create.insert_failed`
- `social.image.upload.storage_upload_error`
- `middleware.permission_check.edit.error`

Logs include fields like `request_id`, `create_attempt_id`, `page_id`, and serialized `error` payloads for fast diagnosis.
