import { cookies } from "next/headers";
import { createServerClient, type CookieOptions } from "@supabase/ssr";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL as string;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string;

export function createSupabaseServerClient() {
  const cookieStorePromise = Promise.resolve(cookies());

  return createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      get(name: string) {
        return cookieStorePromise.then((store) => store.get(name)?.value);
      },
      set(name: string, value: string, options: CookieOptions) {
        return cookieStorePromise.then((store) => {
          try {
            store.set({ name, value, ...options });
          } catch {
            // Ignore if called from a Server Component where cookies are read-only.
          }
        });
      },
      remove(name: string, options: CookieOptions) {
        return cookieStorePromise.then((store) => {
          try {
            store.set({ name, value: "", ...options, maxAge: 0 });
          } catch {
            // Ignore if called from a Server Component where cookies are read-only.
          }
        });
      },
    },
  });
}
