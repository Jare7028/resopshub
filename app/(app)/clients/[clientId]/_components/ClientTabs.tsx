import Link from "next/link";

const tabs = [
  { key: "overview", label: "Overview", suffix: "" },
  { key: "contacts", label: "Contacts", suffix: "/contacts" },
  { key: "billing", label: "Billing", suffix: "/billing" },
  { key: "projects", label: "Projects", suffix: "/projects" },
  { key: "tasks", label: "Tasks", suffix: "/tasks" },
  { key: "notes", label: "Notes", suffix: "/notes" },
  { key: "documents", label: "Documents", suffix: "/documents" },
  { key: "requirements", label: "Requirements", suffix: "/requirements" },
  { key: "kpis", label: "KPIs", suffix: "/kpis" },
] as const;

type TabKey = (typeof tabs)[number]["key"];

export default function ClientTabs({
  clientId,
  active,
}: {
  clientId: string;
  active: TabKey;
}) {
  return (
    <nav className="flex flex-wrap gap-2 border-b border-slate-200 pb-4 text-sm">
      {tabs.map((tab) => (
        <Link
          key={tab.key}
          href={`/clients/${clientId}${tab.suffix}`}
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

