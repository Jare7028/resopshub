import AppNavLink from "../../../_components/AppNavLink";

const tabs = [
  { key: "details", label: "Details", suffix: "" },
  { key: "assignees", label: "Assignees", suffix: "?tab=assignees" },
  { key: "watchers", label: "Watchers", suffix: "?tab=watchers" },
  { key: "subtasks", label: "Subtasks", suffix: "?tab=subtasks" },
  { key: "notes", label: "Notes", suffix: "?tab=notes" },
] as const;

export type TaskTabKey = (typeof tabs)[number]["key"];

export function normalizeTaskTabKey(value: string | null | undefined): TaskTabKey {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();

  const match = tabs.find((tab) => tab.key === normalized);
  return match ? match.key : "details";
}

export default function TaskTabs({
  taskId,
  active,
}: {
  taskId: string;
  active: TaskTabKey;
}) {
  return (
    <nav className="flex flex-wrap gap-2 border-b border-slate-200 pb-4 text-sm">
      {tabs.map((tab) => (
        <AppNavLink
          key={tab.key}
          href={`/tasks/${taskId}${tab.suffix}`}
          prefetch={false}
          forceHardNavigation
          className={`rounded-md px-3 py-1.5 font-medium ${
            active === tab.key
              ? "tab-active"
              : "border border-slate-200 text-slate-700 hover:bg-slate-100"
          }`}
        >
          {tab.label}
        </AppNavLink>
      ))}
    </nav>
  );
}
