import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import {
  BrowserTaskCaptureValidationError,
  buildBrowserCaptureTaskContent,
  parseBrowserTaskCaptureCreateRequest,
  type BrowserTaskCaptureCreateResponse,
} from "@/lib/browserTaskCapture";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { extractPlainText } from "@/lib/tiptapText";

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

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  try {
    const parsed = parseBrowserTaskCaptureCreateRequest(body);
    const { data: currentUserRow } = await supabase
      .from("users")
      .select("id")
      .eq("email", authUser.email || "")
      .maybeSingle();

    const currentAppUserId = String(currentUserRow?.id || "").trim() || authUser.id;
    const assigneeUserId = parsed.assigneeUserId || currentAppUserId;

    const { data: assigneeRow, error: assigneeLookupError } = await supabase
      .from("users")
      .select("id")
      .eq("id", assigneeUserId)
      .maybeSingle();
    if (assigneeLookupError) {
      return NextResponse.json(
        {
          error: formatDbError(
            "browser.capture.create.assignee.lookup",
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

    const capturedAtIso = new Date().toISOString();
    const taskContent = buildBrowserCaptureTaskContent({
      selectedText: parsed.selectedText,
      sourceUrl: parsed.sourceUrl,
      sourceTitle: parsed.sourceTitle,
      capturedAtIso,
    });
    const taskContentText = extractPlainText(taskContent);
    const taskId = randomUUID();

    const { error: taskInsertError } = await supabase.from("tasks").insert({
      id: taskId,
      title: parsed.title,
      status: "to_do",
      priority: "medium",
      due_date: parsed.dueDate,
      due_time: parsed.dueTime,
      assignee_user_id: assigneeUserId,
      created_by_user_id: currentAppUserId,
      client_id: parsed.clientId,
      project_id: parsed.projectId,
      content: taskContent,
      content_text: taskContentText,
    });
    if (taskInsertError) {
      return NextResponse.json(
        {
          error: formatDbError("browser.capture.create.tasks.insert", taskInsertError),
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
            "browser.capture.create.task_assignees.upsert",
            assigneeInsertError
          ),
        },
        { status: 400 }
      );
    }

    const response: BrowserTaskCaptureCreateResponse = {
      taskId,
      taskHref: `/tasks/${taskId}`,
    };

    return NextResponse.json(response);
  } catch (error) {
    const message =
      error instanceof BrowserTaskCaptureValidationError
        ? error.message
        : error instanceof Error
          ? error.message
          : "Failed to create task from browser capture.";
    return NextResponse.json(
      { error: message },
      { status: error instanceof BrowserTaskCaptureValidationError ? 400 : 500 }
    );
  }
}

