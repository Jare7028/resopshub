import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type RouteContext = {
  params: Promise<{ taskId: string }>;
};

export async function GET(_req: Request, context: RouteContext) {
  const supabase = createSupabaseServerClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const params = await context.params;
  const taskId = String(params.taskId || "").trim();
  if (!taskId) {
    return NextResponse.json({ error: "Missing task id" }, { status: 400 });
  }

  const { data: task, error } = await supabase
    .from("tasks")
    .select("id,title,status,due_date,due_time,assignee_user_id")
    .eq("id", taskId)
    .maybeSingle();

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

  return NextResponse.json({
    taskId: task.id,
    title: task.title,
    status: task.status || "to_do",
    dueDate: task.due_date,
    dueTime: task.due_time,
    assignee,
  });
}

export async function POST(req: Request, context: RouteContext) {
  const supabase = createSupabaseServerClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

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
