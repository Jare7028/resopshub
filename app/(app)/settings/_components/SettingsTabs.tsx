import Link from "next/link";

const tabs = [
  { key: "profile", label: "Profile" },
  { key: "notifications", label: "Notifications" },
] as const;

export type SettingsTabKey = (typeof tabs)[number]["key"];

export function normalizeSettingsTabKey(
  value: string | null | undefined
): SettingsTabKey {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();

  const match = tabs.find((tab) => tab.key === normalized);
  return match ? match.key : "profile";
}

export default function SettingsTabs({ active }: { active: SettingsTabKey }) {
  return (
    <nav className="flex flex-wrap gap-2 border-b border-slate-200 pb-4 text-sm">
      {tabs.map((tab) => (
        <Link
          key={tab.key}
          href={tab.key === "profile" ? "/settings" : `/settings?tab=${tab.key}`}
          className={`rounded-md px-3 py-1.5 font-medium ${
            active === tab.key
              ? "tab-active"
              : "border border-slate-200 text-slate-700 hover:bg-slate-100 hover:text-slate-900"
          }`}
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}

