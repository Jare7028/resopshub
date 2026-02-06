import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  DEFAULT_RECURRENCE_TZ,
  formatYmdInTimeZone,
  getNextOccurrence,
} from "@/lib/recurrence";

export async function GET(request: Request) {
  const isVercelCron = Boolean(request.headers.get("x-vercel-cron"));
  const cronSecret = process.env.CRON_SECRET;
  const url = new URL(request.url);
  const providedSecret = url.searchParams.get("secret");
  const secretOk = Boolean(cronSecret && providedSecret === cronSecret);

  if (process.env.NODE_ENV === "production" && !isVercelCron && !secretOk) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json(
      { error: "Missing SUPABASE_SERVICE_ROLE_KEY" },
      { status: 500 }
    );
  }

  const timeZone = DEFAULT_RECURRENCE_TZ;
  const today = formatYmdInTimeZone(new Date(), timeZone);
  const supabase = createSupabaseAdminClient();

  const { data: recurringTasks, error } = await supabase
    .from("tasks")
    .select(
      "id,title,priority,client_id,project_id,assignee_user_id,content,content_text,recurrence_rule,recurrence_next_date,recurrence_timezone"
    )
    .not("recurrence_rule", "is", null)
    .lte("recurrence_next_date", today);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!recurringTasks?.length) {
    return NextResponse.json({
      ok: true,
      timeZone,
      today,
      created: 0,
    });
  }

  const taskIds = recurringTasks.map((task) => task.id);
  const { data: assigneeRows } = await supabase
    .from("task_assignees")
    .select("task_id,user_id")
    .in("task_id", taskIds);

  const assigneesByTask = new Map<string, string[]>();
  (assigneeRows || []).forEach((row) => {
    if (!assigneesByTask.has(row.task_id)) {
      assigneesByTask.set(row.task_id, []);
    }
    assigneesByTask.get(row.task_id)?.push(row.user_id);
  });

  let createdCount = 0;

  for (const task of recurringTasks) {
    const rule = task.recurrence_rule as string | null;
    const occurrenceDate = (task.recurrence_next_date as string | null) || today;
    if (!rule) {
      continue;
    }

    const nextDate = getNextOccurrence(rule, occurrenceDate);
    if (!nextDate) {
      continue;
    }

    const { data: created, error: createError } = await supabase
      .from("tasks")
      .insert({
        title: task.title,
        status: "backlog",
        priority: task.priority,
        client_id: task.client_id,
        project_id: task.project_id,
        assignee_user_id: task.assignee_user_id,
        due_date: occurrenceDate,
        content: task.content,
        content_text: task.content_text,
      })
      .select("id")
      .single();

    if (createError) {
      return NextResponse.json({ error: createError.message }, { status: 500 });
    }

    createdCount += 1;

    const assignees = assigneesByTask.get(task.id) || [];
    if (created?.id && assignees.length) {
      const inserts = assignees.map((userId) => ({
        task_id: created.id,
        user_id: userId,
      }));
      const { error: assigneeError } = await supabase
        .from("task_assignees")
        .insert(inserts);
      if (assigneeError) {
        return NextResponse.json({ error: assigneeError.message }, { status: 500 });
      }
    }

    const { error: updateError } = await supabase
      .from("tasks")
      .update({
        recurrence_next_date: nextDate,
        recurrence_timezone: task.recurrence_timezone || timeZone,
      })
      .eq("id", task.id);

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }
  }

  return NextResponse.json({
    ok: true,
    timeZone,
    today,
    created: createdCount,
  });
}
