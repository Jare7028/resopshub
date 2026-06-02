# Sitewide Codebase Review - 2026-06-01

## Scope

This is a pragmatic engineering audit of ResOpsHub, focused on customer-impacting bugs, speed, security exposure, scalability, code bloat, duplication, and test gaps. It is not the formal exhaustive Codex Security scan with subagent coverage ledgers.

Priority scoring combines customer impact, security exposure, scalability risk, and engineering cost:

- P0: urgent
- P1: high
- P2: medium
- P3: cleanup

## Executive Summary

Top risks:

1. The dependency audit is not clean. `next@15.5.15` is below available security fixes, and `vitest@4.0.18` / `@vitest/coverage-v8@4.0.18` are flagged by `npm audit`.
2. Several Supabase `.or()` filters interpolate user input directly into PostgREST filter strings. This is a security and correctness risk, especially in search-style routes.
3. Image upload validation is inconsistent. Some routes accept any `image/*`, while social uploads already use a safer explicit allow-list.
4. The task creation and route-modal pattern has improved, but the wider app still uses route-driven popouts for heavy pages. That keeps customer workflows exposed to full server navigations and unnecessary data loading.
5. The codebase has several very large page/client files. This makes performance work slower, increases regression risk, and hides duplicated data/action patterns.
6. Permission/auth code is present in the right broad areas, but it is repeated heavily and mixed with page logic. Centralizing it would reduce bugs and speed up future work.
7. Test coverage is useful but concentrated in libraries. The riskiest customer flows need browser/API/server-action coverage.

## Validation Checks Run

| Check | Result | Notes |
| --- | --- | --- |
| `npm audit --json` | Failed | 5 vulnerabilities: 2 critical, 1 high, 2 moderate. See finding F-001. |
| `npx tsc --noEmit` | Passed | TypeScript completed with exit code 0. |
| `npm test` | Passed | 24 test files, 138 tests passed. |
| `npm run test:coverage` | Passed | Overall: 73.26% statements, 60.34% branches, 78.52% functions, 76.51% lines. |
| `npm run build` | Passed | Next.js 15.5.15 build completed. `/tasks` built at 4.91 kB route JS and 127 kB first load JS; middleware bundle was 82.2 kB. |
| `npm run lint` | Passed | `next lint` is deprecated and needs migration before Next 16. |
| Static scans | Completed | Searched service-role usage, auth calls, unsafe HTML/SVG handling, `.or()` filters, large files, console noise, lint disables, RLS/security-definer surface, API routes, and route-modal patterns. |

Important counts from static review:

- 56 App Router pages and 37 API route files under `app`.
- 39 test files.
- 58 direct `supabase.auth.getUser()` calls.
- 41 `createSupabaseAdminClient` references.
- 128 `security definer` migration occurrences.
- 52 `enable row level security` migration occurrences.
- 71 `console.log/error/warn/info/debug` calls in `app`, `lib`, and `supabase`; 0 remain under `app/api`.
- 0 `react-hooks/exhaustive-deps` lint disables.

## Quick Wins

1. Upgrade `next` from `15.5.15` to `15.5.18`, then rebuild and redeploy.
2. Upgrade `vitest` and `@vitest/coverage-v8` from `4.0.18` to a non-vulnerable release.
3. Replace user-input `.or()` string interpolation with RPCs or a shared PostgREST filter escaping helper.
4. Apply the social upload MIME allow-list pattern to chat, personal-page, note, and avatar uploads.
5. Remove debug image/editor logs or put them behind a structured logger and environment-controlled log level.
6. Migrate `next lint` to ESLint CLI before the next framework upgrade.
7. Add a Playwright smoke test for login, `/tasks`, quick add task, open task, and save task notes.

## Implementation Progress

Updated 2026-06-02:

