import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isAuthorizedCronRequest } from "@/lib/cron";

function formatYmdInTimeZone(date: Date, timeZone: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export async function GET(request: Request) {
  // Allow either Vercel Cron header or an explicit secret.
  if (
    process.env.NODE_ENV === "production" &&
    !isAuthorizedCronRequest(request)
  ) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json(
      { error: "Missing SUPABASE_SERVICE_ROLE_KEY" },
      { status: 500 }
    );
  }

  const timeZone = process.env.NOTIFICATIONS_TZ || "America/New_York";
  const today = formatYmdInTimeZone(new Date(), timeZone);
  const supabase = createSupabaseAdminClient();

  const buildTaskFilter = () =>
    supabase
      .from("tasks")
      .select("id,title,assignee_user_id,due_date,status")
      .not("assignee_user_id", "is", null)
      .not("status", "in", "(completed,cancelled)");

  const { data: dueTodayTasks, error: dueTodayError } = await buildTaskFilter().eq(
    "due_date",
    today
  );

  if (dueTodayError) {
    return NextResponse.json(
      { error: dueTodayError.message },
      { status: 500 }
    );
  }

  const { data: overdueTasks, error: overdueError } = await buildTaskFilter().lt(
    "due_date",
    today
  );

  if (overdueError) {
    return NextResponse.json({ error: overdueError.message }, { status: 500 });
  }

  const dueNotifications = (dueTodayTasks || []).map((task) => ({
    user_id: task.assignee_user_id as string,
    actor_user_id: null,
    type: "task_due_today",
    task_id: task.id as string,
    title: "Task due today",
    body: task.title as string,
    metadata: { due_date: task.due_date },
    dedupe_key: `task:${task.id}:due:${task.due_date ?? today}`,
  }));

  const overdueNotifications = (overdueTasks || []).map((task) => ({
    user_id: task.assignee_user_id as string,
    actor_user_id: null,
    type: "task_overdue",
    task_id: task.id as string,
    title: "Task overdue",
    body: task.title as string,
    metadata: { due_date: task.due_date },
    dedupe_key: `task:${task.id}:overdue:${task.due_date ?? today}`,
  }));

  const allNotifications = [...dueNotifications, ...overdueNotifications];
  if (!allNotifications.length) {
    return NextResponse.json({
      ok: true,
      timeZone,
      today,
      inserted: 0,
    });
  }

  const { error: insertError } = await supabase.from("notifications").upsert(
    allNotifications,
    {
      onConflict: "user_id,dedupe_key",
      ignoreDuplicates: true,
    }
  );

  if (insertError) {
    return NextResponse.json({ error: insertError.message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    timeZone,
    today,
    inserted: allNotifications.length,
    dueToday: dueNotifications.length,
    overdue: overdueNotifications.length,
  });
}
