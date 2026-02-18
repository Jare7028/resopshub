import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isSupabaseMissingFunctionError } from "@/lib/supabaseErrors";
import type { ClientPageTabKey } from "../_components/clientPageTabs";

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