- Completed: F-001 dependency security upgrades. `npm audit --json` now reports 0 vulnerabilities.
- Completed: F-002 for the user-facing search/filter paths called out in the finding. Search suggestions, search fallback, mentions, forms, and feature suggestions now use a shared PostgREST filter helper with regression tests.
- Completed: F-003 upload MIME handling. Chat, personal-page images, social images, note image persistence, note rendering, profile avatars, and client upload controls now share an explicit PNG/JPEG/WebP/GIF/AVIF policy and block SVG by default.
- Completed: F-011 cron authorization tightening. `x-vercel-cron` is now trusted only on production Vercel deployments; other environments require `CRON_SECRET`.
- Completed: F-004 task quick-add slice. The default `/tasks` add flow now opens a focused client modal for title, notes, and optional subtasks, backed by a dedicated server action that returns the created task summary without forcing the route-modal flow. The existing `/tasks?tab=add` route remains available as Advanced options for recurrence/templates/full metadata.
- Open: F-004 follow-up for other route-driven modal workflows outside the default task quick-add path.
- Completed: F-009 personal image/editor observability slice. Personal image upload/save success paths no longer log as errors, personal image upload failures now use the structured server logger, note editor image/save debug output requires explicit public debug flags, and `lib/vercelLogger.test.ts` covers structured output, log-level filtering, redaction, errors, and bigint serialization.
- Completed: F-009 API route logging slice. `app/api` now has no direct `console.*` calls; quick-read, chat message mention failures, project task lookups, and subtask lookup diagnostics use `logError` with structured context.
- Open: F-009 follow-up for the remaining broad console logging inventory outside API routes, especially page/server actions, note-editor debug gates, telemetry helpers, and local structured-log shims.
- Completed: F-007 quick-read date-window slice. `/api/briefing/quick-read` now applies a local next-24-hour `due_date` cutoff to the task query before summarizing overdue and due-soon work, and `lib/loginQuickReadSummary.test.ts` covers cutoff, filtering, sorting, URLs, and fallback titles.
- Completed: F-007 quick-read assignment RPC slice. `/api/briefing/quick-read` now prefers the bounded `login_quick_read_tasks` RPC, which joins primary and secondary task assignments in SQL with due-date filtering, and falls back to the old bounded compatibility path only when needed.
- Completed: F-013 build tooling migration. `npm run lint` now runs `eslint .` through an explicit flat config and no longer prints the Next.js `next lint` deprecation warning.
- Completed: F-014 stale hook-disable cleanup. The remaining `react-hooks/exhaustive-deps` disables in feature suggestions, clients, and projects were removed by making the saved-default-view effects self-contained with complete dependency lists.
- Completed: F-006 API auth helper slice. `lib/api/requireApiUser.ts` now wraps the middleware-header-aware `getCurrentRequestUser` helper with a consistent 401 JSON response, and `/api/briefing/quick-read`, `/api/tasks/[taskId]/hover`, and `/api/tasks/[taskId]/subtasks` now use it instead of direct auth calls.
- Completed: F-006 admin API helper slice. `lib/api/requireApiAdmin.ts` centralizes admin-only JSON auth for the admin user update/delete endpoints while preserving the existing `{ ok: false, error }` response shape.
- Completed: F-006 API auth helper hardening slice. `requireApiUser` and `requireApiAdmin` now force Supabase verification instead of trusting forwarded internal user headers, because `/api` routes are not covered by the middleware matcher.
- Completed: F-006 API user route batch. App nav reorder, search suggestions, mention suggestions, chat uploads, chat link options, chat reactions, and chat read-marker routes now use `requireApiUser` with consistent 401 JSON.
- Completed: F-006 chat conversation API route batch. Chat group/direct conversation creation, member add/remove, and preference updates now use `requireApiUser` while preserving their existing JSON error shape.
- Completed: F-006 integration/project API route batch. Project task lookup, Outlook import preview/create, and browser task capture now use `requireApiUser`; browser capture preserves its CORS-aware unauthorized response.
- Completed: F-006 personal/social/schedule API route batch. Schedule shift reposition, personal section/page reorder, personal page duplicate/image upload, social read tracking, and social image upload now use `requireApiUser`.
- Completed: F-006 final API auth cleanup slice. Chat message list/create/update/delete now use `requireApiUser`, and the help-guide admin API uses `getCurrentRequestUser` with forwarded-header trust disabled to preserve its custom admin response shape. Static scan now finds 0 direct `supabase.auth.getUser()` calls under `app/api`.
- Completed: F-006 admin page/action helper slice. `lib/adminAccess.ts` centralizes admin profile checks for the admin landing page, users page, create-user server action, and user-permissions page/action.
- Completed: F-006 settings page-edit helper slice. `lib/pageEditAccess.ts` centralizes authenticated page-edit checks and the settings assignment-group, status-option, task-template, task-template subtask, project-template, project-template task link/unlink, and template custom-field actions now use it.
- Completed: F-006 settings current-user helper slice. The settings page, profile update action, and notification-preference action now use `getCurrentRequestUser`, leaving no direct `supabase.auth.getUser()` calls in `app/(app)/settings/page.tsx`.
- Completed: F-006 inventory current-user helper slice. Inventory record/cell/column server actions now use `getCurrentRequestUser` while keeping the existing inventory access and column-management RPC checks.
- Completed: F-006 employee-info current-user helper slice. Employee-info record/cell/column and visibility-rule server actions now use `getCurrentRequestUser` while keeping the existing visibility, admin, and column-management checks.
- Completed: F-006 personal page current-user helper slice. Personal page load and details/delete/template/client-note/external-share actions now use `getCurrentRequestUser`; the details update action now explicitly redirects unauthenticated requests instead of writing with a null editor id.
- Completed: F-006 client overview current-user helper slice. Client overview page load, member/page-access actions, and legacy note creation now use `getCurrentRequestUser` while preserving client page edit/access checks.
- Completed: F-006 feature-suggestions current-user helper slice. Feature suggestion list/detail pages and create/update/comment/vote actions now use `getCurrentRequestUser`; suggestion detail update now requires an authenticated actor before mention notification.
- Completed: F-006 personal editor current-user helper slice. Personal editor content save, context-menu favorites, and create-task actions now use `getCurrentRequestUser`; content save now rejects unauthenticated requests instead of writing a null editor id.
- Open: F-006 follow-up for the remaining page/server-action permission helpers, especially social pages, task mutations, remaining client subpages, forms, and quizzes.
- Completed: F-008 quick task server-action test slice. `app/(app)/tasks/actions.test.ts` now covers quick-create authorization, disabled profiles, validation limits, note preservation, subtask creation, assignee rows, and `/tasks` revalidation.
- Open: F-008 follow-up for signed-in browser smoke coverage plus recurrence, status-options, and deeper task mutation tests.
- Completed: F-010 migration-backed security-definer/RLS inventory slice. `docs/security-definer-rls-inventory-2026-06-02.md` now groups the migration surface, confirms every security-definer declaration has nearby `set search_path`, ranks the highest-risk modules, and lists live-database verification queries.
- Open: F-010 follow-up for live catalog verification and SQL regression tests for schedules, quizzes, time off, social, tasks, inventory, employee info, and scout.
- Completed: F-015 production operations README slice. `README.md` now covers local setup, environment variables, validation commands, Supabase migrations, Vercel deployment, cron, smoke checks, observability, high-risk modules, and related docs.
- Open: F-015 follow-up for CI/deploy-specific screenshots or Vercel dashboard links if the team wants a more visual runbook.
- Completed: F-012 Forms list scalability slice. `/forms` now uses a bounded `forms_list_page` RPC with open-submission counts, total count, timing labels, previous/next pagination, and a bounded compatibility fallback. The migration is tracked at `supabase/migrations/20260602120000_forms_list_page_rpc.sql`, with manual SQL in `sql/forms_list_page_rpc.sql`.
- Completed: F-012 Social landing scalability slice. `/social` now uses a bounded `social_landing_page` RPC with page summaries, owner display data, total page count, 7-day counters, timing labels, previous/next pagination, and a bounded compatibility fallback. The migration is tracked at `supabase/migrations/20260602130000_social_landing_page_rpc.sql`, with manual SQL in `sql/social_landing_page_rpc.sql`.
- Open: F-012 follow-up for large-file table refactors plus production timing/EXPLAIN checks after the Forms and Social RPCs are applied.
- Completed: F-005 task table view-state extraction slice. `app/(app)/tasks/taskTableViewState.ts` now owns the persisted task-column normalization helpers, and `app/(app)/tasks/taskTableViewState.test.ts` pins the current behavior before larger `TasksView` splits.
- Open: F-005 follow-up for `NoteEditorClient`, settings, chat, social detail, inventory/employee tables, task page/detail, and additional `TasksView` responsibility splits.
- Open: The explicit F-004, F-006, F-008, F-009, F-010, F-012, and F-015 follow-ups remain the main route-modal, permission, RLS, test, observability, docs, scalability, and cleanup backlog.

