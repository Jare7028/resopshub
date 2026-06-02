# ResOpsHub

ResOpsHub is a customer operations and service platform built with Next.js,
Supabase, and Vercel. It includes tasks, clients, projects, notes, chat,
forms, schedules, inventory, social pages, quizzes, employee info, scout, and
admin tooling.

## Local Setup

Install dependencies:

```bash
npm install
```

Create `.env.local` with the required values below. Do not commit secrets.

Run the development server:

```bash
npm run dev
```

Open `http://localhost:3000`.

## Required Environment Variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | yes | Supabase project URL used by browser, server, middleware, and scripts. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | yes | Supabase anon key used by browser and server clients. |
| `SUPABASE_SERVICE_ROLE_KEY` | production/admin | Required for admin user APIs, cron routes, mention fan-out, and privileged scripts. Never expose to the browser. |
| `NEXT_PUBLIC_SITE_URL` | production | Canonical app origin for generated links. |
| `NEXT_PUBLIC_VERCEL_URL` | Vercel-provided | Fallback deployed origin when `NEXT_PUBLIC_SITE_URL` is not present. |
| `CRON_SECRET` | preview/local cron | Bearer secret for cron routes outside production Vercel Cron. |
| `LOG_LEVEL` | recommended | Structured server log level: `debug`, `info`, `warn`, or `error`. |
| `LOG_QUERY_TIMINGS` | optional | Set to `1` to log timed query sections. |
| `LOG_QUERY_TIMINGS_MIN_MS` | optional | Minimum duration for query timing logs. |
| `LOG_TASK_CREATE` | optional | Set to `1` to emit task creation info logs. |
| `SUPABASE_COOKIE_SAMESITE` | optional | Overrides Supabase auth cookie SameSite handling. |
| `NOTIFICATIONS_TZ` | optional | Timezone for notification scheduling defaults. |
| `CONNECTEAM_API_KEY` and related `CONNECTEAM_*` values | optional | Connecteam chat mirror integration. |
| `NEXT_PUBLIC_NOTE_IMAGE_DEBUG` | local/debug only | Enables client note image debug logging. |
| `NEXT_PUBLIC_NOTE_SAVE_DEBUG` | local/debug only | Enables client note save debug logging. |

## Validation Commands

Run these before pushing production-facing changes:

```bash
npx tsc --noEmit
npm test
npm run lint
npm audit --json
npm run build
```

Current scripts:

- `npm run dev`: start Next.js locally.
- `npm run build`: production build.
- `npm run start`: run the built app.
- `npm run lint`: ESLint CLI.
- `npm test`: Vitest test suite.
- `npm run test:coverage`: coverage report.
- `npm run scout:sync`: sync scout data from legacy source using service-role credentials.

## Supabase Migrations

Migration files live in `supabase/migrations`.

Before deploying database-sensitive work:

1. Read the new migration and nearby older migrations for overlapping tables,
   functions, indexes, triggers, and policies.
2. Confirm every new security-definer function includes `set search_path`.
3. Confirm every new privileged function has explicit grants and a documented
   access model.
4. Run the relevant app tests and any SQL regression tests available for the
   module.
5. Deploy migrations to a branch/preview database before production when the
   change affects RLS, security-definer functions, cron, tasks, schedules,
   quizzes, inventory, employee info, or social pages.

Security inventory:

- `docs/security-definer-rls-inventory-2026-06-02.md`

## Vercel Deployment

The production app is deployed on Vercel.

Pre-deploy checklist:

1. Confirm `main` is clean and pushed.
2. Confirm the validation commands above pass locally or in CI.
3. Confirm Vercel environment variables match the target environment.
4. Confirm Supabase migrations are applied to the matching database.
5. Deploy or allow Vercel to build from `main`.
6. Review Vercel build logs for TypeScript, lint, route build, and middleware
   warnings.

Post-deploy smoke checklist:

- Unauthenticated `/tasks`, `/clients`, `/projects`, and `/feature-suggestions`
  redirect to `/login`.
- Login succeeds.
- `/tasks` loads without red client errors.
- Quick add creates a title-only task.
- Quick add creates a task with notes and optional subtasks.
- Task detail opens and notes save.
- Chat loads and unread counts render.
- Cron routes reject requests without valid production Vercel Cron context or
  `CRON_SECRET`.
- Admin user management only appears when service-role credentials are present
  and the user is authorized.

## Cron

Cron routes are configured in `vercel.json`:

| Route | Schedule |
| --- | --- |
| `/api/cron/recurring-tasks` | `55 12 * * *` |
| `/api/cron/task-reminders` | `0 13 * * *` |

Authorization rules:

- Production Vercel Cron may use the Vercel cron header.
- Preview, local, and non-Vercel calls must use `CRON_SECRET`.
- Cron routes use service-role access, so treat failures or unexpected accepts
  as security incidents.

## Observability

Structured logging is documented in `docs/vercel-logging.md`.

Useful log controls:

- `LOG_LEVEL=debug` for temporary detailed server logs.
- `LOG_QUERY_TIMINGS=1` and `LOG_QUERY_TIMINGS_MIN_MS=<ms>` for slow query
  investigation.
- `LOG_TASK_CREATE=1` for task creation diagnostics.

Do not leave noisy debug flags enabled in production unless there is an active
incident.

## High-Risk Modules

Prioritize extra validation for these surfaces:

- Tasks: creation, quick add, subtasks, recurrence, reminders, audit events,
  assignees, and task notes.
- Schedules and time off: shift writes, publishing, claiming, templates,
  billable settings, requests, approvals, and notifications.
- Quizzes: authoring, assignment, attempts, scoring, review, audit, and score
  events.
- Social pages: page membership, posts, comments, images, reads, and reactions.
- Inventory and employee info: dynamic columns, exports, and manage-column
  permissions.
- Cron routes and service-role code paths.

## Additional Docs

- `docs/codebase-review-2026-06-01.md`: sitewide audit and implementation backlog.
- `docs/vercel-logging.md`: structured logging.
- `docs/browser-extension.md`: browser text capture extension.
- `docs/outlook-email-import.md`: Outlook email-to-task import.
- `docs/responsive-qa-checklist.md`: responsive QA checklist.
- `docs/social-workspace-scope.md`: social workspace scope.
