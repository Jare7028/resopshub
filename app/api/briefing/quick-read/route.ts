import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  isSupabaseMissingColumnError,
  isSupabaseMissingTableError,
} from "@/lib/supabaseErrors";
import {
  buildHiddenStatusValues,
  buildStatusOptionsWithMetadata,
  normalizeStatusValue,
  type StatusOptionRow,
} from "@/lib/statusOptions";
import { LOGIN_QUICK_READ_COOKIE } from "@/lib/loginQuickRead";
import {
  getLoginQuickReadTaskDueDateCutoff,
  summarizeLoginQuickReadTasks,
  type LoginQuickReadTaskRow,
} from "@/lib/loginQuickReadSummary";

type MentionSummaryRow = {
  id: string;
  title: string | null;
  body: string | null;
  created_at: string;
  metadata: Record<string, unknown> | null;
};

function clearLoginQuickReadCookie(response: NextResponse) {
  response.cookies.set({
    name: LOGIN_QUICK_READ_COOKIE,
    value: "",
    path: "/",
    maxAge: 0,
    httpOnly: true,
    sameSite: "lax",
  });
}

function extractSourceUrl(metadata: Record<string, unknown> | null | undefined) {
  if (!metadata || typeof metadata !== "object") return null;
  const value = metadata.source_url;
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.startsWith("/") ? normalized : null;
}

export async function GET() {
  const supabase = createSupabaseServerClient();
  const { data: authData } = await supabase.auth.getUser();
  const user = authData.user;

  if (!user) {
    const response = NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    clearLoginQuickReadCookie(response);
    return response;
  }

  const now = new Date();
  const taskDueDateCutoff = getLoginQuickReadTaskDueDateCutoff(now);

  let taskStatusRows: StatusOptionRow[] = [];
  const taskStatusResult = await supabase
    .from("status_options")
    .select("entity_type,value,position,is_visible,counts_as_completed,color_hex")
    .eq("entity_type", "task")
    .order("position", { ascending: true })
    .order("value", { ascending: true });

  if (!taskStatusResult.error) {
    taskStatusRows = (taskStatusResult.data || []) as StatusOptionRow[];
  } else if (isSupabaseMissingColumnError(taskStatusResult.error)) {
    const legacyStatusResult = await supabase
      .from("status_options")
      .select("entity_type,value,position")
      .eq("entity_type", "task")
      .order("position", { ascending: true })
      .order("value", { ascending: true });
    if (!legacyStatusResult.error) {
      taskStatusRows = (legacyStatusResult.data || []) as StatusOptionRow[];
    }
  } else if (!isSupabaseMissingTableError(taskStatusResult.error)) {
    console.error("[quickRead.status_options]", taskStatusResult.error.message);
  }

  const hiddenTaskStatusSet = new Set(
    buildHiddenStatusValues(
      "task",
      buildStatusOptionsWithMetadata("task", taskStatusRows, [])
    ).map((status) => normalizeStatusValue(status))
  );

  let extraAssigneeTaskIds: string[] = [];
  const taskAssigneesResult = await supabase
    .from("task_assignees")
    .select("task_id")
    .eq("user_id", user.id)
    .limit(600);

  if (!taskAssigneesResult.error) {
    extraAssigneeTaskIds = Array.from(
      new Set(
        ((taskAssigneesResult.data || []) as Array<{ task_id: string | null }>)
          .map((row) => String(row.task_id || "").trim())
          .filter(Boolean)
      )
    );
  } else if (!isSupabaseMissingTableError(taskAssigneesResult.error)) {
    console.error("[quickRead.task_assignees]", taskAssigneesResult.error.message);
  }

  let taskQuery = supabase
    .from("tasks")
    .select("id,title,status,due_date,due_time")
    .not("due_date", "is", null)
    .lte("due_date", taskDueDateCutoff)
    .neq("status", "template")
    .order("due_date", { ascending: true })
    .order("due_time", { ascending: true })
    .limit(600);

  if (extraAssigneeTaskIds.length) {
    const taskIdClause = extraAssigneeTaskIds
      .map((value) => value.replace(/[^0-9a-f-]/gi, ""))
      .filter(Boolean)
      .join(",");
    if (taskIdClause) {
      taskQuery = taskQuery.or(`assignee_user_id.eq.${user.id},id.in.(${taskIdClause})`);
    } else {
      taskQuery = taskQuery.eq("assignee_user_id", user.id);
    }
  } else {
    taskQuery = taskQuery.eq("assignee_user_id", user.id);
  }

  const tasksResult = await taskQuery;
  let taskRows: LoginQuickReadTaskRow[] = [];
  if (!tasksResult.error) {
    taskRows = (tasksResult.data || []) as LoginQuickReadTaskRow[];
  } else if (!isSupabaseMissingTableError(tasksResult.error)) {
    console.error("[quickRead.tasks]", tasksResult.error.message);
  }

  const { overdueItems, dueSoonItems } = summarizeLoginQuickReadTasks({
    taskRows,
    hiddenTaskStatusSet,
    now,
  });

  const mentionsResult = await supabase
    .from("notifications")
    .select("id,title,body,created_at,metadata", { count: "exact" })
    .eq("user_id", user.id)
    .eq("type", "user_mentioned")
    .is("read_at", null)
    .order("created_at", { ascending: false })
    .limit(8);

  let mentionRows: MentionSummaryRow[] = [];
  let mentionCount = 0;
  if (!mentionsResult.error) {
    mentionRows = (mentionsResult.data || []) as MentionSummaryRow[];
    mentionCount = Number(mentionsResult.count || 0);
  } else if (!isSupabaseMissingTableError(mentionsResult.error)) {
    console.error("[quickRead.mentions]", mentionsResult.error.message);
  }

  const payload = {
    generatedAt: new Date().toISOString(),
    overdue: {
      count: overdueItems.length,
      items: overdueItems.slice(0, 5).map((item) => ({
        id: item.id,
        title: item.title,
        dueDate: item.dueDate,
        dueTime: item.dueTime,
        dueAt: item.dueAt,
        url: item.url,
      })),
    },
    dueSoon: {
      count: dueSoonItems.length,
      items: dueSoonItems.slice(0, 5).map((item) => ({
        id: item.id,
        title: item.title,
        dueDate: item.dueDate,
        dueTime: item.dueTime,
        dueAt: item.dueAt,
        url: item.url,
      })),
    },
    mentions: {
      count: mentionCount,
      items: mentionRows.slice(0, 5).map((row) => ({
        id: row.id,
        title: String(row.title || "Mentioned").trim() || "Mentioned",
        body: row.body,
        createdAt: row.created_at,
        url: extractSourceUrl(row.metadata),
      })),
    },
  };

  const response = NextResponse.json(payload, { status: 200 });
  clearLoginQuickReadCookie(response);
  return response;
}
