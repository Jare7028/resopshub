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

