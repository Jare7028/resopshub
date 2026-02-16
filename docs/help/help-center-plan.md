# Help Center Plan

## Goal
Create a clear, practical Help Center that explains:

- what each app section is for
- how to complete the most common workflows
- what to check when something does not behave as expected

This plan is designed to support onboarding, reduce repeated support questions, and make feature discovery easier for existing users.

## Recommended Delivery Model

### 1) Source Of Truth (authoring)
Store help content in versioned docs:

- `docs/help/feature-inventory.md` (what exists and what each area does)
- `docs/help/articles/*.md` (end-user guides, one article per topic)
- `docs/help/screenshot-runbook.md` (how screenshots are generated and maintained)

Why:

- easy to review in PRs
- easy to keep current with feature changes
- no dependency on CMS to start

### 2) In-App Help Surface
Add a `/help` section in the app that renders the guide content.

Recommended IA:

- `/help` (landing, quick links by app area)
- `/help/getting-started`
- `/help/clients`
- `/help/projects`
- `/help/tasks`
- `/help/forms`
- `/help/personal-notes`
- `/help/feature-suggestions`
- `/help/chat`
- `/help/settings-admin`
- `/help/search`

### 3) Screenshot Pipeline
Use automated screenshots for consistent visual guides, with manual overrides when needed.

- Script: `scripts/capture-help-screenshots.mjs`
- Default top-level screenshots for all primary nav routes
- Extra route support for dynamic pages (task detail, client detail, form detail, etc.)

## Scope Coverage (Current App)

Top-level sections covered by this plan:

1. Dashboard
2. Clients
3. Projects
4. Tasks
5. Forms
6. Chat
7. Personal
8. Notes
9. Feature Suggestions
10. Search
11. Settings
12. Admin

Cross-cutting areas:

1. Global navigation and search
2. Filters and saved table/view preferences
3. Template-driven workflows
4. Role/permission-sensitive behavior

## Article Structure Standard

Each guide article should follow the same structure:

1. **What This Section Is For**
2. **Before You Start** (permissions or prerequisites)
3. **Main Workflows**
4. **Key Screens And Controls**
5. **Common Mistakes**
6. **Troubleshooting**
7. **Related Guides**

## Screenshot Standard

Each article should include:

1. one overview screenshot (page context)
2. one workflow screenshot per key action
3. optional callout screenshot for advanced/edge settings

Naming convention:

- `NN-topic-step.png`
- Example: `03-tasks-filter-board.png`

## Rollout Plan

### Phase 1: Internal Draft

1. Finalize feature inventory and article outline.
2. Draft all core guides without screenshots.
3. Review with internal users for accuracy.

### Phase 2: Visual Documentation

1. Capture screenshots with staging/test data.
2. Insert screenshots and annotate where useful.
3. Validate links and route references.

### Phase 3: In-App Publishing

1. Expose `/help` in app navigation.
2. Add contextual "Need help?" links in complex sections (Forms, Tasks, Personal editor).
3. Track help article usage and support-ticket deflection.

## Acceptance Criteria

The Help Center is ready when:

1. Every top-level nav area has at least one guide article.
2. Every guide includes at least one end-to-end workflow.
3. Screenshots exist for all top-level routes plus priority detail pages.
4. No guide refers to unavailable UI controls.
5. A new team member can complete key workflows using only the Help Center.
