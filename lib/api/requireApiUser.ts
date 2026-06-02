import { NextResponse } from "next/server";
import {
  getCurrentRequestUser,
  type AuthCapableClient,
  type CurrentRequestUser,
} from "@/lib/supabase/currentUser";

type ApiAuthSuccess = {
  user: CurrentRequestUser;
  response: null;
};

type ApiAuthFailure = {
  user: null;
  response: NextResponse<{ error: string }>;
};

export type RequireApiUserResult = ApiAuthSuccess | ApiAuthFailure;

export function unauthorizedApiResponse(message = "Unauthorized") {
  return NextResponse.json({ error: message }, { status: 401 });
}

export async function requireApiUser(
  supabase: AuthCapableClient,
  timingLabel?: string
): Promise<RequireApiUserResult> {
  const user = await getCurrentRequestUser(supabase, timingLabel);
  if (!user) {
    return {
      user: null,
      response: unauthorizedApiResponse(),
    };
  }

  return {
    user,
    response: null,
  };
}
