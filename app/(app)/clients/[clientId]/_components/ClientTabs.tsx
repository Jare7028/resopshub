import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isSupabaseMissingFunctionError } from "@/lib/supabaseErrors";
import { CLIENT_PAGE_TABS, type ClientPageTabKey } from "./clientPageTabs";

export default async function ClientTabs({
  clientId,
  active,
}: {
  clientId: string;
  active: ClientPageTabKey;
}) {
  const supabase = createSupabaseServerClient();
  const accessListResult = await supabase.rpc("client_page_access_list", {
    client_uuid: clientId,
  });
  const shouldFallbackToAllTabs =
    isSupabaseMissingFunctionError(accessListResult.error) || Boolean(accessListResult.error);

  const accessByKey = new Map(
    ((accessListResult.data || []) as Array<{ page_key: string | null; access_level: string | null }>).map(
      (row) => [String(row.page_key || "").trim(), String(row.access_level || "none").trim()]
    )
  );
  const tabs = shouldFallbackToAllTabs
    ? CLIENT_PAGE_TABS
    : CLIENT_PAGE_TABS.filter((tab) => {
        const level = accessByKey.get(tab.key) || "none";
        return level === "view" || level === "edit";
      });

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
