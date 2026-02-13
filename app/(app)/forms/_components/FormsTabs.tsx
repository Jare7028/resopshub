import Link from "next/link";

const tabs = [
  { key: "list", label: "Forms" },
  { key: "create", label: "Create form" },
] as const;

export type FormsTabKey = (typeof tabs)[number]["key"];

export function normalizeFormsTabKey(value: string | null | undefined): FormsTabKey {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  const match = tabs.find((tab) => tab.key === normalized);
  return match ? match.key : "list";
}

export default function FormsTabs({
  active,
  urls,
}: {
  active: FormsTabKey;
  urls: Record<FormsTabKey, string>;
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

