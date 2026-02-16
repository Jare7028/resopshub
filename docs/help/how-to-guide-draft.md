# ResOpsHub How-To Guide (Draft)

This is a first-pass user-facing guide that can be published in an in-app `/help` section.

## 1) Dashboard

### What it is for
Track operational load and delivery trends from one place.

### How to use it

1. Open `/dashboard`.
2. Set your time range (`All time`, `Last 7 days`, `Last 30 days`, `Last 90 days`).
3. Narrow by client, project, user, status, and priority.
4. Review counts and trend blocks to spot bottlenecks.

### Tips

1. Filters are saved in a dashboard cookie, so your defaults persist.
2. Use broad filters first, then narrow to a client/project for root-cause review.

## 2) Clients

### What it is for
Manage each client record and all related work (projects, tasks, notes, billing, docs).

### How to use it

1. Open `/clients`.
2. Use search + status/industry filters to find the right account.
3. Switch view mode (`table`, `board`, `gantt`) depending on planning need.
4. Click `New client` to create a record.
5. Open a client and use tabs:
   - `Overview`
   - `Contacts`
   - `Billing`
   - `Projects`
   - `Tasks`
   - `Notes`
   - `Documents`
   - `Requirements`
   - `KPIs`

### Tips

1. Keep client status current so board and gantt views stay useful.
2. Use client tabs instead of separate global lists when working account-by-account.

## 3) Projects

### What it is for
Plan and track workstreams under clients.

### How to use it

1. Open `/projects`.
2. Filter by client/status/assignee.
3. Use `Hide completed` and `Watching` toggles to reduce noise.
4. Add a project:
   - `new` mode for scratch setup
   - `template` mode for standardized setup
5. Open a project and use tabs:
   - `Overview` (details + custom fields)
   - `Assignees`
   - `Tasks`

### Tips

1. Use templates for repeatable delivery patterns.
2. Keep project status aligned to actual progress so board lanes remain actionable.

## 4) Tasks

### What it is for
Track action items, deadlines, owners, and subtasks.

### How to use it

1. Open `/tasks`.
2. Filter by status, priority, assignee, due window, client, project.
3. Switch view mode (`table`, `board`, `gantt`) based on planning style.
4. Use `Add task` to create:
   - new task
   - template-based task
5. Configure recurrence when needed (frequency, lead days, timezone).
6. Open a task to manage:
   - `Details`
   - `Assignees`
   - `Watchers`
   - `Subtasks`
   - `Notes`

### Tips

1. Use subtasks for multi-step execution.
2. Use watchers for visibility when someone is not directly assigned.
3. Keep due dates accurate to make overdue/next-7 filters meaningful.

## 5) Forms

### What it is for
Collect structured inputs and trigger follow-up tasks automatically.

### How to use it

1. Open `/forms`.
2. In `Create form`, define:
   - title/description/status
   - fields via builder (text, number, date, dropdown)
   - required flags and field conditions
3. Add task triggers:
   - manual task definitions
   - task template references
4. Save and open form detail.
5. Use tabs:
   - `Submissions` (review queue)
   - `Configure` (edit structure and triggers)
   - `Create submission` (manual entry)
6. Open a submission to update status, inspect values, and comment.

### Tips

1. Keep field keys stable after launch to avoid downstream mapping issues.
2. Test conditional fields with realistic sample submissions before rollout.

## 6) Chat

### What it is for
Team collaboration through direct and group conversations.

### How to use it

1. Open `/chat`.
2. Create `Direct` or `Group` conversation from Add panel.
3. Send messages with:
   - text
   - attachments
   - links to entities (tasks/projects/clients/notes/suggestions)
4. React to messages with emoji.
5. Use left-side search to filter conversations.

### Tips

1. Use links to anchor discussions to specific work items.
2. Keep conversation titles descriptive for group threads.

## 7) Personal

### What it is for
Private/team-shared workspace for notes, planning pages, and personal knowledge.

### How to use it

1. Open `/personal`.
2. Manage `Sections` to organize work areas.
3. Manage `Pages` inside sections.
4. Filter pages by section, sharing mode, and updated range.
5. Open a page and use tabs:
   - `Notes` (editor)
   - `Section members`
   - `Page members`
6. In editor, use:
   - rich text formatting
   - shapes/text boxes
   - quick task creation from content

### Tips

1. Use section-level sharing for broad collaboration.
2. Use page-level sharing for exceptions.
3. Keep page titles clean because linked client notes can inherit them.

## 8) Notes

### What it is for
Cross-client note index and discovery.

### How to use it

1. Open `/notes`.
2. Filter by client, editor/user, and date range.
3. Open a note to edit full content when page-backed note mode is enabled.

### Tips

1. Use `/notes` for discovery and `/clients/:id/notes` for focused account work.
2. If note pages are unavailable, check migrations for note-page support.

## 9) Feature Suggestions

### What it is for
Collect, prioritize, and track internal product ideas.

### How to use it

1. Open `/feature-suggestions`.
2. Submit a suggestion with title, type, and details.
3. Vote up/down to signal priority.
4. Filter by status/type and sort by title/status/type/score/date.
5. Open an idea to:
   - edit details
   - change status/type
   - add comments

### Tips

1. Use concise titles and specific descriptions to reduce duplicate ideas.
2. Keep status current so roadmap reviews stay accurate.

## 10) Search

### What it is for
Find information across personal pages and task notes.

### How to use it

1. Use top-bar global search for quick suggestions.
2. Open `/search` for full results.
3. Filter by:
   - type (`all`, `personal`, `task`)
   - section
   - client
4. Re-run historical queries from `Recent searches`.

### Tips

1. Start broad, then narrow with section/client filters.
2. Use recent searches as saved pivots for repeated reporting needs.

## 11) Settings

### What it is for
Personal configuration and system-level workflow setup.

### How to use it

1. Open `/settings`.
2. Use tabs:
   - `Profile`
   - `Notifications`
   - `Statuses`
   - `Templates`
3. In Templates:
   - manage task and project templates
   - configure template custom fields
   - manage template subtasks/assignees/task links

### Tips

1. Set statuses before scaling team usage.
2. Use templates to enforce standard project/task structures.

## 12) Admin (Admin Role)

### What it is for
User provisioning and access control.

### How to use it

1. Open `/admin`.
2. Go to `/admin/users`.
3. Create users with email, temp password, role, and status.
4. Update role/status as responsibilities change.

### Tips

1. Ensure `SUPABASE_SERVICE_ROLE_KEY` is configured for user creation.
2. Keep role assignments minimal by default and escalate only when required.

## 13) Linked Personal -> Client Notes

### What it is for
Expose the same note content in both personal and client contexts when linked.

### Expected behavior

1. If a client note has `source_personal_page_id`, editing should act on the personal page content.
2. Title updates sync across linked records.
3. Opening the note from either path should show the latest shared content.

### Troubleshooting checks

1. Confirm `source_personal_page_id` is set on the note.
2. Confirm user can access the linked personal page.
3. If linked page is unavailable, app should fall back to cached note content.
