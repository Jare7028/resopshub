import { cookies } from "next/headers";
import {
  createServerClient,
  type CookieOptions,
  type SetAllCookies,
} from "@supabase/ssr";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL as string;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string;

export function createSupabaseServerClient() {
  const cookieStorePromise = Promise.resolve(cookies());

  return createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return cookieStorePromise.then((store) =>
          store.getAll().map(({ name, value }) => ({ name, value }))
        );
      },
      setAll(cookiesToSet: Parameters<SetAllCookies>[0]) {
        return cookieStorePromise.then((store) => {
          try {
            for (const { name, value, options } of cookiesToSet) {
              store.set({ name, value, ...options });
            }
          } catch {
            // Ignore if called from a Server Component where cookies are read-only.
          }
        });
      },
    },
    cookieOptions: {
      path: "/",
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
    } as CookieOptions,
  });
}
