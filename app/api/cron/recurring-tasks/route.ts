import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isAuthorizedCronRequest } from "@/lib/cron";
import {
  DEFAULT_RECURRENCE_TZ,
  addDaysToYmd,
  formatYmdInTimeZone,
  getNextOccurrence,
  getFirstOccurrence,
  type RecurrenceConfig,
} from "@/lib/recurrence";
import crypto from "node:crypto";

const RECURRENCE_INSTANCE_NAMESPACE = "92a3d19a-19f4-47c2-8f18-7fcbb0f2b0c2";

function uuidToBytes(uuid: string) {
  const hex = uuid.replace(/-/g, "");
  if (!/^[0-9a-f]{32}$/i.test(hex)) {
    throw new Error(`Invalid UUID: ${uuid}`);
  }
  return Buffer.from(hex, "hex");
}

function bytesToUuid(bytes: Uint8Array) {
  const hex = Buffer.from(bytes).toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(
    16,
    20
  )}-${hex.slice(20)}`;
}

// Deterministic UUID to make cron re-runs safe (1 template task + 1 due date = 1 instance task id).
function uuidv5(name: string, namespaceUuid: string) {
  const namespaceBytes = uuidToBytes(namespaceUuid);
  const nameBytes = Buffer.from(name, "utf8");
  const hash = crypto
    .createHash("sha1")
    .update(Buffer.concat([namespaceBytes, nameBytes]))
    .digest();

  const bytes = Buffer.from(hash.subarray(0, 16));
  bytes[6] = (bytes[6] & 0x0f) | 0x50; // version 5
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // RFC 4122 variant
  return bytesToUuid(bytes);
}

function isDuplicateKeyError(error: { code?: string; message?: string }) {
  if (error.code === "23505") {
    return true;
  }
  const message = (error.message || "").toLowerCase();
  return message.includes("duplicate key") || message.includes("already exists");
}

export async function GET(request: Request) {
  if (!isAuthorizedCronRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json(
      { error: "Missing SUPABASE_SERVICE_ROLE_KEY" },
      { status: 500 }
    );
  }

  const defaultTimeZone = DEFAULT_RECURRENCE_TZ;
  const now = new Date();
  const todayInDefaultTimeZone = formatYmdInTimeZone(now, defaultTimeZone);
  const supabase = createSupabaseAdminClient();

  const { data: recurringTasks, error } = await supabase
    .from("tasks")
    .select(
      "id,title,priority,client_id,project_id,assignee_user_id,due_time,content,content_text,recurrence_frequency,recurrence_interval,recurrence_weekdays,recurrence_month_day,recurrence_month_week,recurrence_month_weekday,recurrence_start_date,recurrence_end_date,recurrence_lead_days,recurrence_next_date,recurrence_timezone"
    )
    .not("recurrence_frequency", "is", null)
    .not("recurrence_next_date", "is", null);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!recurringTasks?.length) {
    return NextResponse.json({
      ok: true,
      timeZone: defaultTimeZone,
      today: todayInDefaultTimeZone,
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
    const frequency = task.recurrence_frequency as RecurrenceConfig["frequency"] | null;
    const occurrenceDate = task.recurrence_next_date as string | null;
    if (!frequency || !occurrenceDate) {
      continue;
    }

    const taskTimeZone =
      (task.recurrence_timezone as string | null) || defaultTimeZone;
    const today = formatYmdInTimeZone(now, taskTimeZone);

    const leadDays = (task.recurrence_lead_days as number | null) ?? 7;
    const triggerDate = addDaysToYmd(occurrenceDate, -leadDays);
    if (today < triggerDate) {
      continue;
    }

    const recurrenceStart =
      (task.recurrence_start_date as string | null) || occurrenceDate;
    const config: RecurrenceConfig = {
      frequency,
      interval: (task.recurrence_interval as number | null) ?? 1,
      weekdays: (task.recurrence_weekdays as number[] | null) ?? null,
      monthDay: (task.recurrence_month_day as number | null) ?? null,
      monthWeek: (task.recurrence_month_week as number | null) ?? null,
      monthWeekday: (task.recurrence_month_weekday as number | null) ?? null,
      startDate: recurrenceStart,
      endDate: (task.recurrence_end_date as string | null) ?? null,
    };

    const endDate = config.endDate;
    if (endDate && occurrenceDate > endDate) {
      await supabase
        .from("tasks")
        .update({
          recurrence_next_date: null,
          recurrence_timezone: taskTimeZone,
        })
        .eq("id", task.id)
        .eq("recurrence_next_date", occurrenceDate);
      continue;
    }

    let nextDate: string | null = getNextOccurrence(config, occurrenceDate);
    if (!nextDate) {
      nextDate = getFirstOccurrence(config);
    }

    if (endDate && nextDate && nextDate > endDate) {
      nextDate = null;
    }

    const instanceTaskId = uuidv5(
      `recurrence:${task.id}:${occurrenceDate}`,
      RECURRENCE_INSTANCE_NAMESPACE
    );

    const { data: created, error: createError } = await supabase
      .from("tasks")
      .insert({
        id: instanceTaskId,
        title: task.title,
        status: "to_do",
        priority: task.priority,
        client_id: task.client_id,
        project_id: task.project_id,
        assignee_user_id: task.assignee_user_id,
        due_date: occurrenceDate,
        due_time: task.due_time,
        content: task.content,
        content_text: task.content_text,
      })
      .select("id")
      .single();

    if (createError && !isDuplicateKeyError(createError)) {
      return NextResponse.json(
        { error: createError.message },
        { status: 500 }
      );
    }

    if (!createError) {
      createdCount += 1;
    }

    const assignees = assigneesByTask.get(task.id) || [];
    const createdTaskId = created?.id || instanceTaskId;
    if (assignees.length) {
      const inserts = assignees.map((userId) => ({
        task_id: createdTaskId,
        user_id: userId,
      }));
      const { error: assigneeError } = await supabase
        .from("task_assignees")
        .upsert(inserts, {
          onConflict: "task_id,user_id",
          ignoreDuplicates: true,
        });
      if (assigneeError) {
        return NextResponse.json({ error: assigneeError.message }, { status: 500 });
      }
    }

    const { error: updateError } = await supabase
      .from("tasks")
      .update({
        recurrence_next_date: nextDate,
        recurrence_timezone: taskTimeZone,
      })
      .eq("id", task.id)
      .eq("recurrence_next_date", occurrenceDate);

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }
  }

  return NextResponse.json({
    ok: true,
    timeZone: defaultTimeZone,
    today: todayInDefaultTimeZone,
    created: createdCount,
  });
}
