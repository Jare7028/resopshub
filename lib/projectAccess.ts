import {
  getCurrentRequestUser,
  type AuthCapableClient,
  type CurrentRequestUser,
} from "@/lib/supabase/currentUser";

export type ProjectRequesterProfile = {
  id: string;
  role: string | null;
};

type QueryError = {
  message?: string;
};

type MaybeSingleResult<T> = {
  data: T | null;
  error?: QueryError | null;
};

type ProjectAccessQuery<T> = {
  select: (columns: string) => ProjectAccessFilter<T>;
};

type ProjectAccessFilter<T> = {
  eq: (column: string, value: string) => ProjectAccessFilter<T>;
  maybeSingle: () => PromiseLike<MaybeSingleResult<T>>;
};

type ProjectAccessClient = AuthCapableClient & {
  from: (tableName: string) => unknown;
};

type ProjectRequesterSuccess = {
  ok: true;
  user: CurrentRequestUser;
  profile: ProjectRequesterProfile;
};

type ProjectRequesterFailure = {
  ok: false;
  reason: "unauthenticated" | "profile_missing";
  user: null;
  profile: null;
  error?: string;
};

export type ProjectRequesterResult =
  | ProjectRequesterSuccess
  | ProjectRequesterFailure;

type ProjectReadAccessSuccess = {
  ok: true;
};

type ProjectReadAccessFailure = {
  ok: false;
  reason: "forbidden";
  error?: string;
};

export type ProjectReadAccessResult =
  | ProjectReadAccessSuccess
  | ProjectReadAccessFailure;

export async function getProjectRequesterProfile(
  supabase: ProjectAccessClient,
  timingLabel = "projects.access.auth"
): Promise<ProjectRequesterResult> {
  const user = await getCurrentRequestUser(supabase, timingLabel);
  const authEmail = String(user?.email || "").trim();
  if (!user || !authEmail) {
    return {
      ok: false,
      reason: "unauthenticated",
      user: null,
      profile: null,
    };
  }

  const usersQuery = supabase.from("users") as ProjectAccessQuery<{
    id: string | null;
    role: string | null;
  }>;
  const { data: profile, error } = await usersQuery
    .select("id,role")
    .eq("email", authEmail)
    .maybeSingle();

  const profileId = String(profile?.id || "").trim();
  if (error || !profileId) {
    return {
      ok: false,
      reason: "profile_missing",
      user: null,
      profile: null,
      error: error?.message,
    };
  }

  return {
    ok: true,
    user,
    profile: {
      id: profileId,
      role: profile?.role || null,
    },
  };
}

export async function getProjectReadAccess(
  supabase: ProjectAccessClient,
  {
    projectId,
    profile,
  }: {
    projectId: string;
    profile: ProjectRequesterProfile;
  }
): Promise<ProjectReadAccessResult> {
  if (profile.role === "admin") {
    return { ok: true };
  }

  const projectUsersQuery = supabase.from("project_users") as ProjectAccessQuery<{
    user_id: string | null;
  }>;
  const { data: assignment, error: assignmentError } = await projectUsersQuery
    .select("user_id")
    .eq("project_id", projectId)
    .eq("user_id", profile.id)
    .maybeSingle();

  if (assignment) {
    return { ok: true };
  }

  const projectWatchersQuery = supabase.from("project_watchers") as ProjectAccessQuery<{
    user_id: string | null;
  }>;
  const { data: watching, error: watcherError } = await projectWatchersQuery
    .select("user_id")
    .eq("project_id", projectId)
    .eq("user_id", profile.id)
    .maybeSingle();

  if (watching) {
    return { ok: true };
  }

  return {
    ok: false,
    reason: "forbidden",
    error: assignmentError?.message || watcherError?.message,
  };
}

export function projectAccessRedirectError(
  result: ProjectRequesterResult | ProjectReadAccessResult
) {
  if (result.ok) {
    return "";
  }
  if (result.reason === "unauthenticated") {
    return "Unauthorized";
  }
  if (result.reason === "profile_missing") {
    return result.error || "User profile missing";
  }
  return result.error || "Not assigned to that project";
}
