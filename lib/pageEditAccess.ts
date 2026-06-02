import {
  getCurrentRequestUser,
  type AuthCapableClient,
  type CurrentRequestUser,
} from "@/lib/supabase/currentUser";

type PageEditAccessClient = AuthCapableClient & {
  rpc: (
    functionName: string,
    args: Record<string, unknown>
  ) => PromiseLike<{ data: boolean | null; error: { message?: string } | null }>;
};

type PageEditAccessSuccess = {
  ok: true;
  user: CurrentRequestUser;
};

type PageEditAccessFailure = {
  ok: false;
  reason: "unauthenticated" | "forbidden";
  user: null;
};

export type PageEditAccessResult = PageEditAccessSuccess | PageEditAccessFailure;

export async function getPageEditAccess(
  supabase: PageEditAccessClient,
  pageKey: string,
  timingLabel = `${pageKey}.edit.auth`
): Promise<PageEditAccessResult> {
  const user = await getCurrentRequestUser(supabase, timingLabel);
  if (!user) {
    return {
      ok: false,
      reason: "unauthenticated",
      user: null,
    };
  }

  const canEditResult = await supabase.rpc("can_edit_page", { p_page_key: pageKey });
  if (canEditResult.error || !canEditResult.data) {
    return {
      ok: false,
      reason: "forbidden",
      user: null,
    };
  }

  return {
    ok: true,
    user,
  };
}
