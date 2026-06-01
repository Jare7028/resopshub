import { createSupabaseBrowserClient } from "./supabase/client";

type SupabaseBrowserClient = ReturnType<typeof createSupabaseBrowserClient>;

let browserClient: SupabaseBrowserClient | null = null;

export function getSupabaseBrowserClient() {
  if (!browserClient) {
    browserClient = createSupabaseBrowserClient();
  }
  return browserClient;
}

export const supabase = new Proxy({} as SupabaseBrowserClient, {
  get(_target, prop) {
    const client = getSupabaseBrowserClient();
    const value = Reflect.get(client, prop, client);
    return typeof value === "function" ? value.bind(client) : value;
  },
});
