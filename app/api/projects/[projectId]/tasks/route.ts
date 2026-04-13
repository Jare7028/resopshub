import { NextResponse } from "next/server";
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
  params: Promise<{ projectId: string }>;
};

type ProjectTaskRow = {
  id: string;
  project_id: string | null;
  client_id: string | null;
  title: string;
  status: string | null;
  priority: string | null;
  start_date: string | null;
  due_date: string | null;
  due_time: string | null;
  assignee_user_id: string | null;
};

type TaskAssigneeRow = {
  task_id: string | null;
  user_id: string | null;
};

export async function GET(_req: Request, context: RouteContext) {
  const supabase = createSupabaseServerClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const params = await context.params;
  const projectId = String(params.projectId || "").trim();
  if (!projectId) {
    return NextResponse.json({ error: "Missing project id" }, { status: 400 });
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
    console.error("[projects.tasks.status_options]", taskStatusResult.error.message);
  }

  const hiddenTaskStatusValues = buildHiddenStatusValues(
    "task",
    filterTaskStatusOptionsWithMetadata(
      buildStatusOptionsWithMetadata("task", taskStatusRows, [])
    )
  );

  let tasksQuery = supabase
    .from("tasks")
    .select(
      "id,project_id,client_id,title,status,priority,start_date,due_date,due_time,assignee_user_id"
    )
    .eq("project_id", projectId)
    .is("parent_task_id", null)
    .order("created_at", { ascending: true });

  if (hiddenTaskStatusValues.length) {
    tasksQuery = tasksQuery.not("status", "in", `(${hiddenTaskStatusValues.join(",")})`);
  }

  const { data: tasksRaw, error: tasksError } = await tasksQuery;
  if (tasksError) {
    return NextResponse.json({ error: tasksError.message }, { status: 400 });
  }

  const tasks = (tasksRaw || []) as ProjectTaskRow[];
  const taskIds = tasks.map((task) => task.id).filter(Boolean);
  const assigneeUserIdsByTaskId: Record<string, string[]> = {};

  if (taskIds.length) {
    const { data: taskAssigneeRows, error: taskAssigneeError } = await supabase
      .from("task_assignees")
      .select("task_id,user_id")
      .in("task_id", taskIds);

    if (taskAssigneeError) {
      if (!isSupabaseMissingTableError(taskAssigneeError)) {
        console.error("[projects.tasks.task_assignees]", taskAssigneeError.message);
      }
    } else {
      ((taskAssigneeRows || []) as TaskAssigneeRow[]).forEach((row) => {
        const taskId = String(row.task_id || "").trim();
        const userId = String(row.user_id || "").trim();
        if (!taskId || !userId) return;
        if (!assigneeUserIdsByTaskId[taskId]) {
          assigneeUserIdsByTaskId[taskId] = [];
        }
        assigneeUserIdsByTaskId[taskId].push(userId);
      });
    }
  }

  return NextResponse.json({
    tasks: tasks.map((task) => ({
      ...task,
      projects: null,
      clients: null,
      assignee_user_ids: Array.from(
        new Set([
          ...(assigneeUserIdsByTaskId[task.id] || []),
          ...(task.assignee_user_id ? [task.assignee_user_id] : []),
        ])
      ),
    })),
  });
}
