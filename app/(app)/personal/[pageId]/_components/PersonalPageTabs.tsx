import Link from "next/link";

const tabs = [
  { key: "notes", label: "Notes", suffix: "" },
  { key: "section_members", label: "Section members", suffix: "?tab=section_members" },
  { key: "page_members", label: "Page members", suffix: "?tab=page_members" },
] as const;

export type PersonalPageTabKey = (typeof tabs)[number]["key"];

export function normalizePersonalPageTabKey(
  value: string | null | undefined
): PersonalPageTabKey {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();

  const match = tabs.find((tab) => tab.key === normalized);
  return match ? match.key : "notes";
}

export default function PersonalPageTabs({
  pageId,
  active,
}: {
  pageId: string;
  active: PersonalPageTabKey;
}) {
  return (
    <nav className="flex flex-wrap gap-2 border-b border-slate-200 pb-4 text-sm">
      {tabs.map((tab) => (
        <Link
          key={tab.key}
          href={`/personal/${pageId}${tab.suffix}`}
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

