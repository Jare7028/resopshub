import type { CookieOptions } from "@supabase/ssr";

type SameSiteValue = NonNullable<CookieOptions["sameSite"]>;

function resolveSameSiteFromEnv(value: string | undefined): SameSiteValue | null {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  if (normalized === "lax" || normalized === "strict" || normalized === "none") {
    return normalized;
  }
  return null;
}

export function getSupabaseCookieOptions(): CookieOptions {
  const envSameSite = resolveSameSiteFromEnv(process.env.SUPABASE_COOKIE_SAMESITE);
  const sameSite: SameSiteValue =
    envSameSite || (process.env.NODE_ENV === "production" ? "none" : "lax");

  return {
    path: "/",
    sameSite,
    secure: process.env.NODE_ENV === "production" || sameSite === "none",
  };
}

