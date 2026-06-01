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
- 24 test files.
- 155 direct `supabase.auth.getUser()` calls.
- 41 `createSupabaseAdminClient` references.
- 128 `security definer` migration occurrences.
- 52 `enable row level security` migration occurrences.
- 93 `console.log/error/warn/info` calls in `app`, `lib`, and `supabase`.
- 4 `react-hooks/exhaustive-deps` lint disables.

## Quick Wins

1. Upgrade `next` from `15.5.15` to `15.5.18`, then rebuild and redeploy.
2. Upgrade `vitest` and `@vitest/coverage-v8` from `4.0.18` to a non-vulnerable release.
3. Replace user-input `.or()` string interpolation with RPCs or a shared PostgREST filter escaping helper.
4. Apply the social upload MIME allow-list pattern to chat, personal-page, note, and avatar uploads.
5. Remove debug image/editor logs or put them behind a structured logger and environment-controlled log level.
6. Migrate `next lint` to ESLint CLI before the next framework upgrade.
7. Add a Playwright smoke test for login, `/tasks`, quick add task, open task, and save task notes.

## Implementation Progress

Updated 2026-06-01:

- Completed: F-001 dependency security upgrades. `npm audit --json` now reports 0 vulnerabilities.
- Completed: F-002 for the user-facing search/filter paths called out in the finding. Search suggestions, search fallback, mentions, forms, and feature suggestions now use a shared PostgREST filter helper with regression tests.
- Completed: F-003 upload MIME handling. Chat, personal-page images, social images, note image persistence, note rendering, profile avatars, and client upload controls now share an explicit PNG/JPEG/WebP/GIF/AVIF policy and block SVG by default.
- Completed: F-011 cron authorization tightening. `x-vercel-cron` is now trusted only on production Vercel deployments; other environments require `CRON_SECRET`.
- Completed: F-004 task quick-add slice. The default `/tasks` add flow now opens a focused client modal for title, notes, and optional subtasks, backed by a dedicated server action that returns the created task summary without forcing the route-modal flow. The existing `/tasks?tab=add` route remains available as Advanced options for recurrence/templates/full metadata.
- Open: F-004 follow-up for other route-driven modal workflows outside the default task quick-add path.
- Open: F-005 through F-015 except F-011. These remain the main refactor, test, observability, docs, and tooling backlog.

Latest implementation validation:

- `npx tsc --noEmit`: passed.
- `npm test`: passed, 27 files and 150 tests.
- `npm run lint`: passed.
- `npm run build`: passed on Next.js 15.5.18. `/tasks` built at 4.36 kB route JS and 129 kB first load JS.
- `npm audit --json`: passed with 0 vulnerabilities.
- Local browser smoke on a clean port reached the expected unauthenticated `/tasks` -> `/login` 307 redirect. Modal interaction still needs a signed-in browser smoke test or Playwright-auth fixture.

## Suggested Order of Implementation

1. F-001 dependency security upgrades.
2. F-002 raw Supabase filter composition.
3. F-003 image upload and SVG handling.
4. F-004 task and route-modal performance.
5. F-005 auth/permission helper consolidation.
6. F-006 tests for task creation and critical server actions.
7. F-007 quick-read endpoint performance.
8. F-008 large-file refactors, starting with the task and note editor areas.
9. F-009 security-definer/RLS inventory.
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
- `app/(app)/tasks/TasksView.tsx`: 2492 lines.
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

User/business impact:

- Repeated auth lookups increase request latency and make permission bugs more likely.
- Developers have to reimplement the same redirect/error behavior in many places.

Recommended fix:

- Standardize on `requireCurrentUser`, `requirePageAccess`, and `requirePageEditAccess` helpers for server components, server actions, and route handlers.
- Return consistent error shapes from API routes.
- Use middleware-injected request user data where appropriate, while preserving Supabase `auth.getUser()` verification at trust boundaries.

Estimated effort: medium.

Verification needed:

- Tests for unauthenticated, authenticated/no-permission, and authenticated/allowed states across pages, server actions, and API routes.
- Manual checks for admin, tasks, projects, employee info, inventory, personal pages, social pages, and chat.

### F-007 - P2 - Performance - Login quick-read does multiple broad reads immediately after sign-in

Evidence:

- `app/(app)/_components/LoginQuickReadPrompt.tsx:105` fetches `/api/briefing/quick-read` after login.
- `app/api/briefing/quick-read/route.ts:98` reads `task_assignees` and `app/api/briefing/quick-read/route.ts:101` limits to 600 rows.
- `app/api/briefing/quick-read/route.ts:122` limits task reads to 600 rows.
- `app/api/briefing/quick-read/route.ts:195` reads notifications for mentions.
- Recent production timing checks put `/api/briefing/quick-read` around 0.76s to 1.24s.

User/business impact:

- The first authenticated experience can feel slow because a convenience prompt competes with the main page for data and network time.
- The row caps will become less predictable as task and assignment volume grows.

Recommended fix:

- Replace the multi-query route with a small RPC or summary view that returns only counts and the top few items.
- Cache the result briefly per user or only fetch when the prompt is eligible to display.
- Avoid reading large assignment sets just to identify the current user's relevant tasks.

Estimated effort: medium.

Verification needed:

- Production timing target below 300 ms p95 for the quick-read route.
- Verify unread mention counts, overdue tasks, due-soon tasks, and dismissed prompt state.

### F-008 - P2 - Test Gaps - Critical customer flows lack end-to-end coverage

Evidence:

- `npm test` passes 24 files and 138 tests.
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
- Add server-action tests for task creation, recurrence defaults, subtasks, permissions, and validation errors.
- Raise coverage around `recurrence`, `taskSorting`, `statusOptions`, and `createTaskLikeRoot`.

Estimated effort: medium.

Verification needed:

- New tests run in CI and locally.
- At least one browser test fails if `/tasks` renders a red error state.

### F-009 - P2 - Observability - Console logging is noisy and inconsistent

Evidence:

- Static scan found 93 `console.log/error/warn/info` calls in `app`, `lib`, and `supabase`.
- `app/(app)/_components/NoteEditorClient.tsx` contains many image debug logs, including lines `2864`, `2878`, `2892`, `2920`, `3062`, `3082`, `3893`, and others.
- `app/api/personal/pages/[pageId]/images/route.ts:213` logs upload success via `console.error`.
- `lib/vercelLogger.ts` exists but has very low coverage from `npm run test:coverage`.

User/business impact:

- Real errors are harder to find in production logs when success/debug events use `console.error`.
- Missing structured fields make incident debugging slower, especially for customer-reported red error flashes.

Recommended fix:

- Route server logs through one structured logger with levels, request IDs, user IDs where safe, route names, and error codes.
- Remove client debug logs or gate them behind a development flag.
- Stop using `console.error` for successful operations.
- Add tests for logger formatting and redaction.

Estimated effort: small to medium.

Verification needed:

- Production log sample shows no expected-success `error` events.
- Simulated task creation failure emits one structured error with enough context to debug it.

### F-010 - P2 - Security and Scalability - Security-definer and RLS surface needs an inventory and regression tests

Evidence:

- Static scan found 128 `security definer` occurrences and 52 `enable row level security` occurrences in migrations.
- Dense modules include schedules, quizzes, social workspace, inventory, task audit, assignment groups, and scout.
- Examples:
  - `supabase/migrations/20260225140000_schedules_module.sql` has many `security definer` functions and RLS policies.
  - `supabase/migrations/20260227170000_quizzes_module.sql` has many quiz security-definer functions and RLS policies.
  - `supabase/migrations/20260221130500_social_workspace.sql` has social-page access functions and policies.

User/business impact:

- RLS is a major safety boundary for customer data. Large policy/function surfaces are hard to audit informally.
- A single `security definer` function with weak tenant/user checks can bypass otherwise-correct RLS.

Recommended fix:

- Create a database security inventory listing every `security definer` function, its owner, `search_path`, caller routes, and tenant/user checks.
- Add SQL regression tests for representative allowed/denied access per module.
- Require new `security definer` functions to include explicit `set search_path` and a documented caller/access model.

Estimated effort: large.

Verification needed:

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

User/business impact:

- As customer datasets grow, pages that feel acceptable in small accounts will become slow, memory-heavy, and more error-prone.
- Big tables without server-side pagination and targeted counts create unpredictable p95 latency.

Recommended fix:

- Audit every list page for pagination, indexed sort columns, count strategy, and search strategy.
- Use server-side pagination or cursor pagination by default.
- Move expensive counts into RPCs or cached summary tables where exact live counts are not necessary.

Estimated effort: medium to large.

Verification needed:

- Seed or staging account with large datasets.
- Timing budgets for inventory, employee info, tasks, projects, forms, social, and chat.
- Query plans for the slowest Supabase queries.

### F-013 - P3 - Build Tooling - `next lint` is deprecated

Evidence:

- `package.json:9` defines `"lint": "next lint"`.
- `npm run lint` passed but printed the Next.js deprecation warning that `next lint` will be removed in Next 16.

User/business impact:

- This is not a current customer bug, but it will become upgrade friction.
- It can hide lint regressions during a future Next upgrade.

Recommended fix:

- Migrate to the ESLint CLI using the official Next codemod or an explicit ESLint config.
- Keep the same rule behavior before tightening rules.

Estimated effort: small.

Verification needed:

- `npm run lint` passes with the ESLint CLI and no deprecation warning.

### F-014 - P3 - Code Health - React hook dependency lint disables exist in important tables/views

Evidence:

- `app/(app)/tasks/TasksView.tsx:1124`
- `app/(app)/projects/ProjectsView.tsx:802`
- `app/(app)/clients/ClientsTable.tsx:557`
- `app/(app)/feature-suggestions/FeatureSuggestionsTable.tsx:315`

User/business impact:

- Hook dependency issues often become stale UI state, missed refreshes, or repeated requests.
- These files sit on important customer workflows.

Recommended fix:

- Review each disabled block.
- Extract stable callbacks/memos or narrow the effect scope until the disable can be removed.
- If a disable remains, add a precise comment explaining the invariant.

Estimated effort: small to medium.

Verification needed:

- Targeted interaction tests for filters, sorting, inline updates, and refresh behavior in each table/view.

### F-015 - P3 - Operations - Project documentation is thin for production operations

Evidence:

- `README.md` still reads like a generic Next.js project starter rather than an operational guide.
- Existing docs cover specific areas such as Vercel logging, browser extension, social scope, and responsive QA, but not the main setup/deploy/runbook path.

User/business impact:

- Production debugging and onboarding are slower when environment variables, Supabase migrations, cron, deploy process, and smoke checks are not documented in one place.
- This increases the risk that future fixes are made against the wrong environment.

Recommended fix:

- Replace the generic README with a ResOpsHub runbook:
  - local setup
  - required environment variables
  - Supabase migration process
  - Vercel deploy/promotion steps
  - cron route setup
  - smoke test checklist
  - known high-risk modules

Estimated effort: small.

Verification needed:

- A fresh checkout can be configured from the README.
- A deploy can be verified using the documented smoke checklist.

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
