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

## Add-in setup walkthrough

### 1. Prepare manifest

1. Open `public/outlook-addin/manifest.xml`.
2. Confirm every URL points to your deployed HTTPS origin (for example `https://resopshub-p1pi.vercel.app`):
   - `IconUrl`
   - `HighResolutionIconUrl`
   - `SupportUrl`
   - `FormSettings -> SourceLocation`
   - `Resources -> Commands.Url`
   - `Resources -> Taskpane.Url`
3. Confirm `<AppDomains>` contains the same origin.
4. Save the file (this is the file used for sideloading).

### 2. Install in Outlook on the web (baseline path)

1. Open Outlook on the web.
2. Open add-in management (`Get Add-ins` / `Manage add-ins`).
3. Go to `My add-ins` and choose `Add a custom add-in`.
4. Choose `Add from file` and select `manifest.xml` (or `Add from URL` if hosted).
5. Open any message in read mode and verify the command appears.

### 3. Install in desktop Outlook

1. In desktop Outlook, open add-in management and add a custom add-in.
2. Use `Add from file` with the same `manifest.xml`.
3. If desktop installation fails, install in Outlook web first, then restart desktop Outlook.
4. Open an email in read mode and click `Import to Task`.

### 4. First-run auth and import

1. In the task pane, sign in to ResOpsHub if prompted.
2. Click `I've logged in, try again` after browser login completes.
3. Review prefilled fields (title, notes, assignee, etc.).
4. Create task and verify with `Open Task`.

### 5. Common issues

- **Add-in installation failed**: verify manifest URLs are valid HTTPS and reachable.
- **Button missing in Outlook**: only appears for message read mode.
- **Preview/create fails with schema error**: run `sql/task_email_sources.sql` and `sql/outlook_import_events.sql`.
- **Desktop login loop**: confirm deployed build includes embedded-pane auth cookie settings; re-login in pane.

## Notes

- v1 only supports primary mailbox imports.
- The add-in currently imports the currently open email only (single-message snapshot) and does not request Graph conversation expansion.
- Duplicate detection warns by `selected_message_id` and allows override via `createDespiteDuplicate`.
- The create endpoint accepts optional `notesText` to support editable note text before creating the task.
- Daily telemetry counts are available via `public.outlook_import_daily_metrics`.
- In production, Supabase cookies use `SameSite=None; Secure` so auth works inside embedded Outlook add-in panes.
