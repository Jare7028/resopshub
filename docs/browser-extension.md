# Browser Text Capture Extension

## What was added

- API create endpoint: `POST /api/integrations/browser/tasks/capture`
- Shared parser/formatter: `lib/browserTaskCapture.ts`
- Extension assets under `public/browser-extension/`:
  - `manifest.json`
  - `background.js`
  - `options.html`
  - `options.css`
  - `options.js`
  - `icon-128.png`

## API payload shape

`POST /api/integrations/browser/tasks/capture`

```json
{
  "selectedText": "Required captured text",
  "title": "Optional explicit title",
  "sourceUrl": "https://example.com/page",
  "sourceTitle": "Page title",
  "assigneeUserId": "optional-user-id",
  "clientId": "optional-client-id",
  "projectId": "optional-project-id",
  "dueDate": "2026-02-19",
  "dueTime": "08:30"
}
```

The endpoint requires an authenticated user session and creates:

- `tasks` row (`status=to_do`, `priority=medium`)
- matching `task_assignees` row

## Install extension (Chrome/Edge)

1. Open extensions management:
   - Chrome: `chrome://extensions`
   - Edge: `edge://extensions`
2. Enable `Developer mode`.
3. Choose `Load unpacked`.
4. Select folder: `public/browser-extension/`.
5. Open extension `Details` and then `Extension options`.
6. Set `ResOpsHub URL` (for example `https://your-app-domain.com`), then save.

## Use flow

1. Highlight text on any web page.
2. Right-click selected text.
3. Click `Add Task`.
4. Extension creates a task through the capture API.
5. If enabled in options, the created task opens automatically in a new tab.

## Notes

- If the API returns `401`, the extension opens `/login` for the configured app URL.
- Captured text is saved into task notes with source metadata (`captured at`, page title, page URL).
- In local non-HTTPS setups, cookie `SameSite` policies can block extension-origin auth cookies. Deployed HTTPS environments are recommended.

