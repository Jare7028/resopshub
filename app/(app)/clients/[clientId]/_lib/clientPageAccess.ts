import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isSupabaseMissingFunctionError } from "@/lib/supabaseErrors";
import {
  CLIENT_PAGE_TABS,
  type ClientPageTab,
  type ClientPageTabKey,
} from "../_components/clientPageTabs";

type SupabaseClient = ReturnType<typeof createSupabaseServerClient>;
export type ClientPageAccessLevel = "none" | "view" | "edit";
export type ClientPageAccessMap = Map<ClientPageTabKey, ClientPageAccessLevel>;

const clientPageAccessLevels: ClientPageAccessLevel[] = ["none", "view", "edit"];

function normalizeAccessLevel(value: unknown): ClientPageAccessLevel {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  if (clientPageAccessLevels.includes(normalized as ClientPageAccessLevel)) {
    return normalized as ClientPageAccessLevel;
  }
  return "none";
}

function hasViewAccess(level: ClientPageAccessLevel | undefined) {
  return level === "view" || level === "edit";
}

function hasEditAccess(level: ClientPageAccessLevel | undefined) {
  return level === "edit";
}

function fallbackClientPageAccessData() {
  const accessByKey = new Map<ClientPageTabKey, ClientPageAccessLevel>(
    CLIENT_PAGE_TABS.map((tab) => [tab.key, "edit"])
  );

  return {
    accessByKey,
    visibleTabs: [...CLIENT_PAGE_TABS] as ClientPageTab[],
  };
}

export async function getClientPageAccessData(args: {
  supabase: SupabaseClient;
  clientId: string;
}): Promise<{ accessByKey: ClientPageAccessMap; visibleTabs: ClientPageTab[] }> {
  const accessListResult = await args.supabase.rpc("client_page_access_list", {
    client_uuid: args.clientId,
  });

  if (isSupabaseMissingFunctionError(accessListResult.error) || accessListResult.error) {
    return fallbackClientPageAccessData();
  }

  const accessByKey = new Map<ClientPageTabKey, ClientPageAccessLevel>(
    CLIENT_PAGE_TABS.map((tab) => [tab.key, "none"])
  );
  for (const row of (accessListResult.data || []) as Array<{
    page_key: string | null;
    access_level: string | null;
  }>) {
    const pageKey = String(row.page_key || "").trim() as ClientPageTabKey;
    if (!CLIENT_PAGE_TABS.some((tab) => tab.key === pageKey)) continue;
    accessByKey.set(pageKey, normalizeAccessLevel(row.access_level));
  }

  const visibleTabs = CLIENT_PAGE_TABS.filter((tab) => hasViewAccess(accessByKey.get(tab.key)));
  return {
    accessByKey,
    visibleTabs,
  };
}

export async function ensureClientPageViewAccess(args: {
  supabase: SupabaseClient;
  clientId: string;
  pageKey: ClientPageTabKey;
  accessByKey?: ClientPageAccessMap;
}) {
  if (args.accessByKey) {
    if (hasViewAccess(args.accessByKey.get(args.pageKey))) {
      return;
    }
    redirect(
      `/clients/${args.clientId}?error=${encodeURIComponent(
        "You do not have access to that client page."
      )}`
    );
  }

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
  accessByKey?: ClientPageAccessMap;
}) {
  if (args.accessByKey) {
    if (hasEditAccess(args.accessByKey.get(args.pageKey))) {
      return;
    }
    const basePath = args.redirectPath || buildClientPagePath(args.clientId, args.pageKey);
    const separator = basePath.includes("?") ? "&" : "?";
    redirect(
      `${basePath}${separator}error=${encodeURIComponent(
        "You do not have edit access to that client page."
      )}`
    );
  }

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
