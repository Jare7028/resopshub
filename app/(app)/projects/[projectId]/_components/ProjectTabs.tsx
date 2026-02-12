import Link from "next/link";

const tabs = [
  { key: "overview", label: "Overview", suffix: "" },
  { key: "assignees", label: "Assignees", suffix: "/assignees" },
  { key: "tasks", label: "Tasks", suffix: "/tasks" },
] as const;

type TabKey = (typeof tabs)[number]["key"];

export default function ProjectTabs({
  projectId,
  active,
}: {
  projectId: string;
  active: TabKey;
}) {
  return (
    <nav className="flex flex-wrap gap-2 border-b border-slate-200 pb-4 text-sm">
      {tabs.map((tab) => (
        <Link
          key={tab.key}
          href={`/projects/${projectId}${tab.suffix}`}
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