Latest implementation validation:

- `npx tsc --noEmit`: passed.
- `npx vitest run 'app/(app)/tasks/taskTableViewState.test.ts'`: passed, 5 tests.
- `npx vitest run lib/api/requireApiAdmin.test.ts`: passed, 4 tests.
- `npx vitest run lib/loginQuickReadTaskRows.test.ts`: passed, 3 tests.
- `npx vitest run lib/adminAccess.test.ts`: passed, 3 tests.
- `npx vitest run lib/pageEditAccess.test.ts`: passed, 3 tests.
- `npm test`: passed, 39 files and 191 tests.
- `npm run lint`: passed.
- `npm run build`: passed on Next.js 15.5.18. `/tasks` built at 4.36 kB route JS and 129 kB first load JS after the table view-state extraction; `/forms` built at 5.84 kB route JS and 118 kB first load JS after the list pagination slice; `/settings` built at 4.71 kB route JS and 116 kB first load JS after the latest page-edit guard slice.
- `npm audit --json`: passed with 0 vulnerabilities.
- Static console scan: `app/api` has 0 direct `console.*` calls; the broader `app`, `lib`, and `supabase` inventory is down to 71 calls.
- Static API auth scan: `app/api` has 0 direct `supabase.auth.getUser()` calls; route-handler auth now goes through `requireApiUser`, `requireApiAdmin`, or an explicit `getCurrentRequestUser(..., { trustForwardedUserHeaders: false })` call.
- `npx supabase migration list --linked`: blocked by remote database authentication; the current shell has `SUPABASE_DB_PASSWORD`, but the value fails password auth for linked project `tsylrdpxsouptxmjixmu`. The Forms, Social, and Quick Read RPC migrations are tracked, but remote application still needs the correct DB password or another migration path.
- Local browser smoke on a clean port reached the expected unauthenticated `/tasks` -> `/login` redirect with no red error screen; direct HTTP smoke returned 307. Modal interaction still needs a signed-in browser smoke test or Playwright-auth fixture.
- Local API smoke on a temporary dev server confirmed unauthenticated `/api/admin/users/update` and `/api/admin/users/delete` both return `401 {"ok":false,"error":"Unauthorized"}`.
- Local API smoke on a temporary dev server confirmed unauthenticated `/api/briefing/quick-read` still returns `401 {"error":"Unauthorized"}`.
- Local API smoke on a temporary dev server confirmed unauthenticated `/api/search/suggestions`, `/api/mentions/suggestions`, `/api/chat/conversations/read`, and `/api/app-nav/reorder` return `401 {"error":"Unauthorized"}` after the API user route batch.
- Local HTTP smoke on a temporary dev server confirmed unauthenticated `/admin` and `/admin/users` redirect to `/login`.
- Local HTTP smoke on a temporary dev server confirmed unauthenticated `/settings` redirects to `/login`.
- Local in-app browser smoke for `/forms` reached the expected unauthenticated `/forms` -> `/login` redirect with no red error screen.
- Local in-app browser smoke for `/social` reached the expected unauthenticated `/social` -> `/login` redirect with no red error screen.
- Local HTTP smoke on a temporary dev server returned the expected unauthenticated 307 redirects for `/clients`, `/projects`, and `/feature-suggestions` after the hook-disable cleanup.

## Suggested Order of Implementation

1. F-001 dependency security upgrades.
2. F-002 raw Supabase filter composition.
3. F-003 image upload and SVG handling.
4. F-004 task and route-modal performance.
5. F-006 auth/permission helper consolidation.
6. F-008 tests for task creation and critical server actions.
7. F-007 quick-read endpoint performance.
8. F-005 large-file refactors, starting with the task and note editor areas.
9. F-010 security-definer/RLS inventory.
10. P3 cleanup items as part of surrounding feature work.

## Findings

### F-001 - P0 - Security and Dependencies - Patch vulnerable framework and test dependencies

Evidence:

- `package.json:38` pins `next` to `15.5.15`.
- `package.json:47` pins `@vitest/coverage-v8` to `^4.0.18`.
- `package.json:52` pins `vitest` to `^4.0.18`.
- `npm audit --json` reported 5 vulnerabilities: 2 critical, 1 high, 2 moderate.
- Audit packages:
  - `next`: high, fix available at `15.5.18`.
  - `postcss`: moderate via Next, fix available through `next@15.5.18`.
  - `vitest`: critical, affected range `<4.1.0`.
  - `@vitest/coverage-v8`: critical via Vitest.
  - `ws`: moderate, affected range `8.0.0 - 8.20.0`.

User/business impact:

- Next.js is customer-facing infrastructure for every page and route. Known framework vulnerabilities can bypass assumptions around routing, middleware, cache behavior, or request handling.
- Vitest is dev/test infrastructure, but vulnerable developer tooling still matters because it runs inside trusted local and CI environments.

Recommended fix:

- Upgrade `next` to `15.5.18` and regenerate `package-lock.json`.
- Upgrade `vitest` and `@vitest/coverage-v8` to a release outside the audited vulnerable range.
- Re-run `npm audit --json`, `npx tsc --noEmit`, `npm test`, `npm run test:coverage`, and `npm run build`.
- Deploy quickly after framework upgrade passes.

Estimated effort: small.

Verification needed:

- `npm audit --json` shows no high or critical findings.
- Production smoke test covers login, `/tasks`, task add, task detail, chat, settings, and one API mutation.

### F-002 - P1 - Security and Data Integrity - User input is interpolated into Supabase `.or()` filter strings

Evidence:

- `app/api/search/suggestions/route.ts:94` and `app/api/search/suggestions/route.ts:100` build `.or()` filters using `likeQuery`.
- `app/(app)/search/page.tsx:159` and `app/(app)/search/page.tsx:204` build fallback search `.or()` filters.
- `app/api/mentions/suggestions/route.ts:87` and `app/api/mentions/suggestions/route.ts:104` build `.or()` filters from `normalizedQuery`.
- `app/(app)/forms/page.tsx:280` builds `title.ilike.%${query}%,description.ilike.%${query}%`.
- `app/(app)/feature-suggestions/page.tsx:239` builds `title.ilike.%${query}%,details.ilike.%${query}%`.
- Additional `.or()` string construction appears in dashboard, notes, settings, projects, clients, and quick-read routes.

User/business impact:

