import Link from "next/link";

const tabs = [
  { key: "list", label: "Tasks" },
  { key: "add", label: "Add task" },
  { key: "filters", label: "Filters" },
] as const;

export type TasksTabKey = (typeof tabs)[number]["key"];

export function normalizeTasksTabKey(value: string | null | undefined): TasksTabKey {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();

  const match = tabs.find((tab) => tab.key === normalized);
  return match ? match.key : "list";
}

export default function TasksTabs({
  active,
  urls,
}: {
  active: TasksTabKey;
  urls: Record<TasksTabKey, string>;
}) {
  return (
    <nav className="flex flex-wrap gap-2 border-b border-slate-200 pb-4 text-sm">
      {tabs.map((tab) => (
        <Link
          key={tab.key}
          href={urls[tab.key]}
          className={`rounded-md px-3 py-1.5 font-medium ${
            active === tab.key
              ? "tab-active"
              : "border border-slate-200 text-slate-700 hover:bg-slate-100"
          }`}
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}

