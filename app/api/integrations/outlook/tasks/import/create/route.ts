import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { logOutlookImportTelemetry } from "@/lib/outlookImportTelemetry";
import {
  OutlookImportValidationError,
  buildTiptapDocFromPlainText,
  buildOutlookImportSourceMetadata,
  countOutlookImportAttachments,
  mapOutlookImportDuplicateMatches,
  parseOutlookImportCreateRequest,
  prepareOutlookImportPreview,
  type OutlookImportCreateResponse,
} from "@/lib/outlookTaskImport";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isSupabaseMissingTableError } from "@/lib/supabaseErrors";
import { extractPlainText } from "@/lib/tiptapText";

type DuplicateRow = {
  task_id?: string | null;
  created_at?: string | null;
  tasks?:
    | { id?: string | null; title?: string | null; created_at?: string | null }
    | Array<{ id?: string | null; title?: string | null; created_at?: string | null }>
    | null;
};

function formatDbError(
  context: string,
  error:
    | { message: string; code?: string; details?: string | null; hint?: string | null }
    | null
    | undefined
) {
  if (!error) return context;
  const parts = [`[${context}]`, error.message];
  if (error.code) parts.push(`code=${error.code}`);
  if (error.details) parts.push(`details=${error.details}`);
  if (error.hint) parts.push(`hint=${error.hint}`);
  return parts.join(" | ");
}

export async function POST(request: Request) {
  const supabase = createSupabaseServerClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const authUser = authData.user;
  const emit = (event: Parameters<typeof logOutlookImportTelemetry>[0], payload: Record<string, unknown>) =>
    logOutlookImportTelemetry(event, payload, {
      supabase,
      userId: authUser.id,
    });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  try {
    const parsedCreate = parseOutlookImportCreateRequest(body);
    const importedAtIso = new Date().toISOString();
    const prepared = prepareOutlookImportPreview(parsedCreate.previewPayload, {
      importedAtIso,
    });

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
    if (duplicateMatches.length && !parsedCreate.createDespiteDuplicate) {
      emit("outlook_import_duplicate_warning", {
        selectedMessageId: prepared.payload.selectedMessageId,
        duplicateCount: duplicateMatches.length,
        blocked: true,
      });
      return NextResponse.json(
        {
          error:
            "A task was already created from this email. Set createDespiteDuplicate to true to continue.",
          duplicateMatches,
        },
        { status: 409 }
      );
    }

    const { data: currentUserRow } = await supabase
      .from("users")
      .select("id")
      .eq("email", authUser.email || "")
      .maybeSingle();
    const currentAppUserId = String(currentUserRow?.id || "").trim() || authUser.id;
    const assigneeUserId = parsedCreate.assigneeUserId || currentAppUserId;

    const { data: assigneeRow, error: assigneeLookupError } = await supabase
      .from("users")
      .select("id")
      .eq("id", assigneeUserId)
      .maybeSingle();
    if (assigneeLookupError) {
      return NextResponse.json(
        {
          error: formatDbError(
            "outlook.import.create.assignee.lookup",
            assigneeLookupError
          ),
        },
        { status: 400 }
      );
    }
    if (!assigneeRow) {
      return NextResponse.json(
        { error: "Assignee user was not found or is not accessible." },
        { status: 400 }
      );
    }

    const taskId = randomUUID();
    let taskContent: unknown = prepared.normalizedTaskContent;
    let taskContentText = prepared.normalizedTaskContentText;
    if (parsedCreate.notesText && parsedCreate.notesText !== prepared.normalizedNotesText) {
      taskContent = buildTiptapDocFromPlainText(parsedCreate.notesText);
      taskContentText = extractPlainText(taskContent);
    }
    const { error: taskInsertError } = await supabase.from("tasks").insert({
      id: taskId,
      title: parsedCreate.title || prepared.normalizedTitle,
      status: "to_do",
      priority: "medium",
      due_date: parsedCreate.dueDate,
      due_time: parsedCreate.dueTime,
      assignee_user_id: assigneeUserId,
      created_by_user_id: currentAppUserId,
      client_id: parsedCreate.clientId,
      project_id: parsedCreate.projectId,
      content: taskContent,
      content_text: taskContentText,
    });

    if (taskInsertError) {
      return NextResponse.json(
        {
          error: formatDbError(
            "outlook.import.create.tasks.insert",
            taskInsertError
          ),
        },
        { status: 400 }
      );
    }

    const rollbackTask = async () => {
      await supabase.from("tasks").delete().eq("id", taskId);
    };

    const { error: assigneeInsertError } = await supabase.from("task_assignees").upsert(
      {
        task_id: taskId,
        user_id: assigneeUserId,
      },
      { onConflict: "task_id,user_id" }
    );
    if (assigneeInsertError) {
      await rollbackTask();
      return NextResponse.json(
        {
          error: formatDbError(
            "outlook.import.create.task_assignees.upsert",
            assigneeInsertError
          ),
        },
        { status: 400 }
      );
    }

    const sourceMetadata = buildOutlookImportSourceMetadata({
      payload: prepared.payload,
      importedAtIso,
    });

    const { error: sourceInsertError } = await supabase
      .from("task_email_sources")
      .insert({
        task_id: taskId,
        provider: "outlook",
        selected_message_id: prepared.payload.selectedMessageId,
        internet_message_id: prepared.payload.internetMessageId || null,
        conversation_id: prepared.payload.conversationId || null,
        mailbox_email: prepared.payload.mailbox.userEmail,
        imported_by_user_id: currentAppUserId,
        thread_message_count: prepared.payload.thread.length,
        attachment_count: countOutlookImportAttachments(prepared.payload.thread),
        metadata: sourceMetadata,
      });

    if (sourceInsertError) {
      await rollbackTask();
      return NextResponse.json(
        {
          error: formatDbError(
            "outlook.import.create.task_email_sources.insert",
            sourceInsertError
          ),
        },
        { status: 400 }
      );
    }

    const response: OutlookImportCreateResponse = {
      taskId,
      taskHref: `/tasks/${taskId}`,
      duplicateWarningShown: duplicateMatches.length > 0,
    };

    emit("outlook_import_create_success", {
      taskId,
      selectedMessageId: prepared.payload.selectedMessageId,
      duplicateWarningShown: duplicateMatches.length > 0,
      threadMessages: prepared.payload.thread.length,
      attachmentCount: prepared.attachmentCount,
      normalizedTextBytes: prepared.normalizedTextBytes,
    });

    return NextResponse.json(response);
  } catch (error) {
    const message =
      error instanceof OutlookImportValidationError
        ? error.message
        : error instanceof Error
          ? error.message
          : "Failed to create task from Outlook import.";
    emit("outlook_import_create_failure", {
      error: message,
    });
    return NextResponse.json(
      { error: message },
      { status: error instanceof OutlookImportValidationError ? 400 : 500 }
    );
  }
}