- Incorrect escaping can turn a search box into a filter-syntax manipulation surface or cause query failures for normal customer input containing reserved characters.
- Even if Supabase/PostgREST blocks the worst cases, fragile filters will produce red errors and inconsistent search results.

Recommended fix:

- Prefer RPCs for multi-table or multi-field search, with parameters passed as values.
- Where `.or()` is still necessary, create one small helper that escapes PostgREST filter values correctly and bans unsupported syntax.
- Add regression tests with commas, parentheses, `%`, `_`, quotes, dots, empty strings, and long search terms.

Estimated effort: medium.

Verification needed:

- Unit tests for the helper or RPC parameter behavior.
- Browser/API checks for global search, mentions, forms search, and feature suggestions search.
- Confirm no `.or()` filter accepts raw user text.

### F-003 - P1 - Security - Image upload validation allows broad `image/*` in some routes

Evidence:

- `app/api/chat/uploads/route.ts:44` accepts files when `file.type.startsWith("image/")`.
- `app/api/personal/pages/[pageId]/images/route.ts:107` accepts files when `file.type.startsWith("image/")`.
- `app/(app)/settings/page.tsx:783` validates avatars with `avatarFile.type.startsWith("image/")`.
- `lib/noteImagePersistence.ts:109` maps `image/svg+xml` to `svg`.
- `app/(app)/_components/NoteEditorClient.tsx:862` also maps `image/svg+xml` to `svg`.
- Safer precedent exists: `app/api/social/pages/[pageId]/images/route.ts:8` defines `ALLOWED_IMAGE_MIME_TYPES`, and `app/api/social/pages/[pageId]/images/route.ts:120` enforces it.

User/business impact:

- SVG and uncommon image MIME types are risky if they can be rendered from public storage or later embedded into rich content.
- The inconsistent rules mean customers get different behavior depending on where they upload, while engineers have to reason about several upload policies.

Recommended fix:

- Create a shared upload validation module with one explicit allow-list, probably PNG, JPEG, WebP, GIF, and AVIF.
- Block SVG by default unless there is a real product need and a sanitizer/proxy pipeline is implemented.
- Enforce extension from validated MIME type rather than trusting the original filename.
- Apply the same helper to chat, personal pages, note images, avatars, and social images.

Estimated effort: medium.

Verification needed:

- Upload tests for allowed types and blocked SVG/HTML/renamed files.
- Manual smoke test for image upload/preview in chat, personal pages, notes, social posts, and settings avatar.

### F-004 - P1 - Performance and UX - Route-driven modals still make common workflows feel slow

Evidence:

- `app/(app)/tasks/page.tsx:395` renders the add-task flow inside `RouteModalOverlay`.
- `app/(app)/tasks/page.tsx:1801` renders another task detail overlay.
- `app/(app)/projects/page.tsx:1265`, `app/(app)/schedules/page.tsx:419`, `app/(app)/schedules/[clientId]/page.tsx:1099`, `app/(app)/social/[pageId]/page.tsx:1670`, and `app/(app)/employee-info/page.tsx:1906` use the same route-modal pattern.
- Recent production timing checks before the latest task optimization showed direct `/tasks?tab=add` around 1.95s and simple submit around 4.5s, with multiple `/tasks/[id]?_rsc` prefetches.
- After the targeted task optimization, direct add reload improved to about 0.946s, simple submit to about 3.026s, and task detail prefetch count dropped to 0. The pattern is still expensive relative to a local client modal with focused data loading.
- Implemented task quick-add slice: `app/(app)/tasks/_components/QuickAddTaskModal.tsx`, `app/(app)/tasks/actions.ts`, and `app/(app)/tasks/TasksView.tsx` now support a lightweight default modal and optimistic local insertion. `app/(app)/tasks/page.tsx` still keeps the advanced route-modal form for recurrence/templates/full metadata.

User/business impact:

- Customers perceive the app as slow when a simple "add task" action navigates, waits on server data, or revalidates a heavy page.
- Popouts are not inherently slow, but route-driven popouts backed by large server pages are a frequent source of loading delays and red errors.

Recommended fix:

- Done for default task creation: keep the UI idea of a popout, but make the default quick-add task form a client-side modal/drawer with title and notes as first-class fields.
- Done for default task creation: use a small server action that returns the created task summary without forcing the full task list route to reload.
- Continue to keep recurrence, templates, assignees, watchers, and full metadata in the advanced task form until those flows can be progressively split.
- Apply the same split to other heavy route-modal workflows after tasks.

Estimated effort: medium to large.

Verification needed:

- Browser timing for open quick-add, submit title-only task, submit title plus notes, open created task, and close modal using a signed-in session.
- Check that no task detail RSC prefetches fire while hovering or viewing the task list unless explicitly needed.

### F-005 - P1 - Code Health and Scalability - Very large files are hiding bugs and slowing change

Evidence:

- `app/(app)/_components/NoteEditorClient.tsx`: 6751 lines.
- `app/(app)/settings/page.tsx`: 4304 lines.
- `app/(app)/chat/ChatPageClient.tsx`: 2682 lines.
- `app/(app)/tasks/TasksView.tsx`: 2646 lines after the quick-add UX slice, before further large-file decomposition.
- `app/(app)/social/[pageId]/page.tsx`: 2433 lines.
- `app/(app)/inventory/InventoryTable.tsx`: 2044 lines.
- `app/(app)/employee-info/page.tsx`: 2034 lines.
- `app/(app)/tasks/page.tsx`: 1945 lines.
- `app/(app)/tasks/[taskId]/page.tsx`: 1921 lines.

User/business impact:

- Large files make it harder to make UX fixes quickly without regressions.
- They increase bundle and hydration risk when client components collect too many responsibilities.
- They make reviews and tests less precise, which raises the chance of customer-visible bugs.

Recommended fix:

- Start with tasks and note editor because they are both customer-critical and repeatedly touched.
- Split large files by responsibility: data loading, mutation actions, view state, table/list rows, dialogs, advanced controls, and reusable helpers.
- Move repeated server action validation/auth patterns into shared helpers.
- Add tests around extracted units before changing behavior.
- Done for the first task-list slice: `app/(app)/tasks/taskTableViewState.ts` extracts persisted table-column normalization, and `app/(app)/tasks/taskTableViewState.test.ts` covers storage normalization, allowed-value filtering, required-column handling, and the current fallback behavior.

Estimated effort: large.

Verification needed:

