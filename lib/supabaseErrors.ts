type MaybePostgrestError = { message?: string; code?: string } | null | undefined;

// PostgREST returns this when a table hasn't been created (or isn't visible in the schema cache).
// Example: "Could not find the table 'public.foo' in the schema cache"
export function isSupabaseMissingTableError(error: MaybePostgrestError): boolean {
  const code = String((error as { code?: string } | null | undefined)?.code || "");
  if (code === "PGRST205") return true;

  const message = String((error as { message?: string } | null | undefined)?.message || "");
  const msg = message.toLowerCase();
  return msg.includes("schema cache") && msg.includes("could not find the table");
}

// PostgREST returns this when an RPC function is missing.
// Example: "Could not find the function public.my_rpc() in the schema cache"
export function isSupabaseMissingFunctionError(error: MaybePostgrestError): boolean {
  const code = String((error as { code?: string } | null | undefined)?.code || "");
  if (code === "PGRST202") return true;

  const message = String((error as { message?: string } | null | undefined)?.message || "");
  const msg = message.toLowerCase();
  return msg.includes("schema cache") && msg.includes("could not find the function");
}

// PostgREST returns this when a selected/filtered column does not exist in schema cache.
// Example: "Could not find the 'foo' column of 'bar' in the schema cache"
export function isSupabaseMissingColumnError(error: MaybePostgrestError): boolean {
  const code = String((error as { code?: string } | null | undefined)?.code || "");
  if (code === "PGRST204") return true;

  const message = String((error as { message?: string } | null | undefined)?.message || "");
  const msg = message.toLowerCase();
  return msg.includes("schema cache") && msg.includes("could not find") && msg.includes("column");
}
