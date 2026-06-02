import { headers } from "next/headers";
import { withPerfTiming } from "@/lib/perf";

const MIDDLEWARE_USER_ID_HEADER = "x-resopshub-user-id";
const MIDDLEWARE_USER_EMAIL_HEADER = "x-resopshub-user-email";
const UUID_V4ISH_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type CurrentRequestUser = {
  id: string;
  email: string | null;
  user_metadata?: Record<string, unknown> | null;
};

export type AuthCapableClient = {
  auth: {
    getUser: () => Promise<{
      data: {
        user: {
          id: string;
          email?: string | null;
          user_metadata?: Record<string, unknown> | null;
        } | null;
      };
    }>;
  };
};

export type CurrentRequestUserOptions = {
  trustForwardedUserHeaders?: boolean;
};

export async function getCurrentRequestUser(
  supabase: AuthCapableClient,
  timingLabel = "auth",
  options: CurrentRequestUserOptions = {}
) {
  const trustForwardedUserHeaders = options.trustForwardedUserHeaders ?? true;

  if (trustForwardedUserHeaders) {
    const headerList = await headers();
    const forwardedUserId = String(headerList.get(MIDDLEWARE_USER_ID_HEADER) || "").trim();
    const forwardedUserEmail = String(headerList.get(MIDDLEWARE_USER_EMAIL_HEADER) || "").trim();

    if (UUID_V4ISH_REGEX.test(forwardedUserId)) {
      return {
        id: forwardedUserId,
        email: forwardedUserEmail || null,
        user_metadata: null,
      } satisfies CurrentRequestUser;
    }
  }

  const { data: authData } = await withPerfTiming(timingLabel, () => supabase.auth.getUser());
  const user = authData.user;
  if (!user?.id) return null;
  return {
    id: user.id,
    email: user.email ?? null,
    user_metadata: user.user_metadata ?? null,
  } satisfies CurrentRequestUser;
}