- No functional regression in task list/detail, notes editor save/load, image persistence, chat, and settings.
- Bundle/build comparison before and after major splits.

### F-006 - P2 - Security and Maintainability - Auth, profile, and permission checks are repeated heavily

Evidence:

- Static scan found 155 direct `supabase.auth.getUser()` calls.
- `app/(app)/settings/page.tsx` alone has repeated auth calls at lines including `216`, `766`, `875`, `932`, `1070`, `1233`, `1277`, `1315`, `1355`, `1637`, `1772`, `1810`, `1958`, `2036`, `2091`, `2159`, `2191`, `2477`, `2538`, and `2605`.
- Middleware does useful page permission work in `lib/supabase/middleware.ts:107` via `can_edit_page`.
- `lib/supabase/currentUser.ts` already provides a middleware-header-aware helper, but the pattern is not consistently used everywhere.
- First implementation slice added `lib/api/requireApiUser.ts` and converted `/api/briefing/quick-read`, `/api/tasks/[taskId]/hover`, and `/api/tasks/[taskId]/subtasks`. Static scan now finds 151 direct `supabase.auth.getUser()` calls, down from the original 155.
- Second implementation slice added `lib/api/requireApiAdmin.ts` and converted `/api/admin/users/update` plus `/api/admin/users/delete`. Static scan now finds 149 direct `supabase.auth.getUser()` calls.
- Third implementation slice added `lib/adminAccess.ts` and converted the admin landing page, admin users page, create-user server action, and user-permissions page/action. Static scan now finds 144 direct `supabase.auth.getUser()` calls.
- API helper hardening slice updated `getCurrentRequestUser` with an explicit forwarded-header trust option and made `requireApiUser`/`requireApiAdmin` pass `trustForwardedUserHeaders: false`, so API routes continue to verify Supabase sessions even though page helpers can reuse middleware-verified headers.
- Eleventh implementation slice converted app nav reorder, search suggestions, mention suggestions, chat uploads, chat link options, chat reactions, and chat read-marker API routes to `requireApiUser`. Static scan now finds 116 direct `supabase.auth.getUser()` calls overall and 21 under `app/api`.
- Twelfth implementation slice converted chat group/direct conversation creation, member add/remove, and preference update API routes to `requireApiUser`. Static scan now finds 111 direct `supabase.auth.getUser()` calls overall and 16 under `app/api`.
- Thirteenth implementation slice converted project task lookup, Outlook import preview/create, and browser task capture API routes to `requireApiUser`. Static scan now finds 107 direct `supabase.auth.getUser()` calls overall and 12 under `app/api`.
- Fourteenth implementation slice converted schedule shift reposition, personal section/page reorder, personal page duplicate/image upload, social read tracking, and social image upload API routes to `requireApiUser`. Static scan now finds 100 direct `supabase.auth.getUser()` calls overall and 5 under `app/api`.
- Fifteenth implementation slice converted chat message list/create/update/delete to `requireApiUser` and the help-guide admin API to trust-disabled `getCurrentRequestUser`. Static scan now finds 95 direct `supabase.auth.getUser()` calls overall and 0 under `app/api`.
- Sixteenth implementation slice converted inventory record/cell/column server actions to `getCurrentRequestUser`. Static scan now finds 88 direct `supabase.auth.getUser()` calls overall and none in `app/(app)/inventory/page.tsx`.
- Seventeenth implementation slice converted employee-info record/cell/column and visibility-rule server actions to `getCurrentRequestUser`. Static scan now finds 80 direct `supabase.auth.getUser()` calls overall and none in `app/(app)/employee-info/page.tsx`.
- Eighteenth implementation slice converted personal page load and server actions to `getCurrentRequestUser`. Static scan now finds 72 direct `supabase.auth.getUser()` calls overall and none in `app/(app)/personal/[pageId]/page.tsx`.
- Nineteenth implementation slice converted client overview page load, member/page-access actions, and legacy note creation to `getCurrentRequestUser`. Static scan now finds 68 direct `supabase.auth.getUser()` calls overall and none in `app/(app)/clients/[clientId]/page.tsx`.
- Twentieth implementation slice converted feature suggestion list/detail pages and create/update/comment/vote actions to `getCurrentRequestUser`. Static scan now finds 61 direct `supabase.auth.getUser()` calls overall and none under `app/(app)/feature-suggestions`.
- Twenty-first implementation slice converted personal editor content save, context-menu favorites, and create-task actions to `getCurrentRequestUser`. Static scan now finds 58 direct `supabase.auth.getUser()` calls overall and none in `app/(app)/personal/[pageId]/editorActions.ts`.
- Fourth implementation slice added `lib/pageEditAccess.ts` and converted the settings assignment-group create/update/delete server actions. Static scan found 141 direct `supabase.auth.getUser()` calls after that slice.
- Fifth implementation slice extended `lib/pageEditAccess.ts` usage to settings status-option create/update/delete server actions. Static scan now finds 138 direct `supabase.auth.getUser()` calls.
- Sixth implementation slice extended `lib/pageEditAccess.ts` usage to settings task-template create/update/delete server actions. Static scan now finds 135 direct `supabase.auth.getUser()` calls.
- Seventh implementation slice extended `lib/pageEditAccess.ts` usage to settings project-template create/update/delete server actions. Static scan found 132 direct `supabase.auth.getUser()` calls after that slice.
- Eighth implementation slice added settings page-edit checks to template custom-field create/delete/save server actions. This closes missing permission checks rather than reducing the direct auth-call count.
- Ninth implementation slice extended `lib/pageEditAccess.ts` usage to task-template subtask create/update/delete and project-template task link/unlink actions. Static scan now finds 127 direct `supabase.auth.getUser()` calls.
- Tenth implementation slice converted the settings page auth gate, profile update action, and notification-preference action to `getCurrentRequestUser`. Static scan now finds 124 direct `supabase.auth.getUser()` calls, with none left in `app/(app)/settings/page.tsx`.

User/business impact:

- Repeated auth lookups increase request latency and make permission bugs more likely.
- Developers have to reimplement the same redirect/error behavior in many places.

Recommended fix:

