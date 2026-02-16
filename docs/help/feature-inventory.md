# Help Content Feature Inventory

This inventory maps current app functionality to help topics.

## Global Navigation

### Sidebar sections

1. Dashboard
2. Clients
3. Projects
4. Tasks
5. Forms
6. Chat
7. Personal
8. Notes
9. Feature Suggestions
10. Settings

### Global search bar

1. Typeahead suggestions from `/api/search/suggestions`
2. Jump-to-result behavior
3. Full search handoff to `/search`

## Dashboard (`/dashboard`)

### Primary user outcomes

1. Understand workload trends.
2. Track task distribution by status/priority.
3. Filter reporting by client/project/user/date range.

### Guide topics

1. Using dashboard filters (range, client, project, user, status, priority)
2. Reading KPI cards and charts
3. How saved dashboard filter cookies work

## Clients (`/clients`)

### List page

1. Multi-view modes: table, board, gantt
2. Filtering: search, status, industry
3. Sorting: name, status, industry, start
4. Default view preference persistence
5. Create new client
6. Delete client

### Client detail tabs (`/clients/:clientId/...`)

1. Overview
2. Contacts
3. Billing
4. Projects
5. Tasks
6. Notes
7. Documents
8. Requirements
9. KPIs

### Guide topics

1. Creating and maintaining client records
2. Choosing table vs board vs gantt view
3. Working inside client tabs
4. Client note workflows and visibility

## Client Notes (`/clients/:clientId/notes` and detail)

### Key capabilities

1. Create notes linked to client
2. Rich note editor
3. Optional live linkage to personal pages via `source_personal_page_id`
4. Note metadata updates (title, visibility)
5. Delete note
6. Create tasks from note content

### Guide topics

1. Creating a client note
2. Editing linked personal/client notes (single source behavior)
3. Using note editor actions (formatting, shapes, text boxes, task insertion)
4. Note visibility and sharing expectations

## Projects (`/projects`)

### List page

1. Multi-view modes: table, board, gantt
2. Filtering: client, status, assignee
3. Toggles: hide completed, include watching
4. Sorting: name, client, status, assignees, start/end, open tasks, created
5. Add project (new or template mode)
6. Default view preference persistence

### Project detail (`/projects/:projectId`)

1. Update project details (name, code, status, dates, budget)
2. Custom field CRUD (text/dropdown)
3. Tabs: overview, assignees, tasks
4. Delete project (permission-dependent)

### Guide topics

1. Creating projects from scratch vs templates
2. Managing project assignees and watchers
3. Working with project custom fields
4. Using project tasks tab effectively

## Tasks (`/tasks`)

### List page

1. Multi-view modes: table, board, gantt
2. Filtering: status, priority, assignee, due window, client, project
3. Toggles: hide completed, include watching
4. Sorting by task columns
5. Add task (new or template mode)
6. Recurrence setup (frequency/lead time/timezone)
7. Inline edits and status movement
8. Persisted table preferences (`user_task_table_preferences`)

### Task detail (`/tasks/:taskId`)

1. Tabs: details, assignees, watchers, subtasks, notes
2. Subtask management with list filters and views
3. Notes editor integration
4. Custom fields
5. Status/priority updates and assignment updates

### Guide topics

1. End-to-end task creation
2. Managing recurring tasks
3. Using subtasks for decomposition
4. Collaborating through assignees/watchers/notes

## Forms (`/forms`)

### List and create

1. Tabs: forms list, create form
2. Filter/sort forms
3. Create form with field builder
4. Conditional field logic support
5. Attach task templates/manual tasks for submission triggers

### Form detail (`/forms/:formId`)

1. Tabs: submissions, configure, create submission
2. Configure form metadata and fields
3. Configure post-submission task actions/templates
4. Create submissions
5. Submission list filtering/sorting (scope and columns)

### Submission detail (`/forms/submissions/:submissionId`)

1. Update submission status
2. View values JSON
3. See triggered tasks
4. Add comments

### Guide topics

1. Building a production-ready form
2. Using conditional fields correctly
3. Configuring task automation from form submissions
4. Reviewing and resolving submissions

## Chat (`/chat`)

### Key capabilities

1. Direct and group conversations
2. Message composer with links and attachments
3. Reactions
4. Unread tracking and read markers
5. Chat search (conversation list filtering)

### Guide topics

1. Starting direct/group conversations
2. Sharing references to tasks/projects/clients in chat
3. Managing unread and reactions

## Personal (`/personal` and `/personal/:pageId`)

### Personal home

1. Tabs: pages, sections
2. Section and page management
3. Section/page ordering
4. Filter pages by section/share mode/updated range
5. Template-based page creation support

### Personal page detail

1. Tabs: notes, section members, page members
2. Rich editor with custom context-menu favorites
3. Page-level and section-level sharing models
4. Linked note behavior with client notes
5. Create tasks from page content

### Guide topics

1. Structuring personal workspace with sections/pages
2. Sharing pages vs inheriting section sharing
3. Editor usage and layout tools (shapes/text boxes)
4. Linking personal pages to client-facing notes

## Notes (`/notes`)

### Key capabilities

1. Cross-client note index
2. Filters: client, user/editor, date range
3. Support both note-page and legacy rows
4. Direct navigation to note details when available

### Guide topics

1. Finding notes quickly across clients
2. Understanding editor/date filters
3. Legacy vs page-backed note behavior

## Feature Suggestions (`/feature-suggestions`)

### List page

1. Submit new suggestions (title/details/type)
2. Vote up/down
3. Comment count visibility
4. Editable status/type inline
5. Filtering/sorting and multi-view support
6. Hide completed toggle

### Detail page

1. Edit idea metadata (title/status/type/description)
2. Vote actions
3. Add comments

### Guide topics

1. Submitting high-quality suggestions
2. Voting and prioritization workflow
3. Status lifecycle (idea -> needs checking -> planned -> completed/rejected)

## Search (`/search`)

### Key capabilities

1. Full-text search across personal pages and task notes
2. Filters: type, section, client
3. Recent searches (re-runnable)
4. RPC-first search with fallback query path

### Guide topics

1. Running focused searches with filters
2. Using recent search shortcuts
3. Understanding result context labels

## Settings (`/settings`)

### Tabs

1. Profile
2. Notifications
3. Statuses
4. Templates

### Key capabilities

1. Update profile details
2. Manage notification preferences
3. Configure status options
4. Manage task/project templates
5. Configure template custom fields, subtasks, and assignees

### Guide topics

1. Notification setup by role
2. Status governance
3. Template strategy for scale

## Admin (`/admin`, `/admin/users`)

### Key capabilities

1. Admin landing with user management access
2. Create users (requires service role key)
3. Update user role/status
4. Restrict non-admin access

### Guide topics

1. Provisioning users safely
2. Role model and status controls
3. Common admin setup issues

## Suggested Help Article Set (V1)

1. Getting Started
2. Dashboard Reporting
3. Client Workspace
4. Project Operations
5. Task Management
6. Form Builder and Submissions
7. Personal Workspace and Linked Notes
8. Notes Index and Note Editing
9. Feature Suggestion Lifecycle
10. Team Chat
11. Search and Discovery
12. Settings and Templates
13. Admin User Management
