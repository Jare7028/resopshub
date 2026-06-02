import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/api/requireApiUser";
import { logOutlookImportTelemetry } from "@/lib/outlookImportTelemetry";
import {
  OutlookImportValidationError,
  mapOutlookImportDuplicateMatches,
  prepareOutlookImportPreview,
  type OutlookImportPreviewResponse,
} from "@/lib/outlookTaskImport";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isSupabaseMissingTableError } from "@/lib/supabaseErrors";

type DuplicateRow = {
  task_id?: string | null;
  created_at?: string | null;
  tasks?:
    | { id?: string | null; title?: string | null; created_at?: string | null }
    | Array<{ id?: string | null; title?: string | null; created_at?: string | null }>
    | null;
};

export async function POST(request: Request) {
  const supabase = createSupabaseServerClient();
  const auth = await requireApiUser(supabase, "outlook.import.preview.auth");
  if (auth.response) return auth.response;
  const emit = (event: Parameters<typeof logOutlookImportTelemetry>[0], payload: Record<string, unknown>) =>
    logOutlookImportTelemetry(event, payload, {
      supabase,
      userId: auth.user.id,
    });
  emit("outlook_import_opened", { route: "preview" });

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  try {
    const prepared = prepareOutlookImportPreview(payload);
    const { data: duplicateRowsRaw, error: duplicateError } = await supabase
      .from("task_email_sources")
      .select("task_id,created_at,tasks(id,title,created_at)")
      .eq("provider", "outlook")
      .eq("selected_message_id", prepared.payload.selectedMessageId)
      .order("created_at", { ascending: false })
      .limit(20);

    if (duplicateError) {
      if (isSupabaseMissingTableError(duplicateError)) {
        return NextResponse.json(
          {
            error:
              "Outlook import schema is missing. Apply sql/task_email_sources.sql before using this endpoint.",
          },
          { status: 500 }
        );
      }
      return NextResponse.json({ error: duplicateError.message }, { status: 500 });
    }

    const duplicateMatches = mapOutlookImportDuplicateMatches(
      (duplicateRowsRaw || []) as DuplicateRow[]
    );
    const warnings = [...prepared.warnings];
    if (duplicateMatches.length) {
      warnings.push("This email appears to have been imported previously.");
      emit("outlook_import_duplicate_warning", {
        selectedMessageId: prepared.payload.selectedMessageId,
        duplicateCount: duplicateMatches.length,
      });
    }

    const response: OutlookImportPreviewResponse = {
      normalizedTitle: prepared.normalizedTitle,
      normalizedTaskContent: prepared.normalizedTaskContent,
      normalizedTaskContentText: prepared.normalizedTaskContentText,
      normalizedNotesText: prepared.normalizedNotesText,
      duplicateMatches,
      warnings: Array.from(new Set(warnings)),
    };

    emit("outlook_import_preview_success", {
      selectedMessageId: prepared.payload.selectedMessageId,
      threadMessages: prepared.payload.thread.length,
      attachmentCount: prepared.attachmentCount,
      duplicateCount: duplicateMatches.length,
      normalizedTextBytes: prepared.normalizedTextBytes,
    });

    return NextResponse.json(response);
  } catch (error) {
    if (error instanceof OutlookImportValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    const message = error instanceof Error ? error.message : "Failed to prepare import preview";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