- Standardize on `requireCurrentUser`, `requirePageAccess`, and `requirePageEditAccess` helpers for server components, server actions, and route handlers.
- Return consistent error shapes from API routes.
- Use middleware-injected request user data where appropriate, while preserving Supabase `auth.getUser()` verification at trust boundaries.
- Done for the first API route slice: create `requireApiUser`, keep unauthorized route-handler responses consistent, and test middleware-header short-circuiting plus Supabase fallback behavior.
- Done for the admin API slice: create `requireApiAdmin`, keep admin route-handler 401/403 responses in the existing `{ ok: false, error }` shape, and convert the admin user update/delete endpoints.
- Done for the API helper hardening slice: force Supabase auth verification inside `requireApiUser` and `requireApiAdmin` rather than trusting forwarded internal headers on `/api` routes.
- Done for the admin page/action slice: create `getAdminAccess`, keep page-level redirect/not-found behavior at the call sites, and convert admin landing, user-management, create-user, and page-permission flows.
- Done for the settings action slices: create `getPageEditAccess`, keep unauthenticated and no-permission redirects or autosave errors at the call sites, and convert assignment-group, status-option, task-template, task-template subtask, project-template, project-template task link/unlink, and template custom-field actions.
- Done for the settings current-user slice: convert settings page/profile/notification auth gates to `getCurrentRequestUser` instead of direct Supabase auth calls.

Estimated effort: medium.

Verification needed:

- Tests for unauthenticated, authenticated/no-permission, and authenticated/allowed states across pages, server actions, and API routes.
- Added for the first slice: `lib/supabase/currentUser.test.ts` and `lib/api/requireApiUser.test.ts` cover trusted middleware headers, invalid-header fallback, missing users, consistent 401 JSON, and custom unauthorized messages.
- Added for the API helper hardening slice: `lib/supabase/currentUser.test.ts`, `lib/api/requireApiUser.test.ts`, and `lib/api/requireApiAdmin.test.ts` assert that API auth helpers call `getCurrentRequestUser` with forwarded-header trust disabled.
- Added for the admin API slice: `lib/api/requireApiAdmin.test.ts` covers admin success, unauthenticated requests, non-admin requests, email-based profile lookup, and response shape. Local smoke confirmed both changed admin endpoints still return the expected unauthenticated 401 JSON.
- Added for the admin page/action slice: `lib/adminAccess.test.ts` covers admin success, unauthenticated requests, non-admin requests, and email-based profile lookup. Local smoke confirmed converted admin pages still redirect unauthenticated users to `/login`.
- Added for the settings action slice: `lib/pageEditAccess.test.ts` covers allowed page edits, unauthenticated requests, and forbidden page-edit checks. Local smoke confirmed `/settings` still redirects unauthenticated users to `/login`.
- Manual checks for admin, tasks, projects, employee info, inventory, personal pages, social pages, and chat.

### F-007 - P2 - Performance - Login quick-read does multiple broad reads immediately after sign-in

Evidence:

- `app/(app)/_components/LoginQuickReadPrompt.tsx:105` fetches `/api/briefing/quick-read` after login.
- Original `app/api/briefing/quick-read/route.ts` read `task_assignees` first and then queried `tasks`, both capped at 600 rows.
- Implemented RPC slice adds `supabase/migrations/20260602140000_login_quick_read_tasks_rpc.sql` and `sql/login_quick_read_tasks_rpc.sql`, plus `lib/loginQuickReadTaskRows.ts` to prefer the RPC and fall back only for compatibility.
- Original task query limited task reads to 600 rows without a due-date cutoff; the implemented date-window slice now applies `.lte("due_date", taskDueDateCutoff)` before summarizing.
- `app/api/briefing/quick-read/route.ts:104` still reads notifications for mentions.
- Recent production timing checks put `/api/briefing/quick-read` around 0.76s to 1.24s.

User/business impact:

- The first authenticated experience can feel slow because a convenience prompt competes with the main page for data and network time.
- The row caps will become less predictable as task and assignment volume grows.

Recommended fix:

- Done for the first performance slice: add a local next-24-hour task due-date cutoff before reading task rows.
- Done for the assignment lookup slice: replace the multi-query task-assignment read with the bounded `login_quick_read_tasks` SQL RPC, backed by primary-assignee due-date and task-assignee indexes.
- Further option: move mention counts into the same summary RPC if quick-read still misses the production timing target.
- Cache the result briefly per user or only fetch when the prompt is eligible to display.
- Avoid reading large assignment sets just to identify the current user's relevant tasks.

Estimated effort: medium.

Verification needed:

- Unit coverage exists for quick-read task cutoff, hidden-status filtering, overdue/due-soon splitting, sorting, URLs, and fallback titles.
- Added for the RPC slice: `lib/loginQuickReadTaskRows.test.ts` covers RPC preference, missing-RPC compatibility fallback, de-duped secondary assignment IDs, bounded query limits, fallback primary-assignee filtering, and RPC error logging.
- Production timing target below 300 ms p95 for the quick-read route.
- Verify unread mention counts, overdue tasks, due-soon tasks, and dismissed prompt state.

### F-008 - P2 - Test Gaps - Critical customer flows lack end-to-end coverage

Evidence:

- `npm test` passes 24 files and 138 tests.
- Latest unit-test suite now passes 39 files and 191 tests after the quick task, admin API/page access, API auth hardening, settings page-edit, task table view-state, and quick-read task RPC coverage slices.
- Coverage is useful but uneven: overall branch coverage is 60.34%.
- Low-coverage examples from `npm run test:coverage`:
  - `lib/vercelLogger.ts`: 7.14% statements.
  - `lib/statusOptions.ts`: 12.79% statements.
  - `lib/recurrence.ts`: 42.85% statements.
  - `lib/taskSorting.ts`: 48.8% statements.
  - `lib/tasks/createTaskLikeRoot.ts`: 59.01% statements.
- There is no evidence from this pass of browser-level coverage for the most important task creation/editing workflow.

User/business impact:

- The app can pass unit tests while `/tasks` still flashes red errors or task creation still feels broken.
- Recurrence, sorting, and task creation are exactly the areas where small bugs are visible to customers.

Recommended fix:

- Add Playwright smoke tests for login, `/tasks`, quick add task, task notes, subtask add, task detail open, and close.
- Done for the first server-action slice: add direct `quickCreateTaskAction` tests for authorization, disabled users, validation errors, notes, subtasks, assignee rows, and `/tasks` revalidation.
- Continue server-action tests for recurrence defaults, richer task mutations, permissions, and validation errors outside the quick-create path.
- Raise coverage around `recurrence`, `taskSorting`, `statusOptions`, and `createTaskLikeRoot`.

Estimated effort: medium.

