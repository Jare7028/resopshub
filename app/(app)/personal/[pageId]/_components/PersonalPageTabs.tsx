import Link from "next/link";

const baseTabs = [
  { key: "notes", label: "Notes", suffix: "" },
  { key: "page_members", label: "Page members", suffix: "?tab=page_members" },
] as const;

const sectionMembersTab = {
  key: "section_members",
  label: "Section members",
  suffix: "?tab=section_members",
} as const;

export type PersonalPageTabKey =
  | (typeof baseTabs)[number]["key"]
  | typeof sectionMembersTab.key;

export function normalizePersonalPageTabKey(
  value: string | null | undefined
): PersonalPageTabKey {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();

  const allTabs = [...baseTabs, sectionMembersTab] as const;
  const match = allTabs.find((tab) => tab.key === normalized);
  return match ? match.key : "notes";
}

export default function PersonalPageTabs({
  pageId,
  active,
  sectionId,
  extra,
}: {
  pageId: string;
  active: PersonalPageTabKey;
  sectionId?: string | null;
  extra?: import("react").ReactNode;
}) {
  const tabs = sectionId ? [baseTabs[0], sectionMembersTab, baseTabs[1]] : baseTabs;

  return (
    <nav className="flex flex-wrap items-start justify-between gap-2 border-b border-slate-200 pb-4 text-sm">
      <div className="flex flex-wrap gap-2">
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
      </div>
      {extra ? <div className="relative">{extra}</div> : null}
    </nav>
  );
}
