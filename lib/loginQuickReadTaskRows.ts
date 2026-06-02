import type { LoginQuickReadTaskRow } from "@/lib/loginQuickReadSummary";
import {
  isSupabaseMissingFunctionError,
  isSupabaseMissingTableError,
} from "@/lib/supabaseErrors";

export const LOGIN_QUICK_READ_TASK_LIMIT = 600;

type PostgrestErrorLike = { code?: string; message?: string } | null | undefined;

type QueryResult<Row> = {
  data: Row[] | null;
  error: PostgrestErrorLike;
};

type QuickReadTaskClient = {
  rpc: (
    functionName: string,
    args: Record<string, unknown>
  ) => PromiseLike<QueryResult<LoginQuickReadTaskRow>>;
  from: (tableName: string) => unknown;
};

type AssigneeQuery = {
  select: (columns: string) => {
    eq: (
      column: string,
      value: string
    ) => {
      limit: (limit: number) => PromiseLike<QueryResult<{ task_id: string | null }>>;
    };
  };
};

type TaskQuery = PromiseLike<QueryResult<LoginQuickReadTaskRow>> & {
  not: (column: string, operator: string, value: unknown) => TaskQuery;
  lte: (column: string, value: string) => TaskQuery;
  neq: (column: string, value: string) => TaskQuery;
  order: (column: string, options: { ascending: boolean }) => TaskQuery;
  limit: (limit: number) => TaskQuery;
  eq: (column: string, value: string) => TaskQuery;
  or: (clause: string) => TaskQuery;
};

type TaskTableQuery = {
  select: (columns: string) => TaskQuery;
};

export type LoginQuickReadTaskFetchSource = "rpc" | "compatibility";

export type LoginQuickReadTaskFetchResult = {
  taskRows: LoginQuickReadTaskRow[];
  source: LoginQuickReadTaskFetchSource;
};

function normalizeLimit(limit: number | null | undefined) {
  return Math.min(Math.max(Number(limit || LOGIN_QUICK_READ_TASK_LIMIT), 1), 600);
}

function logQueryError(
  logError: ((label: string, message: string) => void) | undefined,
  label: string,
  error: PostgrestErrorLike
) {
  const message = String(error?.message || "").trim();
  if (message) logError?.(label, message);
}

function normalizeTaskRows(rows: LoginQuickReadTaskRow[] | null | undefined) {
  return (rows || []).map((row) => ({
    id: String(row.id || ""),
    title: row.title ?? null,
    status: row.status ?? null,
    due_date: row.due_date ?? null,
    due_time: row.due_time ?? null,
  }));
}

async function fetchLoginQuickReadTaskRowsFallback(args: {
  supabase: QuickReadTaskClient;
  userId: string;
  dueDateCutoff: string;
  limit: number;
  logError?: (label: string, message: string) => void;
}) {
  let extraAssigneeTaskIds: string[] = [];
  const taskAssigneesResult = await (args.supabase.from("task_assignees") as AssigneeQuery)
    .select("task_id")
    .eq("user_id", args.userId)
    .limit(args.limit);

  if (!taskAssigneesResult.error) {
    extraAssigneeTaskIds = Array.from(
      new Set(
        (taskAssigneesResult.data || [])
          .map((row) => String(row.task_id || "").trim())
          .filter(Boolean)
      )
    );
  } else if (!isSupabaseMissingTableError(taskAssigneesResult.error)) {
    logQueryError(args.logError, "[quickRead.task_assignees]", taskAssigneesResult.error);
  }

  const baseTaskQuery = (args.supabase.from("tasks") as TaskTableQuery)
    .select("id,title,status,due_date,due_time")
    .not("due_date", "is", null)
    .lte("due_date", args.dueDateCutoff)
    .neq("status", "template")
    .order("due_date", { ascending: true })
    .order("due_time", { ascending: true })
    .limit(args.limit);

  const taskIdClause = extraAssigneeTaskIds
    .map((value) => value.replace(/[^0-9a-f-]/gi, ""))
    .filter(Boolean)
    .join(",");
  const safeUserId = args.userId.replace(/[^0-9a-f-]/gi, "");

  const taskQuery = taskIdClause
    ? baseTaskQuery.or(`assignee_user_id.eq.${safeUserId},id.in.(${taskIdClause})`)
    : baseTaskQuery.eq("assignee_user_id", args.userId);

  const tasksResult = await taskQuery;
  if (!tasksResult.error) {
    return normalizeTaskRows(tasksResult.data);
  }

  if (!isSupabaseMissingTableError(tasksResult.error)) {
    logQueryError(args.logError, "[quickRead.tasks]", tasksResult.error);
  }
  return [];
}

export async function fetchLoginQuickReadTaskRows(args: {
  supabase: QuickReadTaskClient;
  userId: string;
  dueDateCutoff: string;
  limit?: number | null;
  logError?: (label: string, message: string) => void;
}): Promise<LoginQuickReadTaskFetchResult> {
  const limit = normalizeLimit(args.limit);
  const rpcResult = await args.supabase.rpc("login_quick_read_tasks", {
    p_user_id: args.userId,
    p_due_date_cutoff: args.dueDateCutoff,
    p_limit: limit,
  });

  if (!rpcResult.error) {
    return {
      taskRows: normalizeTaskRows(rpcResult.data),
      source: "rpc",
    };
  }

  if (!isSupabaseMissingFunctionError(rpcResult.error)) {
    logQueryError(
      args.logError,
      "[quickRead.login_quick_read_tasks]",
      rpcResult.error
    );
  }

  return {
    taskRows: await fetchLoginQuickReadTaskRowsFallback({
      supabase: args.supabase,
      userId: args.userId,
      dueDateCutoff: args.dueDateCutoff,
      limit,
      logError: args.logError,
    }),
    source: "compatibility",
  };
}