Verification needed:

- New tests run in CI and locally.
- Added for the first slice: `app/(app)/tasks/actions.test.ts` runs in the normal Vitest suite.
- At least one browser test fails if `/tasks` renders a red error state.

### F-009 - P2 - Observability - Console logging is noisy and inconsistent

Evidence:

- Original static scan found 93 `console.log/error/warn/info` calls in `app`, `lib`, and `supabase`; after the personal image/editor and API route logging slices this is down to 71, with 0 direct `console.*` calls remaining under `app/api`.
- `app/(app)/_components/NoteEditorClient.tsx` still contains image debug log call sites, but they now require `NEXT_PUBLIC_NOTE_IMAGE_DEBUG=1`; save-coordinator debug logging now requires `NEXT_PUBLIC_NOTE_SAVE_DEBUG=1`.
- `app/api/personal/pages/[pageId]/images/route.ts` no longer logs successful uploads via `console.error`; upload failure paths now use `logWarn`/`logError` from `lib/vercelLogger.ts`.
- `app/api/briefing/quick-read/route.ts`, `app/api/chat/messages/route.ts`, `app/api/projects/[projectId]/tasks/route.ts`, and `app/api/tasks/[taskId]/subtasks/route.ts` now use structured `logError` diagnostics instead of direct `console.error`.
- `lib/vercelLogger.test.ts` now covers structured output, redaction, log-level filtering, errors, and bigint serialization.

User/business impact:

- Real errors are harder to find in production logs when success/debug events use `console.error`.
- Missing structured fields make incident debugging slower, especially for customer-reported red error flashes.

Recommended fix:

- Done for the personal image upload/save path: route server failure logs through one structured logger with levels and safe context fields.
- Done for note editor image/save diagnostics: gate client debug logs behind explicit development/debug flags.
- Done for the personal image upload path: stop using `console.error` for successful operations.
- Done for the logger core: add tests for logger formatting, redaction, level filtering, error serialization, and bigint serialization.
- Done for the API route slice: remove direct `console.*` calls from `app/api` and preserve customer-critical failure context as structured event fields.
- Continue migrating the remaining console inventory by product area instead of doing one risky mechanical rewrite.

Estimated effort: small to medium.

Verification needed:

- Production log sample shows no expected-success `error` events for personal image uploads.
- Simulated personal image upload failures emit one structured warning/error with enough context to debug it.
- API route static scan stays at 0 direct `console.*` calls.
- Continue with broader page/server-action logging checks for task creation and other customer-critical flows.

### F-010 - P2 - Security and Scalability - Security-definer and RLS surface needs an inventory and regression tests

Evidence:

- Static scan found 128 `security definer` occurrences and 52 `enable row level security` occurrences in migrations.
- The implemented inventory slice found 128 actual security-definer declarations, 52 RLS-enable occurrences, and 225 policy creation statements. All security-definer declarations in migrations have a nearby `set search_path`.
- Dense modules include schedules, quizzes, social workspace, inventory, task audit, assignment groups, and scout.
- Examples:
  - `supabase/migrations/20260225140000_schedules_module.sql` has many `security definer` functions and RLS policies.
  - `supabase/migrations/20260227170000_quizzes_module.sql` has many quiz security-definer functions and RLS policies.
  - `supabase/migrations/20260221130500_social_workspace.sql` has social-page access functions and policies.

User/business impact:

- RLS is a major safety boundary for customer data. Large policy/function surfaces are hard to audit informally.
- A single `security definer` function with weak tenant/user checks can bypass otherwise-correct RLS.

Recommended fix:

- Done for the first slice: create `docs/security-definer-rls-inventory-2026-06-02.md` with migration counts, module grouping, caller surfaces, highest-risk review queue, and live catalog verification SQL.
- Continue by listing live function owners, final grants, and tenant/user checks from the actual database catalog.
- Add SQL regression tests for representative allowed/denied access per module.
- Require new `security definer` functions to include explicit `set search_path` and a documented caller/access model.

Estimated effort: large.

Verification needed:

- Completed for the first slice: static migration scans for security-definer declarations, RLS enables, policy creation, nearby `set search_path`, and `.rpc(...)` app callers.
- SQL tests prove cross-user and cross-client access is denied for tasks, schedules, quizzes, social pages, inventory, employee info, and chat.
- Formal Codex Security scan can follow after the inventory exists.

### F-011 - P2 - Security - Cron authorization should be environment-explicit

Evidence:

- `lib/cron.ts:3` authorizes a request when `x-vercel-cron` is present.
- `lib/cron.ts:7` falls back to `CRON_SECRET`.
- `lib/cron.test.ts:25` intentionally covers `x-vercel-cron`.
- Cron routes use service-role access, for example `app/api/cron/recurring-tasks/route.ts:70` and `app/api/cron/task-reminders/route.ts:28`.

User/business impact:

- Cron routes are privileged because they use service-role credentials.
- If the `x-vercel-cron` assumption is wrong in any non-Vercel or preview environment, a spoofed header could execute privileged maintenance code.

Recommended fix:

- Confirm Vercel's runtime guarantee for `x-vercel-cron` in production and previews.
- Consider requiring `CRON_SECRET` unless `VERCEL_ENV=production` and the deployment is known to be Vercel Cron.
- Log authorization mode at debug/info level without exposing secrets.

Estimated effort: small.

Verification needed:

- Unit tests for production Vercel header, missing secret, invalid secret, valid bearer secret, and preview/local behavior.
- Manual route call without secret is rejected in non-production.

### F-012 - P2 - Performance and Scalability - Several list/table pages likely load too much in one request

Evidence:

- Large list/table surfaces include `app/(app)/inventory/InventoryTable.tsx` at 2044 lines, `app/(app)/employee-info/EmployeeInfoTable.tsx` at 1880 lines, `app/(app)/tasks/TasksView.tsx` at 2492 lines, and `app/(app)/projects/ProjectsView.tsx` at 1876 lines.
- `app/(app)/settings/page.tsx` is 4304 lines and contains many management forms/actions.
- Quick-read already uses 600-row caps, showing that unbounded or broad reads have become a product concern.
- Implemented Forms slice: `app/(app)/forms/page.tsx` now calls `forms_list_page` with `p_limit`/`p_offset` and no longer pulls all forms plus all open submissions into application memory for the list view.
- Implemented Social slice: `app/(app)/social/page.tsx` now calls `social_landing_page` with `p_limit`/`p_offset` and no longer pulls every accessible social page plus membership/summary/post data across the full page ID set for the landing view.

