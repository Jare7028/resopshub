import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isSupabaseMissingFunctionError } from "@/lib/supabaseErrors";
import { CLIENT_PAGE_TABS, type ClientPageTabKey } from "../_components/clientPageTabs";

type SupabaseClient = ReturnType<typeof createSupabaseServerClient>;

export async function ensureClientPageViewAccess(args: {
  supabase: SupabaseClient;
  clientId: string;
  pageKey: ClientPageTabKey;
}) {
  const result = await args.supabase.rpc("can_view_client_page", {
    client_uuid: args.clientId,
    p_page_key: args.pageKey,
  });
  if (isSupabaseMissingFunctionError(result.error)) return;
  if (result.error || !result.data) {
    redirect(
      `/clients/${args.clientId}?error=${encodeURIComponent(
        "You do not have access to that client page."
      )}`
    );
  }
}

function buildClientPagePath(clientId: string, pageKey: ClientPageTabKey) {
  const tab = CLIENT_PAGE_TABS.find((row) => row.key === pageKey);
  return `/clients/${clientId}${tab?.suffix || ""}`;
}

export async function ensureClientPageEditAccess(args: {
  supabase: SupabaseClient;
  clientId: string;
  pageKey: ClientPageTabKey;
  redirectPath?: string;
}) {
  const result = await args.supabase.rpc("can_edit_client_page", {
    client_uuid: args.clientId,
    p_page_key: args.pageKey,
  });
  if (isSupabaseMissingFunctionError(result.error)) return;
  if (result.error || !result.data) {
    const basePath = args.redirectPath || buildClientPagePath(args.clientId, args.pageKey);
    const separator = basePath.includes("?") ? "&" : "?";
    redirect(
      `${basePath}${separator}error=${encodeURIComponent(
        "You do not have edit access to that client page."
      )}`
    );
  }
}
