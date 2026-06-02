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

type EmployeeInfoAccessProfileContext = {
  currentAppUserId: string;
  isAdmin: boolean;
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

export type EmployeeInfoColumnManagementAccessResult =
  | {
      ok: true;
      user: CurrentRequestUser;
      currentAppUserId: string;
      isAdmin: boolean;
      canManageColumns: boolean;
    }
  | {
      ok: false;
      reason: "unauthenticated";
      error: "Unauthorized";
      user: null;
      currentAppUserId: null;
      isAdmin: false;
      canManageColumns: false;
    }
  | {
      ok: false;
      reason: "permission_error";
      error: string;
      user: CurrentRequestUser;
      currentAppUserId: string;
      isAdmin: boolean;
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

async function loadEmployeeInfoAccessProfile(
  supabase: EmployeeInfoAccessClient,
  user: CurrentRequestUser,
  authUserId: string,
  profileTimingLabel?: string
): Promise<EmployeeInfoAccessProfileContext> {
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

  return {
    currentAppUserId: profile?.id || authUserId,
    isAdmin: profile?.role === "admin",
  };
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

  const { currentAppUserId, isAdmin } = await loadEmployeeInfoAccessProfile(
    supabase,
    user,
    authUserId,
    profileTimingLabel
  );
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

export async function getEmployeeInfoColumnManagementAccess(
  supabase: EmployeeInfoAccessClient,
  {
    authTimingLabel,
    profileTimingLabel,
    manageColumnsRpcName,
  }: {
    authTimingLabel: string;
    profileTimingLabel?: string;
    manageColumnsRpcName: string;
  }
): Promise<EmployeeInfoColumnManagementAccessResult> {
  const user = await getCurrentRequestUser(supabase, authTimingLabel);
  const authUserId = user?.id;
  if (!user || !authUserId) {
    return {
      ok: false,
      reason: "unauthenticated",
      error: "Unauthorized",
      user: null,
      currentAppUserId: null,
      isAdmin: false,
      canManageColumns: false,
    };
  }

  const { currentAppUserId, isAdmin } = await loadEmployeeInfoAccessProfile(
    supabase,
    user,
    authUserId,
    profileTimingLabel
  );
  const manageColumnsResult = await supabase.rpc(manageColumnsRpcName);
  if (
    !isSupabaseMissingFunctionError(manageColumnsResult.error) &&
    manageColumnsResult.error
  ) {
    return {
      ok: false,
      reason: "permission_error",
      error: manageColumnsResult.error.message || "Failed to check column permissions",
      user,
      currentAppUserId,
      isAdmin,
      canManageColumns: false,
    };
  }

  return {
    ok: true,
    user,
    currentAppUserId,
    isAdmin,
    canManageColumns: resolveOptionalAccessRpcBoolean(manageColumnsResult, isAdmin),
  };
}
