import { extractPlainText } from "../../../../lib/tiptapText";

export type HelpGuideSectionLink = {
  label: string;
  href: string;
};

export type HelpGuideSection = {
  id: string;
  title: string;
  content: unknown;
  links?: HelpGuideSectionLink[];
};

export type HelpGuide = {
  slug: string;
  title: string;
  summary: string;
  appPath: string;
  audience: string;
  estimatedTime: string;
  keywords: string[];
  prerequisites: string[];
  sections: HelpGuideSection[];
  related: string[];
};

export const HELP_QUICKSTART: string[] = [
  "Open Dashboard and scan active work by status and priority.",
  "Open Clients, then pick a client and review Projects, Tasks, and Notes tabs.",
  "Create one task, assign it, set a due date, then move it through statuses.",
  "Create one personal page and add notes so you have a reusable workspace.",
  "Use Search to find a task or note by keyword.",
  "Use Feature Suggestions to submit any product improvement ideas.",
];

const HELP_GUIDE_DEFINITIONS: unknown[] = [
  {
    slug: "getting-started",
    title: "Getting Started",
    summary:
      "A first-week walkthrough to set up your workspace and complete your first end-to-end workflow.",
    appPath: "/dashboard",
    audience: "All users",
    estimatedTime: "15-20 min",
    keywords: [
      "onboarding",
      "new user",
      "walkthrough",
      "dashboard",
      "clients",
      "tasks",
    ],
    prerequisites: ["Signed in account", "At least one active client record"],
    sections: [
      {
        id: "orientation",
        title: "1. Learn the layout",
        summary: "Understand where major workflows live so navigation is fast.",
        steps: [
          "Use the left sidebar as your primary navigation.",
          "Open Dashboard for workload visibility.",
          "Use Clients and Projects for account-level operations.",
          "Use Tasks for execution and ownership tracking.",
          "Use Personal and Notes for knowledge capture.",
          "Use the top search bar for quick cross-app lookup.",
        ],
      },
      {
        id: "first-flow",
        title: "2. Complete your first operational flow",
        summary:
          "Run one mini lifecycle: choose a client, create work, and verify follow-up.",
        steps: [
          "Open Clients and select one account.",
          "Open the client Tasks tab and add a task.",
          "Assign the task, set priority and due date, and save it.",
          "Open the task detail page and add a short note.",
          "Return to Dashboard and confirm the task appears in reporting.",
        ],
      },
      {
        id: "habits",
        title: "3. Build healthy daily habits",
        summary:
          "Small routines keep data clean and make planning/reporting much easier.",
        steps: [
          "Update task statuses daily, not just at the end of a week.",
          "Use consistent titles for tasks, projects, and notes.",
          "Keep due dates realistic and remove stale due dates quickly.",
          "Log key decisions in Notes/Personal so context is searchable.",
          "Submit UX/process gaps to Feature Suggestions.",
        ],
        tips: ["If a list feels noisy, apply filters before editing data."],
      },
    ],
    related: ["tasks", "clients", "search"],
  },
  {
    slug: "dashboard",
    title: "Dashboard Guide",
    summary:
      "Use Dashboard filters and summary widgets to quickly identify risk, load, and priorities.",
    appPath: "/dashboard",
    audience: "All users",
    estimatedTime: "10 min",
    keywords: ["kpi", "reporting", "filters", "status", "priority", "analytics"],
    prerequisites: ["Existing task/project/client data"],
    sections: [
      {
        id: "filters",
        title: "1. Use filters effectively",
        summary: "Filter quality directly affects how useful the dashboard is.",
        steps: [
          "Choose a date range first (all, 7d, 30d, 90d).",
          "Narrow by client and project to isolate one workstream.",
          "Add user and status filters to inspect ownership and bottlenecks.",
          "Add priority filters when planning this week's focus.",
        ],
      },
      {
        id: "interpretation",
        title: "2. Read the signals",
        summary: "Treat dashboard numbers as decisions, not decoration.",
        steps: [
          "High in-progress + low completed often indicates blocked throughput.",
          "A sudden overdue increase usually means due-date drift or capacity mismatch.",
          "Skewed assignee distribution signals risk concentration.",
          "Use these signals to decide what to reassign, pause, or escalate.",
        ],
      },
      {
        id: "operating-rhythm",
        title: "3. Weekly operating rhythm",
        summary: "A repeatable cadence makes the dashboard actionable.",
        steps: [
          "Start week: review open high-priority work by assignee.",
          "Midweek: check overdue and blocked trend.",
          "End week: validate completed count and carryover list.",
        ],
      },
    ],
    related: ["tasks", "projects"],
  },
  {
    slug: "clients",
    title: "Clients Guide",
    summary:
      "Manage each client as a single operational workspace across contacts, delivery, notes, and billing.",
    appPath: "/clients",
    audience: "Ops, PM, Account teams",
    estimatedTime: "15 min",
    keywords: ["clients", "account", "contacts", "billing", "notes", "tabs"],
    prerequisites: ["Permission to create/edit clients"],
    sections: [
      {
        id: "create-client",
        title: "1. Create a client correctly",
        summary: "Capture enough detail for downstream workflows.",
        steps: [
          "Open Clients and select New client.",
          "Enter a clear account name and initial status.",
          "Set start/end dates if known.",
          "Save, then immediately review tab sections for completeness.",
        ],
      },
      {
        id: "use-tabs",
        title: "2. Work inside client tabs",
        summary: "Tabs are designed for account-specific context and speed.",
        steps: [
          "Use Contacts for relationship and communication context.",
          "Use Projects for delivery milestones and planning.",
          "Use Tasks for operational execution tied to this client.",
          "Use Notes for account history and decisions.",
          "Use Billing/Documents/Requirements/KPIs as needed.",
        ],
      },
      {
        id: "quality",
        title: "3. Keep client data healthy",
        summary: "Data quality prevents confusion across teams.",
        steps: [
          "Avoid duplicate client names.",
          "Keep client status current.",
          "Archive or close stale records instead of leaving unknown state.",
          "Link notes and tasks to the correct client every time.",
        ],
      },
    ],
    related: ["projects", "tasks", "notes"],
  },
  {
    slug: "projects",
    title: "Projects Guide",
    summary:
      "Plan and control project execution with clear status, ownership, and task linkage.",
    appPath: "/projects",
    audience: "PM, Delivery leads",
    estimatedTime: "15 min",
    keywords: ["projects", "templates", "assignees", "status", "tasks", "timeline"],
    prerequisites: ["Client exists", "Project permissions"],
    sections: [
      {
        id: "new-vs-template",
        title: "1. New project vs template project",
        summary: "Pick the right creation path before adding work.",
        steps: [
          "Use new project for unique one-off engagements.",
          "Use template project for repeatable delivery patterns.",
          "Confirm project status, dates, and budget at creation.",
          "Assign owners early so responsibility is explicit.",
        ],
      },
      {
        id: "project-tabs",
        title: "2. Use project tabs intentionally",
        summary: "Each tab solves a different control problem.",
        steps: [
          "Overview: maintain project-level details and custom fields.",
          "Assignees: ensure active ownership coverage.",
          "Tasks: run execution at the project level.",
        ],
      },
      {
        id: "status-discipline",
        title: "3. Enforce status discipline",
        summary: "Reliable status updates are critical for reporting.",
        steps: [
          "Move status as soon as project condition changes.",
          "Do not leave blocked work in active state.",
          "Close completed/cancelled projects promptly.",
        ],
      },
    ],
    related: ["tasks", "dashboard"],
  },
  {
    slug: "tasks",
    title: "Tasks Guide",
    summary:
      "Deep workflow for creating, templating, repeating, assigning, and closing tasks.",
    appPath: "/tasks",
    audience: "All users",
    estimatedTime: "20-25 min",
    keywords: [
      "tasks",
      "task templates",
      "repeatable tasks",
      "recurrence",
      "subtasks",
      "watchers",
      "assignees",
    ],
    prerequisites: ["Task permissions", "At least one assignee in the workspace"],
    sections: [
      {
        id: "create-basic",
        title: "1. Create a task from scratch",
        summary: "Set baseline fields right so downstream tracking works.",
        steps: [
          "Open Tasks and use Add task.",
          "Enter a clear action-based title.",
          "Set status, priority, and due date/time.",
          "Assign one primary owner.",
          "Optionally connect client/project context.",
          "Save and verify the task appears in list/board views.",
        ],
      },
      {
        id: "template-tasks",
        title: "2. Create tasks from templates",
        summary: "Use templates to reduce repetitive setup and enforce standards.",
        steps: [
          "In Add task, switch create mode to template.",
          "Choose a task template matching the workflow.",
          "Review inherited values (title, status, priority, due defaults).",
          "Adjust context-specific fields for this instance only.",
          "Save and confirm assignees/subtasks are as expected.",
        ],
        tips: [
          "Use templates when task structure repeats at least weekly.",
          "Review template quality in Settings if users keep editing the same defaults.",
        ],
      },
      {
        id: "repeatable-tasks",
        title: "3. Configure repeatable tasks",
        summary: "Use recurrence to automate recurring operational work.",
        steps: [
          "Create or edit a task and open recurrence controls.",
          "Choose frequency: daily, weekly, monthly, or yearly.",
          "Set due time and timezone for consistent scheduling.",
          "Set lead days when reminders should trigger before due date.",
          "Save and validate next occurrence behavior.",
        ],
        tips: [
          "Set recurrence only for true repeatable work, not one-off projects.",
          "If reminders feel late, verify timezone and lead days first.",
        ],
      },
      {
        id: "execution",
        title: "4. Execute tasks with status hygiene",
        summary: "Task lists only stay useful when statuses are accurate.",
        steps: [
          "Use board view for quick movement between statuses.",
          "Use table view for bulk filtering and precision edits.",
          "Use gantt view for timeline conflict detection.",
          "Move blocked tasks immediately instead of leaving them in progress.",
          "Close tasks as completed/cancelled the moment work ends.",
        ],
      },
      {
        id: "collaboration",
        title: "5. Collaborate with subtasks, assignees, watchers, and notes",
        summary: "Break complexity without losing ownership clarity.",
        steps: [
          "Open task detail and add subtasks for concrete work units.",
          "Use Assignees for direct owners; Watchers for visibility.",
          "Use Notes tab to capture decisions and implementation detail.",
          "Link related tasks/projects in notes or chat for context.",
        ],
      },
      {
        id: "troubleshooting",
        title: "6. Task troubleshooting",
        summary: "Fast checks for common issues.",
        steps: [
          "Task not visible: check filters (status, assignee, due, watch mode).",
          "Recurrence not behaving: verify frequency/timezone/lead-day values.",
          "Template mode missing: confirm templates exist in Settings.",
          "Wrong owner list: verify user status and assignment permissions.",
        ],
      },
    ],
    related: ["settings", "projects", "dashboard"],
  },
  {
    slug: "outlook-add-in",
    title: "Outlook Add-In Setup Guide",
    summary:
      "Set up the Outlook tool so your team can turn an email into a task.",
    appPath: "/tasks",
    audience: "All users",
    estimatedTime: "5-10 min",
    keywords: [
      "outlook",
      "plugin",
      "add-in",
      "manifest",
      "sideload",
      "desktop",
      "outlook web",
      "import email",
      "resopshub task",
    ],
    prerequisites: [
      "You can open Outlook on web or desktop",
      "Download the Outlook setup file from this guide",
      "Your ResOpsHub URL is https://resopshub-p1pi.vercel.app",
    ],
    sections: [
      {
        id: "prepare-manifest",
        title: "Prepare the setup file",
        summary: "Make sure the setup file points to your ResOpsHub site.",
        steps: [
          "Click Download Outlook setup file below.",
          "Save the file on your computer.",
          "Check that links in the file use: https://resopshub-p1pi.vercel.app",
          "Save the file.",
          "Keep the file ready because you will pick it in Outlook.",
        ],
        links: [
          {
            label: "Download Outlook setup file (manifest.xml)",
            href: "/api/help/downloads/outlook-manifest.xml",
          },
        ],
        tips: [
          "If your team uses a different site URL, use that URL instead.",
          "If install fails, open the URL in a normal browser tab to make sure it loads.",
        ],
      },
      {
        id: "install-web",
        title: "Install in Outlook on the web",
        summary: "This is usually the easiest way to start.",
        steps: [
          "Open Outlook in your browser.",
          "Open Get Add-ins (or Manage add-ins).",
          "Go to My add-ins, then click Add a custom add-in.",
          "Click Add from file and choose manifest.xml.",
          "Open any email and check you can see Import to Task.",
        ],
      },
      {
        id: "install-desktop",
        title: "Install in desktop Outlook",
        summary: "Use this if your team works in the desktop app.",
        steps: [
          "Open Outlook desktop.",
          "Open Get Add-ins (or Manage add-ins).",
          "Add a custom add-in, then choose Add from file.",
          "Pick manifest.xml.",
          "Open an email and click Import to Task.",
        ],
        tips: [
          "If desktop install does not work, install in Outlook web first, then restart desktop Outlook.",
          "If the button still does not show, ask your admin to check add-in permissions.",
        ],
      },
      {
        id: "first-run",
        title: "Sign in and create your first task",
        summary: "Once installed, this is the normal day-to-day flow.",
        steps: [
          "Open an email.",
          "Click Import to Task.",
          "If asked, click Login and sign in.",
          "Click I've logged in, try again.",
          "Check the task title and notes, then click Create task.",
          "Click Open Task to confirm it was created.",
        ],
      },
      {
        id: "troubleshooting",
        title: "If it does not work",
        summary: "Try these quick fixes.",
        steps: [
          "Install failed: check the URL in manifest.xml, then try Add from file again.",
          "No Import to Task button: open an email you received (not a new draft).",
          "Keeps asking you to log in: close and reopen Outlook, then sign in again.",
          "Task not created: refresh ResOpsHub and check Tasks.",
          "If you still see an error, send a screenshot to your admin.",
        ],
      },
    ],
    related: ["tasks", "settings-admin", "getting-started"],
  },
  {
    slug: "browser-add-task",
    title: "Browser Right-Click Add Task Guide",
    summary:
      "Install the browser tool and create tasks by highlighting text, right-clicking, and pressing Add Task.",
    appPath: "/tasks",
    audience: "All users",
    estimatedTime: "5-10 min",
    keywords: [
      "browser",
      "chrome",
      "edge",
      "right click",
      "add task",
      "highlight text",
      "extension",
    ],
    prerequisites: [
      "A ResOpsHub account",
      "Google Chrome or Microsoft Edge",
      "ResOpsHub web app URL: https://resopshub-p1pi.vercel.app",
      "Download the browser Add Task file from this guide",
    ],
    sections: [
      {
        id: "install-tool",
        title: "Install the Add Task tool",
        summary: "Load the tool into your browser once.",
        steps: [
          "Click Download browser Add Task file below.",
          "Save the zip file, then unzip it.",
          "Open Chrome or Edge.",
          "Click the address bar, type chrome://extensions (or edge://extensions), then press Enter.",
          "Turn on Developer mode.",
          "Click Load unpacked.",
          "Choose the folder you just unzipped.",
          "Confirm you can see ResOpsHub Add Task in your extensions list.",
        ],
        links: [
          {
            label: "Download browser Add Task file (.zip)",
            href: "/api/help/downloads/resopshub-add-task-extension.zip",
          },
        ],
      },
      {
        id: "set-url",
        title: "Set your app URL",
        summary: "Tell the tool where to create the task.",
        steps: [
          "On the extensions page, find ResOpsHub Add Task and click Details.",
          "Click Extension options.",
          "In the ResOpsHub URL box, type: https://resopshub-p1pi.vercel.app",
          "Click Save settings.",
          "Open https://resopshub-p1pi.vercel.app in a normal tab and sign in.",
        ],
      },
      {
        id: "create-task",
        title: "Create a task from highlighted text",
        summary: "Use right-click from any normal webpage.",
        steps: [
          "Open any normal webpage.",
          "Highlight the text you want to turn into a task.",
          "Right-click the highlighted text.",
          "Click Add Task.",
          "Wait for the task-created message.",
          "The task page should open automatically.",
        ],
      },
      {
        id: "if-not-working",
        title: "If nothing happens",
        summary: "Use these quick checks in order.",
        steps: [
          "Go back to chrome://extensions (or edge://extensions).",
          "Click Reload on ResOpsHub Add Task.",
          "Make sure you are still signed in at https://resopshub-p1pi.vercel.app.",
          "Try again on a normal website page (not browser settings pages).",
          "If it still fails, open Extension details, open Service worker, and check the first red error message.",
        ],
      },
    ],
    related: ["tasks", "outlook-add-in", "getting-started"],
  },
  {
    slug: "forms",
    title: "Forms Guide",
    summary:
      "Build structured forms with conditional fields and automated task follow-up.",
    appPath: "/forms",
    audience: "Ops, Process owners",
    estimatedTime: "20 min",
    keywords: [
      "forms",
      "form builder",
      "conditional fields",
      "submissions",
      "task triggers",
    ],
    prerequisites: ["Forms permission", "Task templates configured (optional)"],
    sections: [
      {
        id: "build-form",
        title: "1. Build a form",
        summary: "Create the schema before collecting submissions.",
        steps: [
          "Open Forms and switch to Create form.",
          "Add title, description, and status.",
          "Create fields (text, number, date, dropdown).",
          "Set required flags only where necessary.",
          "Use field conditions for dynamic branching.",
        ],
      },
      {
        id: "task-automation",
        title: "2. Add task automation",
        summary: "Trigger follow-up work automatically on submission.",
        steps: [
          "Attach task templates for standardized follow-up.",
          "Add manual task actions for custom one-off follow-up.",
          "Order task actions so execution order is clear.",
          "Save and run a test submission.",
        ],
      },
      {
        id: "submission-ops",
        title: "3. Operate submissions",
        summary: "Review and resolve incoming form submissions cleanly.",
        steps: [
          "Use submissions tab filters (scope and sort).",
          "Open a submission and review values JSON.",
          "Update submission status as work progresses.",
          "Confirm triggered tasks were created and assigned correctly.",
          "Use comments for reviewer-to-operator handoff notes.",
        ],
      },
    ],
    related: ["tasks", "settings"],
  },
  {
    slug: "personal",
    title: "Personal Workspace Guide",
    summary:
      "Organize personal/team pages, sharing, and linked note workflows.",
    appPath: "/personal",
    audience: "All users",
    estimatedTime: "15-20 min",
    keywords: [
      "personal",
      "pages",
      "sections",
      "sharing",
      "linked notes",
      "editor",
    ],
    prerequisites: ["Personal pages enabled", "Editor permissions"],
    sections: [
      {
        id: "structure",
        title: "1. Structure sections and pages",
        summary: "A clean hierarchy keeps long-term notes usable.",
        steps: [
          "Create sections by domain (clients, internal ops, playbooks).",
          "Create pages with clear noun-based titles.",
          "Reorder sections/pages so frequent items are near top.",
          "Avoid oversized pages by splitting into focused pages.",
        ],
      },
      {
        id: "sharing",
        title: "2. Configure sharing",
        summary: "Use section and page members deliberately.",
        steps: [
          "Add section members for broad access across many pages.",
          "Use page members for exceptions or restricted collaboration.",
          "Review share mode when moving pages between sections.",
        ],
      },
      {
        id: "editor-workflow",
        title: "3. Use the editor efficiently",
        summary: "Use rich editor features for planning and execution notes.",
        steps: [
          "Use headings and lists for readable structure.",
          "Use text boxes/shapes for visual planning when needed.",
          "Create tasks directly from selected content.",
          "Keep context-menu favorites tuned to your workflow.",
        ],
      },
    ],
    related: ["notes", "tasks", "search"],
  },
  {
    slug: "notes",
    title: "Notes Guide",
    summary:
      "Find and manage notes across clients, including linked personal-page notes.",
    appPath: "/notes",
    audience: "All users",
    estimatedTime: "10 min",
    keywords: ["notes", "client notes", "filters", "linked pages", "editor"],
    prerequisites: ["Note access to target clients/pages"],
    sections: [
      {
        id: "find-notes",
        title: "1. Find notes quickly",
        summary: "Use filtering first to avoid manually scanning long lists.",
        steps: [
          "Filter by client when searching account-specific context.",
          "Filter by editor/user when tracking ownership.",
          "Filter by date range for recent activity.",
          "Open note detail for full editing workflow.",
        ],
      },
      {
        id: "linked-behavior",
        title: "2. Understand linked note behavior",
        summary: "Some client notes are linked to personal pages and stay in sync.",
        steps: [
          "If a note has a linked personal page, edits should reflect in both contexts.",
          "Use linked-page banner/navigation to confirm relationship.",
          "Edit content from either side and verify latest changes are visible.",
          "If linked page is unavailable, verify access and linkage integrity.",
        ],
      },
    ],
    related: ["personal", "search", "clients"],
  },
  {
    slug: "chat",
    title: "Chat Guide",
    summary:
      "Use direct/group chat for fast collaboration with linked operational context.",
    appPath: "/chat",
    audience: "All users",
    estimatedTime: "10-15 min",
    keywords: ["chat", "direct", "group", "attachments", "reactions", "unread"],
    prerequisites: ["Chat access"],
    sections: [
      {
        id: "conversations",
        title: "1. Start and manage conversations",
        summary: "Keep thread purpose clear from the beginning.",
        steps: [
          "Use Direct for 1:1 coordination.",
          "Use Group for project/client teams.",
          "Name groups clearly to avoid overlap.",
          "Use left-panel search to quickly locate active threads.",
        ],
      },
      {
        id: "message-quality",
        title: "2. Send high-context updates",
        summary: "Context-rich chat reduces follow-up confusion.",
        steps: [
          "Link related tasks/projects/clients/notes in messages.",
          "Attach files only when needed and name them clearly.",
          "Use reactions for lightweight acknowledgement.",
          "Mark threads read by opening them regularly.",
        ],
      },
    ],
    related: ["tasks", "projects"],
  },
  {
    slug: "feature-suggestions",
    title: "Feature Suggestions Guide",
    summary:
      "Capture, prioritize, and track product improvement ideas with transparent status.",
    appPath: "/feature-suggestions",
    audience: "All users",
    estimatedTime: "10 min",
    keywords: ["feature suggestions", "ideas", "voting", "status", "roadmap"],
    prerequisites: ["User profile"],
    sections: [
      {
        id: "submit",
        title: "1. Submit useful ideas",
        summary: "Better input quality leads to faster triage and better outcomes.",
        steps: [
          "Write a clear problem-oriented title.",
          "Add details describing pain, impact, and desired behavior.",
          "Set the right type (bug, improvement, new feature).",
          "Submit and monitor comments for clarification.",
        ],
      },
      {
        id: "prioritize",
        title: "2. Prioritize and maintain lifecycle",
        summary: "Use votes and status consistently across ideas.",
        steps: [
          "Vote on ideas to indicate value and urgency.",
          "Update status as idea moves through review and planning.",
          "Use completed/rejected states to close the loop.",
          "Reference linked work items where applicable.",
        ],
      },
    ],
    related: ["chat", "tasks"],
  },
  {
    slug: "search",
    title: "Search Guide",
    summary:
      "Use global and full search to find notes/content quickly across Personal and Tasks.",
    appPath: "/search",
    audience: "All users",
    estimatedTime: "8-10 min",
    keywords: ["search", "global search", "filters", "recent searches"],
    prerequisites: ["Content exists in notes/pages/tasks"],
    sections: [
      {
        id: "global",
        title: "1. Start with global search",
        summary: "Use top search bar for quick jump navigation.",
        steps: [
          "Type at least two characters to see suggestions.",
          "Select a suggestion to jump directly to an item.",
          "Use full results link when you need broader discovery.",
        ],
      },
      {
        id: "full-search",
        title: "2. Refine in full search page",
        summary: "Apply filters for precise discovery.",
        steps: [
          "Use type filter to focus on personal pages or task notes.",
          "Use section/client filters to narrow scope.",
          "Re-run recent searches for recurring workflows.",
        ],
      },
    ],
    related: ["notes", "personal", "tasks"],
  },
  {
    slug: "settings-admin",
    title: "Settings and Admin Guide",
    summary:
      "Configure profile, notifications, statuses, templates, and user administration.",
    appPath: "/settings",
    audience: "Team leads and admins",
    estimatedTime: "15-20 min",
    keywords: [
      "settings",
      "notifications",
      "statuses",
      "templates",
      "admin",
      "users",
    ],
    prerequisites: ["Settings access", "Admin role for user provisioning"],
    sections: [
      {
        id: "settings-tabs",
        title: "1. Use Settings tabs",
        summary: "Configure personal and operational defaults.",
        steps: [
          "Profile: maintain your account details.",
          "Notifications: tune task and suggestion alerts.",
          "Statuses: standardize task/project lifecycle values.",
          "Templates: maintain reusable task/project structures.",
        ],
      },
      {
        id: "template-governance",
        title: "2. Maintain template quality",
        summary: "Templates should reduce setup work, not add cleanup work.",
        steps: [
          "Review task template status, priority, and recurrence defaults.",
          "Set template assignees/subtasks where repeatable.",
          "For project templates, verify linked task template sequence.",
          "Retire stale templates that are no longer used.",
        ],
      },
      {
        id: "admin-users",
        title: "3. Admin user management",
        summary: "Provision access safely with role and status controls.",
        steps: [
          "Open Admin > Users.",
          "Create user with email, temporary password, role, and status.",
          "Adjust role/status as responsibilities change.",
          "Disable accounts instead of deleting historical ownership.",
        ],
      },
    ],
    related: ["tasks", "projects", "forms"],
  },
];

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function normalizeString(value: unknown, maxLength = 4000) {
  const normalized = String(value || "").replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  if (normalized.length <= maxLength) return normalized;
  return normalized.slice(0, maxLength);
}

