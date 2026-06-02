import {
  getCurrentRequestUser,
  type AuthCapableClient,
  type CurrentRequestUser,
} from "@/lib/supabase/currentUser";

type AdminProfile = {
  id: string;
  role: string | null;
};

type AdminProfileClient = AuthCapableClient & {
  from: (tableName: string) => unknown;
};

type AdminProfileQuery = {
  select: (columns: string) => {
    eq: (
      column: string,
      value: string
    ) => {
      maybeSingle: () => PromiseLike<{ data: AdminProfile | null }>;
    };
  };
};

type AdminAccessSuccess = {
  ok: true;
  user: CurrentRequestUser;
  profile: AdminProfile;
};

type AdminAccessFailure = {
  ok: false;
  reason: "unauthenticated" | "forbidden";
  user: null;
  profile: null;
};

export type AdminAccessResult = AdminAccessSuccess | AdminAccessFailure;

export async function getAdminAccess(
  supabase: AdminProfileClient,
  timingLabel = "admin.access.auth"
): Promise<AdminAccessResult> {
  const user = await getCurrentRequestUser(supabase, timingLabel);
  if (!user?.email) {
    return {
      ok: false,
      reason: "unauthenticated",
      user: null,
      profile: null,
    };
  }

  const usersQuery = supabase.from("users") as AdminProfileQuery;
  const { data: profile } = await usersQuery
    .select("id,role")
    .eq("email", user.email)
    .maybeSingle();

  if (profile?.role !== "admin") {
    return {
      ok: false,
      reason: "forbidden",
      user: null,
      profile: null,
    };
  }

  return {
    ok: true,
    user,
    profile: {
      id: String(profile.id),
      role: String(profile.role || ""),
    },
  };
}
