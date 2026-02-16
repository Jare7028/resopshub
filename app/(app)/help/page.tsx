import Link from "next/link";

type HelpSection = {
  title: string;
  summary: string;
  href: string;
  starterActions: string[];
  tips: string[];
};

const quickStartSteps = [
  "Open Dashboard to see active workload and priorities.",
  "Create or open a Client and review its tabs (Projects, Tasks, Notes).",
  "Use Tasks to assign ownership, due dates, and status.",
  "Use Personal pages for private/team notes and planning.",
  "Use Forms when you need structured intake and follow-up tasks.",
  "Use Feature Suggestions to submit and track app improvement ideas.",
  "Use Search when you need to find notes or task content quickly.",
] as const;

const sections: HelpSection[] = [
  {
    title: "Dashboard",
    summary: "Track workload, priorities, and delivery trends in one view.",
    href: "/dashboard",
    starterActions: [
      "Set a date range (all time, 7d, 30d, 90d).",
      "Filter by client, project, user, status, and priority.",
      "Use results to identify blockers and overdue work.",
    ],
    tips: ["Start broad, then narrow to one client or project."],
  },
  {
    title: "Clients",
    summary: "Manage each client and all related operations from one workspace.",
    href: "/clients",
    starterActions: [
      "Create a client from the Clients page.",
      "Use client tabs: contacts, billing, projects, tasks, notes, and more.",
      "Keep status and key dates accurate for reporting views.",
    ],
    tips: ["Use client-level pages for focused account work."],
  },
  {
    title: "Projects",
    summary: "Plan delivery streams and coordinate project-level ownership.",
    href: "/projects",
    starterActions: [
      "Create a project from scratch or from a template.",
      "Set assignees and project status.",
      "Use project tasks to break down execution.",
    ],
    tips: ["Templates help standardize repeatable project setups."],
  },
  {
    title: "Tasks",
    summary: "Assign, track, and complete work with clear ownership and deadlines.",
    href: "/tasks",
    starterActions: [
      "Create a task and assign an owner.",
      "Set due date, priority, and status.",
      "Use subtasks and watchers for complex work.",
    ],
    tips: ["Use board view for flow, gantt view for timeline planning."],
  },
  {
    title: "Forms",
    summary: "Collect structured responses and trigger follow-up tasks automatically.",
    href: "/forms",
    starterActions: [
      "Build fields (text, number, date, dropdown).",
      "Add conditional logic for dynamic forms.",
      "Configure task-template and manual task triggers.",
    ],
    tips: ["Test form logic with a sample submission before rollout."],
  },
  {
    title: "Personal",
    summary: "Organize personal/team knowledge with sections and pages.",
    href: "/personal",
    starterActions: [
      "Create sections for major work areas.",
      "Create pages for notes and planning.",
      "Set section/page members when collaboration is needed.",
    ],
    tips: ["Use Personal for living docs; link to client notes when needed."],
  },
  {
    title: "Notes",
    summary: "View and filter notes across clients from one place.",
    href: "/notes",
    starterActions: [
      "Filter by client, editor, and date range.",
      "Open notes directly from the index.",
      "Use this page to quickly locate context.",
    ],
    tips: ["Use global Search for full-text matches inside content."],
  },
  {
    title: "Chat",
    summary: "Coordinate with teammates through direct and group conversations.",
    href: "/chat",
    starterActions: [
      "Start a direct or group conversation.",
      "Share links to tasks, projects, and notes in messages.",
      "Use reactions and unread indicators to stay aligned.",
    ],
    tips: ["Link work items in chat to keep context attached to decisions."],
  },
  {
    title: "Feature Suggestions",
    summary: "Submit ideas, vote, and track product improvement status.",
    href: "/feature-suggestions",
    starterActions: [
      "Submit an idea with clear title and details.",
      "Vote up/down to signal priority.",
      "Track status from idea through completion or rejection.",
    ],
    tips: ["Use concise titles so similar ideas are easy to spot."],
  },
  {
    title: "Search",
    summary: "Run full-text searches across personal and task content.",
    href: "/search",
    starterActions: [
      "Search by keyword, phrase, or topic.",
      "Filter by type, section, and client.",
      "Reuse recent searches for recurring checks.",
    ],
    tips: ["Start in global search bar, then refine in full Search page."],
  },
  {
    title: "Settings",
    summary: "Manage profile, notifications, statuses, and templates.",
    href: "/settings",
    starterActions: [
      "Review notification preferences.",
      "Configure statuses and templates for team consistency.",
      "Set up template subtasks and assignees.",
    ],
    tips: ["Set standards in templates early to reduce manual cleanup later."],
  },
];

const troubleshootingItems = [
  "If a page looks stale, refresh and verify you are in the correct client/project context.",
  "If you cannot see or edit an item, it may be a role/permission issue.",
  "If search results are too broad, filter by section/client/type.",
  "If something feels missing, submit a request in Feature Suggestions.",
] as const;

export default function HelpPage() {
  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Help Center
        </p>
        <h1 className="text-3xl font-semibold text-slate-900">Help & Walkthrough</h1>
        <p className="max-w-3xl text-sm text-slate-600">
          New to the app? Start with the quick walkthrough below, then open any section
          guide to learn what it does and how to use it effectively.
        </p>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-6">
        <h2 className="text-lg font-semibold text-slate-900">Quick Start (10-15 minutes)</h2>
        <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm text-slate-700">
          {quickStartSteps.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-slate-900">Section Guides</h2>
        <div className="grid gap-4 lg:grid-cols-2">
          {sections.map((section) => (
            <article
              key={section.title}
              className="rounded-lg border border-slate-200 bg-white p-5"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-base font-semibold text-slate-900">{section.title}</h3>
                  <p className="mt-1 text-sm text-slate-600">{section.summary}</p>
                </div>
                <Link
                  href={section.href}
                  className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:border-slate-400 hover:text-slate-900"
                >
                  Open
                </Link>
              </div>

              <div className="mt-4 space-y-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Start Here
                  </p>
                  <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-slate-700">
                    {section.starterActions.map((action) => (
                      <li key={action}>{action}</li>
                    ))}
                  </ul>
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Tip
                  </p>
                  <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-slate-700">
                    {section.tips.map((tip) => (
                      <li key={tip}>{tip}</li>
                    ))}
                  </ul>
                </div>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-6">
        <h2 className="text-lg font-semibold text-slate-900">Troubleshooting Basics</h2>
        <ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-slate-700">
          {troubleshootingItems.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </section>
    </div>
  );
}
