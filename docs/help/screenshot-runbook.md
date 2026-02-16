# Help Screenshot Runbook

## Purpose
Generate consistent screenshots for help documentation using Playwright.

Script:

- `scripts/capture-help-screenshots.mjs`

## Prerequisites

1. App is running locally or on a reachable preview/staging URL.
2. Playwright browser is available (Chromium).
3. You have an authenticated session storage-state file for protected routes.

## 1) Start App

```bash
npm run dev
```

Default local URL:

- `http://localhost:3000`

## 2) Create Authenticated Storage State

If you already have one, skip this step.

```bash
npx playwright codegen http://localhost:3000/login --save-storage=.tmp/help-auth.json
```

Login in the opened browser, confirm you land inside the app, then close the codegen window.

## 3) Capture Default Top-Level Screenshots

```bash
node scripts/capture-help-screenshots.mjs --storage-state .tmp/help-auth.json
```

Output directory:

- `docs/help/screenshots`

Default captured routes:

1. `/dashboard`
2. `/clients`
3. `/projects`
4. `/tasks`
5. `/forms`
6. `/chat`
7. `/personal`
8. `/notes`
9. `/feature-suggestions`
10. `/search`
11. `/settings`

## 4) Capture Dynamic Detail Screens

Add routes for concrete IDs in your seed/staging data.

```bash
node scripts/capture-help-screenshots.mjs \
  --storage-state .tmp/help-auth.json \
  --route client-detail=/clients/CLIENT_ID \
  --route client-note=/clients/CLIENT_ID/notes/NOTE_ID \
  --route project-detail=/projects/PROJECT_ID \
  --route task-detail=/tasks/TASK_ID \
  --route form-detail=/forms/FORM_ID \
  --route submission-detail=/forms/submissions/SUBMISSION_ID \
  --route personal-page=/personal/PAGE_ID \
  --route idea-detail=/feature-suggestions/SUGGESTION_ID
```

## 5) Capture Only Custom Routes

```bash
node scripts/capture-help-screenshots.mjs \
  --only-extra-routes \
  --storage-state .tmp/help-auth.json \
  --route task-subtasks=/tasks/TASK_ID?tab=subtasks \
  --route task-notes=/tasks/TASK_ID?tab=notes
```

## 6) Full-Page Mode (Optional)

```bash
node scripts/capture-help-screenshots.mjs \
  --storage-state .tmp/help-auth.json \
  --full-page
```

## Troubleshooting

### Redirected to `/login`

Cause:

- missing/expired storage state

Fix:

1. Re-run codegen to refresh `.tmp/help-auth.json`.
2. Re-run screenshot script with `--storage-state`.

### Route capture failed

Cause:

- ID route does not exist in current environment

Fix:

1. Open the route manually and confirm valid ID.
2. Re-run with corrected `--route`.

### Screenshot is stale/missing UI data

Cause:

- test data changed or filters persisted in URL

Fix:

1. Use deterministic seed IDs.
2. Include exact query params in `--route`.

## Recommended Governance

1. Regenerate screenshots when shipping visible UX changes.
2. Keep screenshots under `docs/help/screenshots`.
3. Use consistent naming and avoid manual cropping unless necessary.