User/business impact:

- As customer datasets grow, pages that feel acceptable in small accounts will become slow, memory-heavy, and more error-prone.
- Big tables without server-side pagination and targeted counts create unpredictable p95 latency.

Recommended fix:

- Audit every list page for pagination, indexed sort columns, count strategy, and search strategy.
- Use server-side pagination or cursor pagination by default.
- Move expensive counts into RPCs or cached summary tables where exact live counts are not necessary.
- Done for Forms: add `forms_list_page`, indexed open-submission counts, page controls, and a bounded fallback.
- Done for Social landing: add `social_landing_page`, indexed page ordering, summary counters, page controls, and a bounded fallback.
- Continue with large table/component refactors and production query-plan checks.

Estimated effort: medium to large.

Verification needed:

- Seed or staging account with large datasets.
- Timing budgets for inventory, employee info, tasks, projects, forms, social, and chat.
- Query plans for the slowest Supabase queries.
- Forms and Social RPC migrations need to be applied to the remote Supabase database before production stops using compatibility fallbacks.

### F-013 - P3 - Build Tooling - `next lint` is deprecated

Evidence:

- Original finding: `package.json:9` defined `"lint": "next lint"`.
- Original finding: `npm run lint` passed but printed the Next.js deprecation warning that `next lint` will be removed in Next 16.
- Implemented migration: `package.json` now defines `"lint": "eslint ."`, `eslint.config.mjs` preserves the Next `core-web-vitals` and `typescript` rule sets, and generated/build artifacts are explicitly ignored.

User/business impact:

- This is not a current customer bug, but it will become upgrade friction.
- It can hide lint regressions during a future Next upgrade.

Recommended fix:

- Done: migrate to the ESLint CLI using an explicit ESLint flat config.
- Keep the same rule behavior before tightening rules.

Estimated effort: small.

Verification needed:

- Done: `npm run lint` passes with the ESLint CLI and no deprecation warning.

### F-014 - P3 - Code Health - React hook dependency lint disables exist in important tables/views

Evidence:

- Original scan found `react-hooks/exhaustive-deps` disables in `app/(app)/projects/ProjectsView.tsx`, `app/(app)/clients/ClientsTable.tsx`, `app/(app)/feature-suggestions/FeatureSuggestionsTable.tsx`, and `app/(app)/tasks/TasksView.tsx`.
- Current static scan finds 0 `react-hooks/exhaustive-deps` disables.

User/business impact:

- Hook dependency issues often become stale UI state, missed refreshes, or repeated requests.
- These files sit on important customer workflows.

Recommended fix:

- Done: removed the stale task-table disable during the lint migration.
- Done: removed the remaining feature suggestion, client, and project disables by making the saved-default-view effects self-contained and dependency-complete.

Estimated effort: small to medium.

Verification needed:

- `npm run lint` passes with no `react-hooks/exhaustive-deps` disables present in `app` or `lib`.
- Follow-up browser coverage should still exercise filters, sorting, inline updates, and default-view redirects in these table/view surfaces.

### F-015 - P3 - Operations - Project documentation is thin for production operations

Evidence:

- `README.md` still reads like a generic Next.js project starter rather than an operational guide.
- Existing docs cover specific areas such as Vercel logging, browser extension, social scope, and responsive QA, but not the main setup/deploy/runbook path.
- The first implementation slice replaced the starter README with a ResOpsHub operations runbook.

User/business impact:

- Production debugging and onboarding are slower when environment variables, Supabase migrations, cron, deploy process, and smoke checks are not documented in one place.
- This increases the risk that future fixes are made against the wrong environment.

Recommended fix:

- Done: replace the generic README with a ResOpsHub runbook covering local setup, required environment variables, Supabase migration process, Vercel deployment, cron route setup, smoke checks, observability, and known high-risk modules.

Estimated effort: small.

Verification needed:

- README now includes setup, deploy, cron, and smoke-test checklists.
- Follow-up: a fresh-checkout dry run and production deploy dry run can validate whether any team-specific dashboard steps are missing.

## Larger Refactor Roadmap

Phase 1: Safety and speed foundations.

- Patch audited dependencies.
- Centralize search/filter construction.
- Centralize upload validation.
- Add browser smoke tests for tasks and login.
- Add a structured logging standard.

Phase 2: Task workflow overhaul.

- Make quick-add a fast client modal/drawer focused on title and notes.
- Hide recurrence behind an advanced section.
- Add subtasks as an optional dropdown/disclosure after the main fields.
- Return created task data without reloading the full list.
- Keep detail pages route-addressable, but avoid list-page prefetch churn.

Phase 3: Data and permissions consolidation.

- Introduce shared request/auth/action helpers.
- Inventory service-role and security-definer surfaces.
- Add SQL/RLS regression tests for top modules.
- Move broad list queries to paginated RPCs or well-indexed server queries.

Phase 4: Component and module cleanup.

- Split `NoteEditorClient`, settings, chat, tasks, social, inventory, and employee-info into smaller units.
- Remove stale debug logs and unnecessary lint disables.
- Improve operational documentation.

## Security and Dependency Upgrade List

Immediate:

- `next@15.5.15` -> `next@15.5.18`.
- `vitest@4.0.18` -> non-vulnerable release outside `<4.1.0`.
- `@vitest/coverage-v8@4.0.18` -> version compatible with the upgraded Vitest.
- Verify transitive `postcss` and `ws` findings are removed or separately overridden/upgraded.

Security follow-ups:

- Replace raw `.or()` filters around user input.
- Standardize image MIME allow-list and SVG blocking/sanitization.
- Inventory service-role clients and security-definer functions.
- Confirm cron route authorization assumptions.
- Add RLS regression tests for major modules.

## Deferred Formal Scan

This review found enough security-sensitive surface area to justify a formal exhaustive scan as a follow-up, especially around:

- Supabase/PostgREST filter construction.
- Upload and rich-editor SVG/image handling.
- Service-role routes and helper usage.
- Security-definer functions and RLS.
- Middleware/header trust assumptions after the Next framework upgrade.

That scan should use the formal Codex Security workflow with threat model, finding discovery, validation, attack-path analysis, coverage ledgers, and final markdown/HTML reports. It was intentionally not bundled into this document because the requested output was a pragmatic engineering backlog.