function normalizeStringArray(value: unknown, maxItemLength = 4000) {
  if (!Array.isArray(value)) return [] as string[];
  return value
    .map((item) => normalizeString(item, maxItemLength))
    .filter(Boolean);
}

function normalizeSlug(value: unknown) {
  const normalized = normalizeString(value, 160)
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized;
}

function normalizeSectionLinks(value: unknown): HelpGuideSectionLink[] {
  if (!Array.isArray(value)) return [];
  const links: HelpGuideSectionLink[] = [];
  value.forEach((entry) => {
    if (!isObjectRecord(entry)) return;
    const label = normalizeString(entry.label, 200);
    const href = normalizeString(entry.href, 2048);
    if (!label || !href) return;
    if (!href.startsWith("/") && !/^https?:\/\//i.test(href)) return;
    links.push({ label, href });
  });
  return links;
}

function createParagraphNode(text: string) {
  return {
    type: "paragraph",
    content: [{ type: "text", text }],
  };
}

function createListNode(type: "orderedList" | "bulletList", items: string[]) {
  return {
    type,
    content: items.map((item) => ({
      type: "listItem",
      content: [createParagraphNode(item)],
    })),
  };
}

function buildLegacySectionContent(input: {
  summary: string;
  steps: string[];
  tips: string[];
}) {
  const content: Array<Record<string, unknown>> = [
    createParagraphNode(input.summary),
    createListNode("orderedList", input.steps),
  ];
  if (input.tips.length) {
    content.push(createParagraphNode("Tips"));
    content.push(createListNode("bulletList", input.tips));
  }
  return {
    type: "doc",
    content,
  };
}

function normalizeTiptapMarks(value: unknown, depth: number) {
  if (!Array.isArray(value)) return undefined;
  const marks = value
    .map((entry) => normalizeTiptapNode(entry, depth + 1))
    .filter((mark): mark is Record<string, unknown> => mark !== null);
  return marks.length ? marks : undefined;
}

function normalizeTiptapAttrs(value: unknown) {
  if (!isObjectRecord(value)) return undefined;
  try {
    const json = JSON.parse(JSON.stringify(value));
    return isObjectRecord(json) ? json : undefined;
  } catch {
    return undefined;
  }
}

function normalizeTiptapNode(value: unknown, depth = 0): Record<string, unknown> | null {
  if (!isObjectRecord(value) || depth > 24) return null;

  const type = normalizeString(value.type, 100);
  if (!type) return null;

  const normalized: Record<string, unknown> = { type };
  const attrs = normalizeTiptapAttrs(value.attrs);
  if (attrs) {
    normalized.attrs = attrs;
  }

  if (typeof value.text === "string") {
    normalized.text = value.text.slice(0, 16000);
  }

  const marks = normalizeTiptapMarks(value.marks, depth);
  if (marks?.length) {
    normalized.marks = marks;
  }

  if (Array.isArray(value.content)) {
    const content = value.content
      .map((node) => normalizeTiptapNode(node, depth + 1))
      .filter((node): node is Record<string, unknown> => node !== null);
    normalized.content = content;
  }

  if (type === "text" && typeof normalized.text !== "string") {
    return null;
  }

  return normalized;
}

function normalizeTiptapContent(value: unknown): unknown | null {
  const normalized = normalizeTiptapNode(value);
  if (!normalized || normalized.type !== "doc") {
    return null;
  }
  if (!Array.isArray(normalized.content)) {
    normalized.content = [{ type: "paragraph" }];
  }
  return normalized;
}

export function normalizeHelpGuideSection(value: unknown): HelpGuideSection | null {
  if (!isObjectRecord(value)) return null;

  const id = normalizeSlug(value.id);
  const title = normalizeString(value.title, 240);
  const links = normalizeSectionLinks(value.links);
  let content = normalizeTiptapContent(value.content);

  if (!content) {
    const summary = normalizeString(value.summary, 2000);
    const steps = normalizeStringArray(value.steps, 3000);
    const tips = normalizeStringArray(value.tips, 2000);
    if (!summary || !steps.length) {
      return null;
    }
    content = buildLegacySectionContent({
      summary,
      steps,
      tips,
    });
  }

  if (!id || !title) {
    return null;
  }

  const normalized: HelpGuideSection = {
    id,
    title,
    content,
  }
  if (links.length) {
    normalized.links = links;
  }
  return normalized;
}

export function getHelpGuideSearchText(guide: HelpGuide) {
  return [
    guide.title,
    guide.summary,
    guide.audience,
    guide.keywords.join(" "),
    guide.sections.map((section) => section.title).join(" "),
    guide.sections.map((section) => extractPlainText(section.content)).join(" "),
  ]
    .join(" ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function normalizeHelpGuide(value: unknown): HelpGuide | null {
  if (!isObjectRecord(value)) return null;

  const slug = normalizeSlug(value.slug);
  const title = normalizeString(value.title, 240);
  const summary = normalizeString(value.summary, 3000);
  const appPathRaw = normalizeString(value.appPath, 2048);
  const appPath = appPathRaw.startsWith("/") ? appPathRaw : "/help";
  const audience = normalizeString(value.audience, 240);
  const estimatedTime = normalizeString(value.estimatedTime, 120);
  const keywords = normalizeStringArray(value.keywords, 120);
  const prerequisites = normalizeStringArray(value.prerequisites, 4000);
  const related = normalizeStringArray(value.related, 160).map((item) =>
    normalizeSlug(item)
  );
  const sections = Array.isArray(value.sections)
    ? value.sections
        .map((section) => normalizeHelpGuideSection(section))
        .filter(
          (section): section is HelpGuideSection => section !== null
        )
    : [];

  if (
    !slug ||
    !keywords.length ||
    !prerequisites.length ||
    !sections.length
  ) {
    return null;
  }

  return {
    slug,
    title,
    summary,
    appPath,
    audience,
    estimatedTime,
    keywords,
    prerequisites,
    sections,
    related: related.filter(Boolean),
  };
}

export const HELP_GUIDES: HelpGuide[] = HELP_GUIDE_DEFINITIONS.map((guide) =>
  normalizeHelpGuide(guide)
).filter((guide): guide is HelpGuide => guide !== null);

export const HELP_GUIDE_BY_SLUG = HELP_GUIDES.reduce<Record<string, HelpGuide>>(
  (acc, guide) => {
    acc[guide.slug] = guide;
    return acc;
  },
  {}
);

export function getHelpGuideBySlug(slug: string) {
  return HELP_GUIDE_BY_SLUG[slug] || null;
}

