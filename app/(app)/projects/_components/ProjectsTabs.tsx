import Link from "next/link";

const tabs = [
  { key: "list", label: "Projects" },
  { key: "add", label: "Add project" },
] as const;

export type ProjectsTabKey = (typeof tabs)[number]["key"];

export function normalizeProjectsTabKey(
  value: string | null | undefined
): ProjectsTabKey {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();

  const match = tabs.find((tab) => tab.key === normalized);
  return match ? match.key : "list";
}

export default function ProjectsTabs({
  active,
  urls,
}: {
  active: ProjectsTabKey;
  urls: Record<ProjectsTabKey, string>;
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

