# Outlook Email-to-Task Import

## What was added

- API preview endpoint: `POST /api/integrations/outlook/tasks/import/preview`
- API create endpoint: `POST /api/integrations/outlook/tasks/import/create`
- Shared import parser/formatter: `lib/outlookTaskImport.ts`
- Telemetry logger: `lib/outlookImportTelemetry.ts`
- SQL migration: `sql/task_email_sources.sql`
- SQL telemetry migration: `sql/outlook_import_events.sql`
- Outlook add-in assets under `public/outlook-addin/`:
  - `manifest.xml`
  - `commands.html`
  - `commands.js`
  - `taskpane.html`
  - `taskpane.css`
  - `taskpane.js`

## Required DB migration

Run:

```sql
\i sql/task_email_sources.sql
\i sql/outlook_import_events.sql
```

or copy/paste the file contents into Supabase SQL editor.

## Add-in setup

1. Open `public/outlook-addin/manifest.xml`.
2. Replace every `https://YOUR_RESOPSHUB_URL` with your deployed app origin.
3. Sideload the manifest into Outlook (web/desktop) using add-in management.

## Notes

- v1 only supports primary mailbox imports.
- The add-in requests Microsoft Graph conversation data and blocks creation if full conversation expansion fails.
- Duplicate detection warns by `selected_message_id` and allows override via `createDespiteDuplicate`.
- The create endpoint accepts optional `notesText` to support editable note text before creating the task.
- Daily telemetry counts are available via `public.outlook_import_daily_metrics`.
