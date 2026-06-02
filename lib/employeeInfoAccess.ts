import { withPerfTiming } from "@/lib/perf";
import {
  getCurrentRequestUser,
  type AuthCapableClient,
  type CurrentRequestUser,
} from "@/lib/supabase/currentUser";
import { isSupabaseMissingFunctionError } from "@/lib/supabaseErrors";

type QueryError = {
  message?: string;
  code?: string;
};

type MaybeSingleResult<T> = {
  data: T | null;
  error?: QueryError | null;
};

type RpcBooleanResult = {
  data: boolean | null;
  error?: QueryError | null;
};

type EmployeeInfoAccessQuery<T> = {
  select: (columns: string) => EmployeeInfoAccessFilter<T>;
};

type EmployeeInfoAccessFilter<T> = {
  eq: (column: string, value: string) => EmployeeInfoAccessFilter<T>;
  maybeSingle: () => PromiseLike<MaybeSingleResult<T>>;
};

type EmployeeInfoAccessClient = AuthCapableClient & {
  from: (tableName: string) => unknown;
  rpc: (functionName: string) => PromiseLike<RpcBooleanResult>;
};

type EmployeeInfoAccessProfile = {
  id: string | null;
  role: string | null;
};

export type EmployeeInfoAccessResult =
  | {
      ok: true;
      user: CurrentRequestUser;
      currentAppUserId: string;
      isAdmin: boolean;
      canAccess: boolean;
      canManageColumns: boolean;
    }
  | {
      ok: false;
      reason: "unauthenticated";
      user: null;
      currentAppUserId: null;
      isAdmin: false;
      canAccess: false;
      canManageColumns: false;
    };

export function resolveOptionalAccessRpcBoolean(
  result: RpcBooleanResult,
  fallback: boolean
) {
  if (!isSupabaseMissingFunctionError(result.error) && !result.error) {
    return Boolean(result.data);
  }
  return fallback;
}

export async function getEmployeeInfoAccess(
  supabase: EmployeeInfoAccessClient,
  {
    authTimingLabel,
    profileTimingLabel,
    accessRpcName,
    manageColumnsRpcName,
  }: {
    authTimingLabel: string;
    profileTimingLabel?: string;
    accessRpcName: string;
    manageColumnsRpcName?: string;
  }
): Promise<EmployeeInfoAccessResult> {
  const user = await getCurrentRequestUser(supabase, authTimingLabel);
  const authUserId = user?.id;
  if (!user || !authUserId) {
    return {
      ok: false,
      reason: "unauthenticated",
      user: null,
      currentAppUserId: null,
      isAdmin: false,
      canAccess: false,
      canManageColumns: false,
    };
  }

  const loadProfile = () => {
    const query = supabase.from("users") as EmployeeInfoAccessQuery<EmployeeInfoAccessProfile>;
    const selected = query.select("id,role");
    const authEmail = String(user.email || "").trim();
    return authEmail
      ? selected.eq("email", authEmail).maybeSingle()
      : selected.eq("id", authUserId).maybeSingle();
  };

  const { data: profile } = profileTimingLabel
    ? await withPerfTiming(profileTimingLabel, loadProfile)
    : await loadProfile();
  const currentAppUserId = profile?.id || authUserId;
  const isAdmin = profile?.role === "admin";
  const [accessResult, manageColumnsResult] = await Promise.all([
    supabase.rpc(accessRpcName),
    manageColumnsRpcName
      ? supabase.rpc(manageColumnsRpcName)
      : Promise.resolve(null),
  ]);

  return {
    ok: true,
    user,
    currentAppUserId,
    isAdmin,
    canAccess: resolveOptionalAccessRpcBoolean(accessResult, isAdmin),
    canManageColumns: manageColumnsResult
      ? resolveOptionalAccessRpcBoolean(manageColumnsResult, isAdmin)
      : isAdmin,
  };
}
