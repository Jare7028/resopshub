import AppNavLink from "../../../_components/AppNavLink";
import { type ClientPageTab, type ClientPageTabKey } from "./clientPageTabs";

export default function ClientTabs({
  clientId,
  active,
  tabs,
}: {
  clientId: string;
  active: ClientPageTabKey;
  tabs: ClientPageTab[];
}) {
  return (
    <nav className="flex flex-wrap gap-2 border-b border-slate-200 pb-4 text-sm">
      {tabs.map((tab) => (
        <AppNavLink
          key={tab.key}
          href={`/clients/${clientId}${tab.suffix}`}
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
