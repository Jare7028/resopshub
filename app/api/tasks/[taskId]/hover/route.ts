import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/api/requireApiUser";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { buildTaskNotesPreview } from "@/lib/taskNotesPreview";

type RouteContext = {
  params: Promise<{ taskId: string }>;
};

export async function GET(_req: Request, context: RouteContext) {
  const supabase = createSupabaseServerClient();
  const auth = await requireApiUser(supabase, "tasks.hover.auth");
  if (!auth.user) return auth.response;

  const params = await context.params;
  const taskId = String(params.taskId || "").trim();
  if (!taskId) {
    return NextResponse.json({ error: "Missing task id" }, { status: 400 });
  }

  const baseSelect = "id,title,status,due_date,due_time,assignee_user_id";
  let { data: task, error } = await supabase
    .from("tasks")
    .select(`${baseSelect},content_text,content`)
    .eq("id", taskId)
    .maybeSingle();

  if (error && String(error.message || "").toLowerCase().includes("content_text")) {
    const fallbackResponse = await supabase
      .from("tasks")
      .select(`${baseSelect},content`)
      .eq("id", taskId)
      .maybeSingle();
    task = fallbackResponse.data
      ? { ...fallbackResponse.data, content_text: null }
      : null;
    error = fallbackResponse.error;
  }

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  if (!task) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }

  let assignee: string | null = null;
  if (task.assignee_user_id) {
    const { data: userRow } = await supabase
      .from("users")
      .select("full_name,email")
      .eq("id", task.assignee_user_id)
      .maybeSingle();
    assignee = userRow?.full_name || userRow?.email || null;
  }
  const notesPreview = buildTaskNotesPreview({
    contentText: task.content_text,
    content: task.content,
  });

  return NextResponse.json({
    taskId: task.id,
    title: task.title,
    status: task.status || "to_do",
    dueDate: task.due_date,
    dueTime: task.due_time,
    assignee,
    notesPreview,
  });
}

export async function POST(req: Request, context: RouteContext) {
  const supabase = createSupabaseServerClient();
  const auth = await requireApiUser(supabase, "tasks.hover.auth");
  if (!auth.user) return auth.response;

  const params = await context.params;
  const taskId = String(params.taskId || "").trim();
  if (!taskId) {
    return NextResponse.json({ error: "Missing task id" }, { status: 400 });
  }

  let payload: { action?: string } = {};
  try {
    payload = (await req.json()) as { action?: string };
  } catch {
    payload = {};
  }

  if (payload.action !== "mark_done") {
    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  }

  const { error } = await supabase
    .from("tasks")
    .update({ status: "completed" })
    .eq("id", taskId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true, status: "completed" });
}
