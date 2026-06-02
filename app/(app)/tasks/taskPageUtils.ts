import { DEFAULT_EDITOR_CONTENT } from "@/lib/editorContent";
import { plainTextToTiptapDoc } from "@/lib/plainTextToTiptapDoc";
import { isSupabaseMissingFunctionError } from "@/lib/supabaseErrors";
import { normalizeTaskStatusOrDefault } from "@/lib/taskStatus";
import { extractPlainText } from "@/lib/tiptapText";

export const defaultTaskContentText = extractPlainText(DEFAULT_EDITOR_CONTENT);

export type TaskContentSource = {
  content?: unknown | null;
  content_text?: string | null;
  description?: string | null;
};

export type TaskListPageRpcRow = {
  id: string;
  title: string | null;
  status: string | null;
  priority: string | null;
  start_date: string | null;
  due_date: string | null;
  due_time: string | null;
  created_at: string | null;
  assignee_user_id: string | null;
  client_id: string | null;
  project_id: string | null;
  client_name: string | null;
  project_name: string | null;
  assignee_user_ids: string[] | null;
  open_subtask_count: number | string | null;
  next_subtask_due_date: string | null;
  total_count: number | string | null;
};

export type TasksPageSearchParams = {
  tab?: string;
  view?: string;
  create_mode?: string;
  template_task_id?: string;
  status?: string | string[];
  priority?: string | string[];
  assignee?: string | string[];
  due?: string;
  client?: string | string[];
  project?: string | string[];
  hide?: string;
  watch?: string;
  sort?: string;
  dir?: string;
  q?: string;
  page?: string;
  error?: string;
  success?: string;
};

export function resolveTaskContentFromSource(source?: TaskContentSource | null) {
  const sourceContent = source?.content || null;
  const sourceContentText =
    String(source?.content_text || "").trim() ||
    (sourceContent ? extractPlainText(sourceContent) : "");
  if (sourceContent && sourceContentText) {
    return { content: sourceContent, contentText: sourceContentText };
  }

  const description = String(source?.description || "").trim();
  if (description) {
    const content = plainTextToTiptapDoc(description);
    return { content, contentText: extractPlainText(content) || description };
  }

  return { content: DEFAULT_EDITOR_CONTENT, contentText: defaultTaskContentText };
}

export function isTemplateStatusEnumError(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const message = String((error as { message?: unknown }).message || "").toLowerCase();
  return message.includes("invalid input value for enum") && message.includes("template");
}

export function areSameValueSets(left: string[], right: string[]) {
  if (left.length !== right.length) return false;
  const leftSorted = [...left].sort();
  const rightSorted = [...right].sort();
  return leftSorted.every((value, index) => value === rightSorted[index]);
}

export function formatDbError(
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

export function isLegacyTaskListPageSignatureError(error: unknown) {
  if (!isSupabaseMissingFunctionError(error as { message?: string; code?: string } | null)) {
    return false;
  }

  const message = String((error as { message?: unknown } | null | undefined)?.message || "");
  const hint = String((error as { hint?: unknown } | null | undefined)?.hint || "");
  const combined = `${message} ${hint}`.toLowerCase();
  return (
    combined.includes("task_list_page") &&
    combined.includes("p_offset") &&
    combined.includes("p_query") &&
    combined.includes("perhaps you meant")
  );
}

export function isStaleLegacyTaskListPageErrorMessage(error: unknown) {
  const message = String(error || "").toLowerCase();
  return (
    message.includes("[tasks.page.task_list_page]") &&
    message.includes("task_list_page") &&
    message.includes("p_offset") &&
    message.includes("p_query") &&
    message.includes("perhaps you meant")
  );
}

export function buildTasksUrlWithoutMessage(
  searchParams: TasksPageSearchParams | undefined
) {
  const params = new URLSearchParams();
  Object.entries(searchParams || {}).forEach(([key, value]) => {
    if (key === "error" || key === "success" || typeof value === "undefined") return;
    params.set(key, String(value));
  });
  const query = params.toString();
  return query ? `/tasks?${query}` : "/tasks";
}

export function legacyTaskListRowMatchesSearch(
  row: Pick<TaskListPageRpcRow, "title" | "client_name" | "project_name">,
  query: string
) {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return true;
  return [row.title, row.client_name, row.project_name]
    .map((value) => String(value || "").toLowerCase())
    .some((value) => value.includes(normalizedQuery));
}

export function normalizeTemplateStatusForCreate(value: string | null | undefined) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  if (!normalized || normalized === "template") {
    return "to_do";
  }
  return normalizeTaskStatusOrDefault(normalized);
}

export function buildTasksRedirectUrl(
  baseUrl: string,
  params: { tab?: "list" | "add"; error?: string; success?: string }
) {
  const [path, queryString = ""] = baseUrl.split("?");
  const sp = new URLSearchParams(queryString);

  if (params.tab && params.tab !== "list") {
    sp.set("tab", params.tab);
  } else {
    sp.delete("tab");
  }

  if (params.error) {
    sp.set("error", params.error);
  } else {
    sp.delete("error");
  }

  if (params.success) {
    sp.set("success", params.success);
  } else {
    sp.delete("success");
  }

  const qs = sp.toString();
  return qs ? `${path}?${qs}` : path;
}

function appendShellSearchParam(
  params: URLSearchParams,
  key: string,
  value: string | string[] | undefined
) {
  if (typeof value === "undefined") return;
  if (Array.isArray(value)) {
    value.forEach((item) => params.append(key, item));
    return;
  }
  params.set(key, value);
}

export function buildTasksShellListHref(
  searchParams: TasksPageSearchParams | undefined
) {
  const params = new URLSearchParams();
  appendShellSearchParam(params, "view", searchParams?.view);
  appendShellSearchParam(params, "status", searchParams?.status);
  appendShellSearchParam(params, "priority", searchParams?.priority);
  appendShellSearchParam(params, "assignee", searchParams?.assignee);
  appendShellSearchParam(params, "due", searchParams?.due);
  appendShellSearchParam(params, "client", searchParams?.client);
  appendShellSearchParam(params, "project", searchParams?.project);
  appendShellSearchParam(params, "hide", searchParams?.hide);
  appendShellSearchParam(params, "watch", searchParams?.watch);
  appendShellSearchParam(params, "sort", searchParams?.sort);
  appendShellSearchParam(params, "dir", searchParams?.dir);
  appendShellSearchParam(params, "q", searchParams?.q);
  appendShellSearchParam(params, "page", searchParams?.page);
  const query = params.toString();
  return query ? `/tasks?${query}` : "/tasks";
}
