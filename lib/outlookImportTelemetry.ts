import { logError, logInfo } from "@/lib/vercelLogger";

export type OutlookImportTelemetryEvent =
  | "outlook_import_opened"
  | "outlook_import_preview_success"
  | "outlook_import_duplicate_warning"
  | "outlook_import_create_success"
  | "outlook_import_create_failure";

type TelemetryPayload = Record<string, unknown>;

type TelemetryInsertClient = {
  from: (table: string) => {
    insert: (
      values: Record<string, unknown>
    ) => PromiseLike<{ error?: { message?: string } | null }> | { error?: { message?: string } | null };
  };
};

type TelemetryOptions = {
  supabase?: TelemetryInsertClient;
  userId?: string | null;
};

export function logOutlookImportTelemetry(
  event: OutlookImportTelemetryEvent,
  payload: TelemetryPayload = {},
  options?: TelemetryOptions
) {
  logInfo(`telemetry.${event}`, {
    payload,
    userId: options?.userId || null,
  });

  if (!options?.supabase) {
    return;
  }

  const insertResult = options.supabase.from("outlook_import_events").insert({
      event_name: event,
      user_id: options.userId || null,
      payload,
    });

  void Promise.resolve(insertResult)
    .then(({ error }) => {
      if (error) {
        logError(`telemetry.${event}.insert_failed`, {
          userId: options.userId || null,
          message: error.message || "unknown error",
        });
      }
    })
    .catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      logError(`telemetry.${event}.insert_failed`, {
        userId: options.userId || null,
        message,
      });
    });
}
