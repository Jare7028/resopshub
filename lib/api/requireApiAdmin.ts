import { NextResponse } from "next/server";
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
  from: (table: string) => unknown;
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

type AdminAuthSuccess = {
  user: CurrentRequestUser;
  profile: AdminProfile;
  response: null;
};

type AdminAuthFailure = {
  user: null;
  profile: null;
  response: NextResponse<{ ok: false; error: string }>;
};

export type RequireApiAdminResult = AdminAuthSuccess | AdminAuthFailure;

export function adminApiAuthResponse(error: string, status: 401 | 403) {
  return NextResponse.json({ ok: false as const, error }, { status });
}

export async function requireApiAdmin(
  supabase: AdminProfileClient,
  timingLabel = "api.admin.auth"
): Promise<RequireApiAdminResult> {
  const user = await getCurrentRequestUser(supabase, timingLabel, {
    trustForwardedUserHeaders: false,
  });
  if (!user?.email) {
    return {
      user: null,
      profile: null,
      response: adminApiAuthResponse("Unauthorized", 401),
    };
  }

  const usersQuery = supabase.from("users") as AdminProfileQuery;
  const { data: profile } = await usersQuery
    .select("id,role")
    .eq("email", user.email)
    .maybeSingle();

  if (profile?.role !== "admin") {
    return {
      user: null,
      profile: null,
      response: adminApiAuthResponse("Forbidden", 403),
    };
  }

  return {
    user,
    profile: {
      id: String(profile.id),
      role: String(profile.role || ""),
    },
    response: null,
  };
}
