import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/api/requireApiUser";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { filterTaskStatusOptionsWithMetadata } from "@/lib/taskStatus";
import {
  buildHiddenStatusValues,
  buildStatusOptionsWithMetadata,
  type StatusOptionRow,
} from "@/lib/statusOptions";
import {
  isSupabaseMissingColumnError,
  isSupabaseMissingTableError,
} from "@/lib/supabaseErrors";

type RouteContext = {
  params: Promise<{ taskId: string }>;
};

type SubtaskRow = {
  id: string;
  parent_task_id: string | null;
  title: string;
  status: string | null;
  priority: string | null;
  start_date: string | null;
  due_date: string | null;
  due_time: string | null;
  assignee_user_id: string | null;
  client_id: string | null;
  project_id: string | null;
};

type TaskAssigneeRow = {
  task_id: string | null;
  user_id: string | null;
};

export async function GET(_req: Request, context: RouteContext) {
  const supabase = createSupabaseServerClient();
  const auth = await requireApiUser(supabase, "tasks.subtasks.auth");
  if (!auth.user) return auth.response;

  const params = await context.params;
  const taskId = String(params.taskId || "").trim();
  if (!taskId) {
    return NextResponse.json({ error: "Missing task id" }, { status: 400 });
  }

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
    const legacyTaskStatusResult = await supabase
      .from("status_options")
      .select("entity_type,value,position")
      .eq("entity_type", "task")
      .order("position", { ascending: true })
      .order("value", { ascending: true });

    if (!legacyTaskStatusResult.error) {
      taskStatusRows = (legacyTaskStatusResult.data || []) as StatusOptionRow[];
    }
  } else if (!isSupabaseMissingTableError(taskStatusResult.error)) {
    console.error("[tasks.subtasks.status_options]", taskStatusResult.error.message);
  }

  const hiddenTaskStatusValues = buildHiddenStatusValues(
    "task",
    filterTaskStatusOptionsWithMetadata(
      buildStatusOptionsWithMetadata("task", taskStatusRows, [])
    )
  );

  let subtasksQuery = supabase
    .from("tasks")
    .select(
      "id,parent_task_id,title,status,priority,start_date,due_date,due_time,assignee_user_id,client_id,project_id"
    )
    .eq("parent_task_id", taskId)
    .order("created_at", { ascending: true });

  if (hiddenTaskStatusValues.length) {
    subtasksQuery = subtasksQuery.not(
      "status",
      "in",
      `(${hiddenTaskStatusValues.join(",")})`
    );
  }

  const { data: subtasksRaw, error: subtasksError } = await subtasksQuery;
  if (subtasksError) {
    return NextResponse.json({ error: subtasksError.message }, { status: 400 });
  }

  const subtasks = (subtasksRaw || []) as SubtaskRow[];
  const assigneeUserIdsByTaskId: Record<string, string[]> = {};
  const subtaskIds = subtasks.map((subtask) => subtask.id).filter(Boolean);

  if (subtaskIds.length) {
    const { data: taskAssigneeRows, error: taskAssigneeError } = await supabase
      .from("task_assignees")
      .select("task_id,user_id")
      .in("task_id", subtaskIds);

    if (taskAssigneeError) {
      if (!isSupabaseMissingTableError(taskAssigneeError)) {
        console.error("[tasks.subtasks.task_assignees]", taskAssigneeError.message);
      }
    } else {
      ((taskAssigneeRows || []) as TaskAssigneeRow[]).forEach((row) => {
        const subtaskId = String(row.task_id || "").trim();
        const userId = String(row.user_id || "").trim();
        if (!subtaskId || !userId) return;
        if (!assigneeUserIdsByTaskId[subtaskId]) {
          assigneeUserIdsByTaskId[subtaskId] = [];
        }
        assigneeUserIdsByTaskId[subtaskId].push(userId);
      });
    }
  }

  const subtasksPayload = subtasks.map((subtask) => {
    const mergedAssignees = Array.from(
      new Set([
        ...(assigneeUserIdsByTaskId[subtask.id] || []),
        ...(subtask.assignee_user_id ? [subtask.assignee_user_id] : []),
      ])
    );

    return {
      ...subtask,
      projects: null,
      clients: null,
      assignee_user_ids: mergedAssignees,
    };
  });

  return NextResponse.json({ subtasks: subtasksPayload });
}
