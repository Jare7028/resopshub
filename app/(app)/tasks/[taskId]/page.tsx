import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { DEFAULT_EDITOR_CONTENT } from "@/lib/editorContent";
import { extractPlainText } from "@/lib/tiptapText";
import TaskNotesEditorClient from "./TaskNotesEditorClient";
import TaskTabs, {
  normalizeTaskTabKey,
  type TaskTabKey,
} from "./_components/TaskTabs";
import ConfirmDelete from "../../_components/ConfirmDelete";
import {
  TASK_STATUS_OPTIONS,
  coerceTaskStatusList,
  expandTaskStatusFilterForQuery,
  formatTaskStatusLabel,
  normalizeTaskStatusOrDefault,
} from "@/lib/taskStatus";
import { parseCsvParam, setCsvParam } from "@/lib/queryParams";
import { isSupabaseMissingTableError } from "@/lib/supabaseErrors";
import { buildStatusOptions, type StatusOptionRow } from "@/lib/statusOptions";
import { statusSelectClasses } from "@/lib/taskIndicators";
import AssigneeMultiSelect from "../_components/AssigneeMultiSelect";
import TasksView from "../TasksView";
import { updateTaskInlineAction } from "../actions";
import {
  normalizeTaskSortDir,
  normalizeTaskSortKey,
  sortTasksForDisplay,
} from "@/lib/taskSorting";
import {
  normalizeCustomFieldKind,
  toCustomFieldKey,
  type CustomFieldOptionRow,
  type CustomFieldRow,
  type CustomFieldValueRow,
} from "@/lib/customFields";

const priorityOptions = ["low", "medium", "high", "critical"] as const;
const dueDateFilters = [
  { value: "all", label: "All" },
  { value: "overdue", label: "Overdue" },
  { value: "next_7", label: "Next 7 days" },
  { value: "none", label: "No due date" },
] as const;
const defaultContentText = extractPlainText(DEFAULT_EDITOR_CONTENT);

function buildTaskUrl(
  taskId: string,
  tab: TaskTabKey,
  params?: { error?: string; success?: string; addField?: "1" | "0" }
) {
  const sp = new URLSearchParams();

  if (tab !== "details") {
    sp.set("tab", tab);
  }
  if (params?.error) {
    sp.set("error", params.error);
  }
  if (params?.success) {
    sp.set("success", params.success);
  }
  if (params?.addField === "1") {
    sp.set("add_field", "1");
  }

  const qs = sp.toString();
  return qs ? `/tasks/${taskId}?${qs}` : `/tasks/${taskId}`;
}

function formatDbError(
  context: string,
  error: { message: string; code?: string; details?: string | null; hint?: string | null } | null | undefined
) {
  if (!error) return context;
  const parts = [`[${context}]`, error.message];
  if (error.code) parts.push(`code=${error.code}`);
  if (error.details) parts.push(`details=${error.details}`);
  if (error.hint) parts.push(`hint=${error.hint}`);
  return parts.join(" | ");
}

export default async function TaskDetailPage(props: {
  params: Promise<{ taskId: string }>;
  searchParams?: Promise<{
    error?: string;
    success?: string;
    tab?: string;
    add_field?: string;
    view?: string;
    status?: string | string[];
    priority?: string | string[];
    assignee?: string | string[];
    due?: string;
    client?: string | string[];
    project?: string | string[];
    hide?: string;
    sort?: string;
    dir?: string;
  }>;
}) {
  const params = await props.params;
  const searchParams = await props.searchParams;
  const supabase = createSupabaseServerClient();
  const { data: statusOptionsRaw } = await supabase
    .from("status_options")
    .select("entity_type,value,position")
    .order("entity_type", { ascending: true })
    .order("position", { ascending: true })
    .order("value", { ascending: true });
  const statusOptions = buildStatusOptions(
    "task",
    (statusOptionsRaw || []) as StatusOptionRow[],
    TASK_STATUS_OPTIONS
  );
  const { data: task } = await supabase
    .from("tasks")
    .select(
      "id,title,description,status,priority,start_date,due_date,due_time,assignee_user_id,project_id,client_id,content,last_edited_at,last_edited_by_user_id,projects(name),clients(name)"
    )
    .eq("id", params.taskId)
    .single();

  if (!task) {
    notFound();
  }

  const { data: customFieldsRaw, error: customFieldsError } = await supabase
    .from("custom_fields")
    .select("id,entity_type,entity_id,key,label,field_kind,position")
    .eq("entity_type", "task")
    .eq("entity_id", task.id)
    .order("position", { ascending: true })
    .order("label", { ascending: true });
  const customFields = (
    customFieldsError && isSupabaseMissingTableError(customFieldsError)
      ? []
      : customFieldsRaw || []
  ) as CustomFieldRow[];
  const customFieldIds = customFields.map((field) => field.id);
  const { data: customFieldOptionsRaw } = customFieldIds.length
    ? await supabase
        .from("custom_field_options")
        .select("id,field_id,value,position")
        .in("field_id", customFieldIds)
        .order("position", { ascending: true })
        .order("value", { ascending: true })
    : { data: [] as CustomFieldOptionRow[] };
  const { data: customFieldValuesRaw } = customFieldIds.length
    ? await supabase
        .from("custom_field_values")
        .select("field_id,text_value,option_value")
        .eq("entity_type", "task")
        .eq("entity_id", task.id)
    : { data: [] as CustomFieldValueRow[] };
  const customFieldOptionsByFieldId = ((customFieldOptionsRaw || []) as CustomFieldOptionRow[]).reduce<
    Record<string, CustomFieldOptionRow[]>
  >((acc, option) => {
    acc[option.field_id] ||= [];
    acc[option.field_id].push(option);
    return acc;
  }, {});
  const customFieldValueByFieldId = new Map<string, string>(
    ((customFieldValuesRaw || []) as CustomFieldValueRow[]).map((row) => [
      row.field_id,
      row.option_value || row.text_value || "",
    ])
  );

  const taskId = task.id;
  const activeTab = normalizeTaskTabKey(searchParams?.tab);
  const showAddFieldModal = searchParams?.add_field === "1";
  const taskStatus = task.status;
  const taskPriority = task.priority;
  const taskClientId = task.client_id;
  const taskProjectId = task.project_id;
  const taskAssigneeUserId = task.assignee_user_id;
  const viewRaw = String(searchParams?.view || "").trim().toLowerCase();
  const selectedSubtaskView: "table" | "gantt" | "board" =
    viewRaw === "gantt" || viewRaw === "board" || viewRaw === "table"
      ? (viewRaw as "table" | "gantt" | "board")
      : "table";
  const subtaskSortKey = normalizeTaskSortKey(searchParams?.sort);
  const subtaskSortDir = normalizeTaskSortDir(searchParams?.dir);
  const selectedStatusesRaw = parseCsvParam(searchParams?.status);
  const selectedPrioritiesRaw = parseCsvParam(searchParams?.priority);
  const selectedAssigneesRaw = parseCsvParam(searchParams?.assignee);
  const selectedClientIdsRaw = parseCsvParam(searchParams?.client);
  const selectedProjectIdsRaw = parseCsvParam(searchParams?.project);
  let selectedDue = (searchParams?.due || "all").trim();
  const hideCompleted = (searchParams?.hide ?? "1").trim() !== "0";

  const getRelationName = (
    relation:
      | { name?: string | null }
      | { name?: string | null }[]
      | null
      | undefined,
    fallback: string
  ) => {
    if (Array.isArray(relation)) {
      return relation[0]?.name ?? fallback;
    }
    return relation?.name ?? fallback;
  };

  const { data: users } = await supabase
    .from("users")
    .select("id,full_name,email")
    .order("full_name", { ascending: true });
  const { data: clients } = await supabase
    .from("clients")
    .select("id,name")
    .order("name", { ascending: true });
  const { data: projects } = await supabase
    .from("projects")
    .select("id,name,client_id,clients(name)")
    .order("name", { ascending: true });

  const allowedDueValues = new Set<string>(
    dueDateFilters.map((filter) => filter.value)
  );
  if (!allowedDueValues.has(selectedDue)) {
    selectedDue = "all";
  }
  const selectedStatuses = coerceTaskStatusList(selectedStatusesRaw).filter((status) =>
    statusOptions.includes(status)
  );
  const selectedPriorities = selectedPrioritiesRaw.filter((priority) =>
    priorityOptions.includes(priority as (typeof priorityOptions)[number])
  );
  const userIdSet = new Set((users || []).map((user) => user.id));
  const selectedAssignees = selectedAssigneesRaw.filter(
    (value) => value === "unassigned" || userIdSet.has(value)
  );
  const clientIdSet = new Set((clients || []).map((client) => client.id));
  const selectedClientIds = selectedClientIdsRaw.filter((id) => clientIdSet.has(id));
  const projectIdSet = new Set((projects || []).map((project) => project.id));
  const selectedProjectIds = selectedProjectIdsRaw.filter((id) => projectIdSet.has(id));

  const subtasksReturnParams = new URLSearchParams();
  subtasksReturnParams.set("tab", "subtasks");
  setCsvParam(subtasksReturnParams, "status", selectedStatuses);
  setCsvParam(subtasksReturnParams, "priority", selectedPriorities);
  setCsvParam(subtasksReturnParams, "assignee", selectedAssignees);
  if (selectedDue !== "all") {
    subtasksReturnParams.set("due", selectedDue);
  }
  setCsvParam(subtasksReturnParams, "client", selectedClientIds);
  setCsvParam(subtasksReturnParams, "project", selectedProjectIds);
  subtasksReturnParams.set("hide", hideCompleted ? "1" : "0");
  subtasksReturnParams.set("sort", subtaskSortKey);
  subtasksReturnParams.set("dir", subtaskSortDir);
  if (selectedSubtaskView !== "table") {
    subtasksReturnParams.set("view", selectedSubtaskView);
  }
  const subtasksReturnTo = `/tasks/${taskId}?${subtasksReturnParams.toString()}`;
  const subtasksToggleParams = new URLSearchParams(subtasksReturnParams);
  subtasksToggleParams.set("hide", hideCompleted ? "0" : "1");
  const subtasksToggleUrl = `/tasks/${taskId}?${subtasksToggleParams.toString()}`;

  const { data: taskAssignees } = await supabase
    .from("task_assignees")
    .select("user_id")
    .eq("task_id", taskId);
  const assignedUserIds = new Set(
    (taskAssignees || []).map((row) => row.user_id).filter(Boolean)
  );
  if (task.assignee_user_id) {
    assignedUserIds.add(task.assignee_user_id);
  }

  const { data: taskWatchers } = await supabase
    .from("task_watchers")
    .select("user_id")
    .eq("task_id", taskId);
  const watcherUserIds = new Set(
    (taskWatchers || []).map((row) => row.user_id).filter(Boolean)
  );

  const assigneeMap = new Map(
    users?.map((user) => [user.id, user.full_name || user.email]) || []
  );
  const lastEditedAtLabel = task.last_edited_at
    ? new Date(task.last_edited_at).toLocaleString("en-US")
    : null;
  const lastEditedByLabel = task.last_edited_by_user_id
    ? assigneeMap.get(task.last_edited_by_user_id) || "Unknown user"
    : null;

  let subtasksQuery = supabase
    .from("tasks")
    .select(
      "id,title,status,priority,start_date,due_date,due_time,created_at,assignee_user_id,client_id,project_id,projects(name),clients(name)"
    )
    .eq("parent_task_id", task.id)
    .order("created_at", { ascending: false });

  if (selectedStatuses.length) {
    subtasksQuery = subtasksQuery.in("status", expandTaskStatusFilterForQuery(selectedStatuses));
  }
  if (selectedPriorities.length) {
    subtasksQuery = subtasksQuery.in("priority", selectedPriorities);
  }
  const wantsUnassigned = selectedAssignees.includes("unassigned");
  const selectedAssigneeIds = selectedAssignees.filter((value) => value !== "unassigned");
  if (wantsUnassigned && selectedAssigneeIds.length) {
    subtasksQuery = subtasksQuery.or(
      `assignee_user_id.is.null,assignee_user_id.in.(${selectedAssigneeIds.join(",")})`
    );
  } else if (wantsUnassigned) {
    subtasksQuery = subtasksQuery.is("assignee_user_id", null);
  } else if (selectedAssigneeIds.length) {
    subtasksQuery = subtasksQuery.in("assignee_user_id", selectedAssigneeIds);
  }
  if (selectedClientIds.length) {
    subtasksQuery = subtasksQuery.in("client_id", selectedClientIds);
  }
  if (selectedProjectIds.length) {
    subtasksQuery = subtasksQuery.in("project_id", selectedProjectIds);
  }
  const wantsCompletedStatuses =
    selectedStatuses.includes("completed") || selectedStatuses.includes("cancelled");
  if (hideCompleted && !wantsCompletedStatuses) {
    subtasksQuery = subtasksQuery.not("status", "in", "(completed,cancelled)");
  }
  const today = new Date();
  const todayIso = today.toISOString().slice(0, 10);
  if (selectedDue === "overdue") {
    subtasksQuery = subtasksQuery.lt("due_date", todayIso);
  } else if (selectedDue === "next_7") {
    const next = new Date(today);
    next.setDate(next.getDate() + 7);
    const nextIso = next.toISOString().slice(0, 10);
    subtasksQuery = subtasksQuery.gte("due_date", todayIso).lte("due_date", nextIso);
  } else if (selectedDue === "none") {
    subtasksQuery = subtasksQuery.is("due_date", null);
  }

  const { data: subtasksRaw } = await subtasksQuery;
  const subtasksById: Record<string, string[]> = {};
  const subtaskIds = (subtasksRaw || []).map((subtask) => subtask.id).filter(Boolean);
  if (subtaskIds.length) {
    const { data: subtaskAssignees } = await supabase
      .from("task_assignees")
      .select("task_id,user_id")
      .in("task_id", subtaskIds);
    (subtaskAssignees || []).forEach((row) => {
      if (!subtasksById[row.task_id]) {
        subtasksById[row.task_id] = [];
      }
      subtasksById[row.task_id].push(row.user_id);
    });
  }
  (subtasksRaw || []).forEach((subtask) => {
    if (!subtasksById[subtask.id]) {
      subtasksById[subtask.id] = [];
    }
    if (
      subtask.assignee_user_id &&
      !subtasksById[subtask.id].includes(subtask.assignee_user_id)
    ) {
      subtasksById[subtask.id].push(subtask.assignee_user_id);
    }
  });
  const subtasks = sortTasksForDisplay({
    tasks: subtasksRaw || [],
    sortKey: subtaskSortKey,
    sortDir: subtaskSortDir,
    users: users || [],
    assigneesByTask: subtasksById,
    statusOrder: statusOptions,
  });
  const openSubtaskCountByTaskId: Record<string, number> = {};
  if (subtaskIds.length) {
    const { data: subsubtasksRaw, error: subsubtasksError } = await supabase
      .from("tasks")
      .select("parent_task_id,status")
      .in("parent_task_id", subtaskIds);
    if (!subsubtasksError) {
      (subsubtasksRaw || []).forEach((row) => {
        const parentId = row.parent_task_id;
        const status = row.status || "";
        if (!parentId) return;
        if (status === "completed" || status === "cancelled") return;
        openSubtaskCountByTaskId[parentId] = (openSubtaskCountByTaskId[parentId] || 0) + 1;
      });
    }
  }

  async function createTaskCustomField(formData: FormData) {
    "use server";
    const supabase = createSupabaseServerClient();
    const label = String(formData.get("label") || "").trim();
    const fieldKind = normalizeCustomFieldKind(
      String(formData.get("field_kind") || "").trim().toLowerCase()
    );
    const optionsCsv = String(formData.get("options_csv") || "").trim();

    if (!label) {
      redirect(buildTaskUrl(taskId, "details", { error: "Custom field label is required" }));
    }

    const existingKeys = new Set(customFields.map((field) => field.key));
    const keyBase = toCustomFieldKey(label);
    let key = keyBase;
    let suffix = 2;
    while (existingKeys.has(key)) {
      key = `${keyBase}_${suffix}`;
      suffix += 1;
    }

    const { data: lastField } = await supabase
      .from("custom_fields")
      .select("position")
      .eq("entity_type", "task")
      .eq("entity_id", taskId)
      .order("position", { ascending: false })
      .limit(1)
      .maybeSingle();
    const nextPosition = (lastField?.position || 0) + 1;

    const { data: createdField, error } = await supabase
      .from("custom_fields")
      .insert({
        entity_type: "task",
        entity_id: taskId,
        key,
        label,
        field_kind: fieldKind,
        position: nextPosition,
      })
      .select("id")
      .single();
    if (error) {
      const hint = isSupabaseMissingTableError(error)
        ? " Run sql/custom_fields.sql in Supabase SQL editor first."
        : "";
      redirect(buildTaskUrl(taskId, "details", { error: `${error.message}${hint}` }));
    }

    if (fieldKind === "dropdown" && createdField?.id) {
      const options = Array.from(
        new Set(
          optionsCsv
            .split(",")
            .map((value) => value.trim())
            .filter(Boolean)
        )
      );
      if (options.length) {
        const { error: optionsError } = await supabase.from("custom_field_options").insert(
          options.map((value, index) => ({
            field_id: createdField.id,
            value,
            position: index + 1,
          }))
        );
        if (optionsError) {
          redirect(buildTaskUrl(taskId, "details", { error: optionsError.message }));
        }
      }
    }

    revalidatePath(`/tasks/${taskId}`);
    redirect(buildTaskUrl(taskId, "details", { success: "Custom field added" }));
  }

  async function deleteTaskCustomField(customFieldId: string) {
    "use server";
    const supabase = createSupabaseServerClient();
    const id = String(customFieldId || "").trim();
    if (!id) {
      redirect(buildTaskUrl(taskId, "details", { error: "Missing custom field id" }));
    }
    const { error } = await supabase
      .from("custom_fields")
      .delete()
      .eq("id", id)
      .eq("entity_type", "task")
      .eq("entity_id", taskId);
    if (error) {
      redirect(buildTaskUrl(taskId, "details", { error: error.message }));
    }
    revalidatePath(`/tasks/${taskId}`);
    redirect(buildTaskUrl(taskId, "details", { success: "Custom field deleted" }));
  }

  async function updateTask(formData: FormData) {
    "use server";
    const supabase = createSupabaseServerClient();
    const title = String(formData.get("title") || "").trim();
    const existingStatus = normalizeTaskStatusOrDefault(taskStatus);
    const status = normalizeTaskStatusOrDefault(
      String(formData.get("status") || existingStatus),
      existingStatus
    );
    const priority = String(formData.get("priority") || taskPriority);
    const startDate = String(formData.get("start_date") || "");
    const dueDate = String(formData.get("due_date") || "");
    const dueTime = String(formData.get("due_time") || "");
    const assignee = String(formData.get("assignee_user_id") || "");

    if (!title) {
      redirect(buildTaskUrl(taskId, "details", { error: "Task name is required" }));
    }

    const { error } = await supabase
      .from("tasks")
      .update({
        title,
        status,
        priority,
        start_date: startDate || null,
        due_date: dueDate || null,
        due_time: dueTime || null,
        assignee_user_id: assignee || null,
      })
      .eq("id", taskId);

    if (error) {
      redirect(buildTaskUrl(taskId, "details", { error: error.message }));
    }

    const clears: string[] = [];
    const upserts: Array<{
      entity_type: "task";
      entity_id: string;
      field_id: string;
      text_value: string | null;
      option_value: string | null;
    }> = [];

    for (const field of customFields) {
      const value = String(formData.get(`cf_${field.id}`) || "").trim();
      if (!value) {
        clears.push(field.id);
        continue;
      }

      if (field.field_kind === "dropdown") {
        const allowed = (customFieldOptionsByFieldId[field.id] || []).some(
          (option) => option.value === value
        );
        if (!allowed) {
          redirect(
            buildTaskUrl(taskId, "details", {
              error: `Invalid value for ${field.label}`,
            })
          );
        }
      }
      if (field.field_kind === "date" && !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        redirect(
          buildTaskUrl(taskId, "details", {
            error: `Invalid date for ${field.label}`,
          })
        );
      }
      if (field.field_kind === "client") {
        const allowedClient = (clients || []).some((client) => client.id === value);
        if (!allowedClient) {
          redirect(
            buildTaskUrl(taskId, "details", {
              error: `Invalid client for ${field.label}`,
            })
          );
        }
      }

      upserts.push({
        entity_type: "task",
        entity_id: taskId,
        field_id: field.id,
        text_value:
          field.field_kind === "text" ||
          field.field_kind === "date" ||
          field.field_kind === "client"
            ? value
            : null,
        option_value: field.field_kind === "dropdown" ? value : null,
      });
    }

    if (clears.length) {
      const { error: clearError } = await supabase
        .from("custom_field_values")
        .delete()
        .eq("entity_type", "task")
        .eq("entity_id", taskId)
        .in("field_id", clears);
      if (clearError && !isSupabaseMissingTableError(clearError)) {
        redirect(buildTaskUrl(taskId, "details", { error: clearError.message }));
      }
    }

    if (upserts.length) {
      const { error: upsertError } = await supabase.from("custom_field_values").upsert(
        upserts,
        { onConflict: "entity_type,entity_id,field_id" }
      );
      if (upsertError && !isSupabaseMissingTableError(upsertError)) {
        redirect(buildTaskUrl(taskId, "details", { error: upsertError.message }));
      }
    }

    revalidatePath(`/tasks/${taskId}`);
    redirect(buildTaskUrl(taskId, "details", { success: "Saved" }));
  }

  async function updateTaskAssignees(formData: FormData) {
    "use server";
    const supabase = createSupabaseServerClient();
    const selectedIds = formData
      .getAll("assignee_user_ids")
      .map((value) => String(value).trim())
      .filter(Boolean);

    await supabase.from("task_assignees").delete().eq("task_id", taskId);

    const uniqueIds = Array.from(new Set(selectedIds));
    if (uniqueIds.length) {
      const inserts = uniqueIds.map((userId) => ({
        task_id: taskId,
        user_id: userId,
      }));
      const { error } = await supabase.from("task_assignees").insert(inserts);
      if (error) {
        redirect(buildTaskUrl(taskId, "assignees", { error: error.message }));
      }
    }

    const primaryAssignee = uniqueIds[0] || null;
    if (primaryAssignee !== taskAssigneeUserId) {
      const { error: updateError } = await supabase
        .from("tasks")
        .update({ assignee_user_id: primaryAssignee })
        .eq("id", taskId);
      if (updateError) {
        redirect(buildTaskUrl(taskId, "assignees", { error: updateError.message }));
      }
    }

    revalidatePath(`/tasks/${taskId}`);
    redirect(buildTaskUrl(taskId, "assignees", { success: "Assignees updated" }));
  }

  async function updateTaskWatchers(formData: FormData) {
    "use server";
    const supabase = createSupabaseServerClient();
    const selectedIds = formData
      .getAll("watcher_user_ids")
      .map((value) => String(value).trim())
      .filter(Boolean);

    await supabase.from("task_watchers").delete().eq("task_id", taskId);

    const uniqueIds = Array.from(new Set(selectedIds));
    if (uniqueIds.length) {
      const inserts = uniqueIds.map((userId) => ({
        task_id: taskId,
        user_id: userId,
      }));
      const { error } = await supabase.from("task_watchers").insert(inserts);
      if (error) {
        redirect(buildTaskUrl(taskId, "watchers", { error: error.message }));
      }
    }

    revalidatePath(`/tasks/${taskId}`);
    redirect(buildTaskUrl(taskId, "watchers", { success: "Watchers updated" }));
  }

  async function createSubtask(formData: FormData) {
    "use server";
    const supabase = createSupabaseServerClient();
    const { data: authData } = await supabase.auth.getUser();
    if (!authData.user?.id) {
      redirect("/login");
    }
    const title = String(formData.get("title") || "").trim();
    const status = normalizeTaskStatusOrDefault(String(formData.get("status") || "to_do"));
    const priority = String(formData.get("priority") || "medium");
    const startDate = String(formData.get("start_date") || "");
    const dueDate = String(formData.get("due_date") || "");
    const dueTime = String(formData.get("due_time") || "");
    const assignee = String(formData.get("assignee_user_id") || "");
    const assigneeIds = formData
      .getAll("assignee_user_ids")
      .map((value) => String(value).trim())
      .filter(Boolean);

    if (!title) {
      redirect(
        buildTaskUrl(taskId, "subtasks", { error: "Subtask title is required" })
      );
    }

    const primaryAssignee =
      assigneeIds.find((value) => value !== "unassigned") || assignee;

    const payload: Record<string, unknown> = {
      client_id: taskClientId,
      project_id: taskProjectId,
      parent_task_id: taskId,
      title,
      status,
      priority,
      due_date: dueDate || null,
      due_time: dueTime || null,
      assignee_user_id: primaryAssignee || null,
      created_by_user_id: authData.user.id,
      content: DEFAULT_EDITOR_CONTENT,
      content_text: defaultContentText,
    };

    if (startDate) {
      payload.start_date = startDate;
    }

    const { data: created, error } = await supabase
      .from("tasks")
      .insert(payload)
      .select("id")
      .single();

    if (error) {
      redirect(
        buildTaskUrl(taskId, "subtasks", {
          error: formatDbError("tasks.createSubtask.tasks.insert", error),
        })
      );
    }

    const subtaskId = created?.id;
    if (subtaskId && assigneeIds.length) {
      const uniqueIds = Array.from(
        new Set(assigneeIds.filter((value) => value !== "unassigned"))
      );
      if (uniqueIds.length) {
        const inserts = uniqueIds.map((userId) => ({
          task_id: subtaskId,
          user_id: userId,
        }));
        const { error: assigneeError } = await supabase
          .from("task_assignees")
          .insert(inserts);
        if (assigneeError) {
          redirect(
            buildTaskUrl(taskId, "subtasks", { error: assigneeError.message })
          );
        }
      }
    }

    revalidatePath(`/tasks/${taskId}`);
    redirect(buildTaskUrl(taskId, "subtasks", { success: "Subtask created" }));
  }

  async function deleteTask() {
    "use server";
    const supabase = createSupabaseServerClient();

    // Best-effort: delete subtasks first to avoid FK/parent references.
    const { error: subtaskError } = await supabase
      .from("tasks")
      .delete()
      .eq("parent_task_id", taskId);

    if (subtaskError) {
      redirect(buildTaskUrl(taskId, activeTab, { error: subtaskError.message }));
    }

    const { error } = await supabase.from("tasks").delete().eq("id", taskId);

    if (error) {
      redirect(buildTaskUrl(taskId, activeTab, { error: error.message }));
    }

    revalidatePath("/tasks");
    redirect("/tasks?success=Task%20deleted");
  }

  return (
    <div className="space-y-8">
      <section className="space-y-2">
        <p className="text-sm font-semibold uppercase tracking-wide text-slate-500">
          Task
        </p>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <h1 className="text-3xl font-semibold text-slate-900">{task.title}</h1>
          <form action={deleteTask}>
            <ConfirmDelete
              name={task.title}
              itemType="Task"
              triggerLabel="Delete task"
              confirmLabel="Permanently delete"
            />
          </form>
        </div>
        <div className="text-sm text-slate-600">
          <p>
            Client:{" "}
            {task.client_id ? (
              <Link href={`/clients/${task.client_id}`} className="hover:underline">
                {getRelationName(task.clients, "View client")}
              </Link>
            ) : (
              <span className="text-slate-500">--</span>
            )}
          </p>
          <p>
            Project:{" "}
            {task.project_id ? (
              <Link href={`/projects/${task.project_id}`} className="hover:underline">
                {getRelationName(task.projects, "View project")}
              </Link>
            ) : (
              <span className="text-slate-500">--</span>
            )}
          </p>
        </div>
      </section>

      {(searchParams?.error || searchParams?.success) && (
        <div className="space-y-2">
          {searchParams?.error ? (
            <p className="rounded-md border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
              {searchParams.error}
            </p>
          ) : null}
          {searchParams?.success ? (
            <p className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-700">
              {searchParams.success}
            </p>
          ) : null}
        </div>
      )}

      <TaskTabs taskId={taskId} active={activeTab} />

      {activeTab === "details" ? (
        <section className="rounded-lg border border-slate-200 bg-white">
          <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-6 py-4">
            <h2 className="text-lg font-semibold text-slate-900">Task details</h2>
            <Link
              href={buildTaskUrl(taskId, "details", { addField: "1" })}
              className="rounded-md border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100"
            >
              Add field
            </Link>
          </div>
          <div className="px-6 pb-6">
          <form action={updateTask} className="mt-4 grid gap-4 md:grid-cols-4">
            <input
              name="title"
              defaultValue={task.title}
              className="md:col-span-4 rounded-md border border-slate-300 px-3 py-2 text-sm"
              required
            />
            <div className="grid gap-1">
              <label
                htmlFor="task-status"
                className="text-xs font-semibold uppercase tracking-wide text-slate-500"
              >
                Status
              </label>
              <select
                id="task-status"
                name="status"
                defaultValue={normalizeTaskStatusOrDefault(task.status)}
                className={`rounded-md border px-3 py-2 text-sm ${statusSelectClasses(
                  normalizeTaskStatusOrDefault(task.status)
                )}`}
              >
                {statusOptions.map((status) => (
                  <option key={status} value={status}>
                    {formatTaskStatusLabel(status)}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid gap-1">
              <label
                htmlFor="task-priority"
                className="text-xs font-semibold uppercase tracking-wide text-slate-500"
              >
                Priority
              </label>
              <select
                id="task-priority"
                name="priority"
                defaultValue={task.priority}
                className="rounded-md border border-slate-300 px-3 py-2 text-sm"
              >
                {priorityOptions.map((priority) => (
                  <option key={priority} value={priority}>
                    {priority}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid gap-1">
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Primary assignee
              </label>
              <select
                name="assignee_user_id"
                defaultValue={task.assignee_user_id || ""}
                className="rounded-md border border-slate-300 px-3 py-2 text-sm"
              >
                <option value="">Unassigned</option>
                {users?.map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.full_name || user.email}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid gap-1">
              <label
                htmlFor="task-start-date"
                className="text-xs font-semibold uppercase tracking-wide text-slate-500"
              >
                Start date
              </label>
              <input
                id="task-start-date"
                type="date"
                name="start_date"
                defaultValue={task.start_date || ""}
                className="rounded-md border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
            <div className="grid gap-1">
              <label
                htmlFor="task-due-date"
                className="text-xs font-semibold uppercase tracking-wide text-slate-500"
              >
                Due date
              </label>
              <input
                id="task-due-date"
                type="date"
                name="due_date"
                defaultValue={task.due_date || ""}
                className="rounded-md border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
            <div className="grid gap-1">
              <label
                htmlFor="task-due-time"
                className="text-xs font-semibold uppercase tracking-wide text-slate-500"
              >
                Due time
              </label>
              <input
                id="task-due-time"
                type="time"
                name="due_time"
                defaultValue={task.due_time ? task.due_time.slice(0, 5) : ""}
                className="rounded-md border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
            {customFields.map((field) => {
              const value = customFieldValueByFieldId.get(field.id) || "";
              const inputId = `custom-field-${field.id}`;
              if (field.field_kind === "dropdown") {
                return (
                  <div key={field.id} className="grid gap-1">
                    <div className="flex items-center justify-between gap-2">
                      <label
                        htmlFor={inputId}
                        className="text-xs font-semibold uppercase tracking-wide text-slate-500"
                      >
                        {field.label}
                      </label>
                      <button
                        type="submit"
                        formAction={deleteTaskCustomField.bind(null, field.id)}
                        className="rounded-md border border-red-200 bg-red-50 px-2 py-1 text-[10px] font-semibold text-red-700 hover:bg-red-100"
                      >
                        Delete
                      </button>
                    </div>
                    <select
                      id={inputId}
                      name={`cf_${field.id}`}
                      defaultValue={value}
                      className="rounded-md border border-slate-300 px-3 py-2 text-sm"
                    >
                      <option value="">Select...</option>
                      {(customFieldOptionsByFieldId[field.id] || []).map((option) => (
                        <option key={option.id} value={option.value}>
                          {option.value}
                        </option>
                      ))}
                    </select>
                  </div>
                );
              }
              if (field.field_kind === "date") {
                return (
                  <div key={field.id} className="grid gap-1">
                    <div className="flex items-center justify-between gap-2">
                      <label
                        htmlFor={inputId}
                        className="text-xs font-semibold uppercase tracking-wide text-slate-500"
                      >
                        {field.label}
                      </label>
                      <button
                        type="submit"
                        formAction={deleteTaskCustomField.bind(null, field.id)}
                        className="rounded-md border border-red-200 bg-red-50 px-2 py-1 text-[10px] font-semibold text-red-700 hover:bg-red-100"
                      >
                        Delete
                      </button>
                    </div>
                    <input
                      id={inputId}
                      type="date"
                      name={`cf_${field.id}`}
                      defaultValue={value}
                      className="rounded-md border border-slate-300 px-3 py-2 text-sm"
                    />
                  </div>
                );
              }
              if (field.field_kind === "client") {
                return (
                  <div key={field.id} className="grid gap-1">
                    <div className="flex items-center justify-between gap-2">
                      <label
                        htmlFor={inputId}
                        className="text-xs font-semibold uppercase tracking-wide text-slate-500"
                      >
                        {field.label}
                      </label>
                      <button
                        type="submit"
                        formAction={deleteTaskCustomField.bind(null, field.id)}
                        className="rounded-md border border-red-200 bg-red-50 px-2 py-1 text-[10px] font-semibold text-red-700 hover:bg-red-100"
                      >
                        Delete
                      </button>
                    </div>
                    <select
                      id={inputId}
                      name={`cf_${field.id}`}
                      defaultValue={value}
                      className="rounded-md border border-slate-300 px-3 py-2 text-sm"
                    >
                      <option value="">Select client...</option>
                      {(clients || []).map((client) => (
                        <option key={client.id} value={client.id}>
                          {client.name}
                        </option>
                      ))}
                    </select>
                  </div>
                );
              }
              return (
                <div key={field.id} className="grid gap-1">
                  <div className="flex items-center justify-between gap-2">
                    <label
                      htmlFor={inputId}
                      className="text-xs font-semibold uppercase tracking-wide text-slate-500"
                    >
                      {field.label}
                    </label>
                    <button
                      type="submit"
                      formAction={deleteTaskCustomField.bind(null, field.id)}
                      className="rounded-md border border-red-200 bg-red-50 px-2 py-1 text-[10px] font-semibold text-red-700 hover:bg-red-100"
                    >
                      Delete
                    </button>
                  </div>
                  <input
                    id={inputId}
                    name={`cf_${field.id}`}
                    defaultValue={value}
                    className="rounded-md border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
              );
            })}
            <button
              type="submit"
              className="md:col-span-4 rounded-md btn-primary px-4 py-2 text-sm font-semibold text-white "
            >
              Save task
            </button>
          </form>
          {showAddFieldModal ? (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 px-4">
              <div className="w-full max-w-xl rounded-xl border border-slate-200 bg-white p-5 shadow-xl">
                <div className="mb-4 flex items-center justify-between gap-3">
                  <h3 className="text-base font-semibold text-slate-900">Add field to task</h3>
                  <Link
                    href={buildTaskUrl(taskId, "details")}
                    className="rounded-md border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                  >
                    Close
                  </Link>
                </div>
                <form action={createTaskCustomField} className="grid gap-3">
                  <input
                    name="label"
                    placeholder="Field label"
                    className="rounded-md border border-slate-300 px-3 py-2 text-sm"
                    required
                  />
                  <select
                    name="field_kind"
                    defaultValue="text"
                    className="rounded-md border border-slate-300 px-3 py-2 text-sm"
                  >
                    <option value="text">Text</option>
                    <option value="dropdown">Dropdown</option>
                    <option value="date">Date</option>
                    <option value="client">Client</option>
                  </select>
                  <input
                    name="options_csv"
                    placeholder="Dropdown options only (comma-separated)"
                    className="rounded-md border border-slate-300 px-3 py-2 text-sm"
                  />
                  <div className="flex items-center justify-end gap-2 pt-1">
                    <Link
                      href={buildTaskUrl(taskId, "details")}
                      className="rounded-md border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
                    >
                      Cancel
                    </Link>
                    <button
                      type="submit"
                      className="rounded-md btn-primary px-3 py-2 text-sm font-semibold text-white"
                    >
                      Add field
                    </button>
                  </div>
                </form>
              </div>
            </div>
          ) : null}
        </div>
      </section>
    ) : null}

      {activeTab === "assignees" ? (
        <section className="rounded-lg border border-slate-200 bg-white">
          <div className="border-b border-slate-200 px-6 py-4">
            <h2 className="text-lg font-semibold text-slate-900">Task assignees</h2>
          </div>
          <div className="px-6 pb-6">
          {users?.length ? (
            <form action={updateTaskAssignees} className="mt-4 space-y-4">
              <div className="grid gap-2 sm:grid-cols-2">
                {users.map((user) => (
                  <label
                    key={user.id}
                    className="flex items-center gap-2 text-sm text-slate-700"
                  >
                    <input
                      type="checkbox"
                      name="assignee_user_ids"
                      value={user.id}
                      defaultChecked={assignedUserIds.has(user.id)}
                    />
                    <span>{user.full_name || user.email}</span>
                  </label>
                ))}
              </div>
              <button
                type="submit"
                className="rounded-md btn-primary px-4 py-2 text-sm font-semibold text-white"
              >
                Save assignees
              </button>
            </form>
          ) : (
            <p className="mt-4 text-sm text-slate-500">No users found.</p>
          )}
        </div>
      </section>
    ) : null}

      {activeTab === "watchers" ? (
        <section className="rounded-lg border border-slate-200 bg-white">
          <div className="border-b border-slate-200 px-6 py-4">
            <h2 className="text-lg font-semibold text-slate-900">Task watchers</h2>
          </div>
          <div className="px-6 pb-6">
          <p className="mt-4 text-sm text-slate-600">
            Watchers can view and edit this task without being an assignee.
          </p>
          {users?.length ? (
            <form action={updateTaskWatchers} className="mt-4 space-y-4">
              <div className="grid gap-2 sm:grid-cols-2">
                {users.map((user) => (
                  <label
                    key={user.id}
                    className="flex items-center gap-2 text-sm text-slate-700"
                  >
                    <input
                      type="checkbox"
                      name="watcher_user_ids"
                      value={user.id}
                      defaultChecked={watcherUserIds.has(user.id)}
                    />
                    <span>{user.full_name || user.email}</span>
                  </label>
                ))}
              </div>
              <button
                type="submit"
                className="rounded-md btn-primary px-4 py-2 text-sm font-semibold text-white"
              >
                Save watchers
              </button>
            </form>
          ) : (
            <p className="mt-4 text-sm text-slate-500">No users found.</p>
          )}
        </div>
      </section>
    ) : null}

      {activeTab === "subtasks" ? (
        <section className="rounded-lg border border-slate-200 bg-white">
          <div className="border-b border-slate-200 px-6 py-4">
            <h2 className="text-lg font-semibold text-slate-900">Add subtask</h2>
          </div>
          <div className="px-6 pb-6">
          <form action={createSubtask} className="mt-4 grid gap-4 md:grid-cols-5">
            <div className="grid gap-1 md:col-span-2">
              <label
                htmlFor="subtask-title"
                className="text-xs font-semibold uppercase tracking-wide text-slate-500"
              >
                Title
              </label>
              <input
                id="subtask-title"
                name="title"
                placeholder="Subtask title"
                className="rounded-md border border-slate-300 px-3 py-2 text-sm"
                required
              />
            </div>
            <div className="grid gap-1">
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Assignees
              </label>
              <AssigneeMultiSelect
                users={users || []}
                name="assignee_user_ids"
                className="relative"
              />
            </div>
            <div className="grid gap-1">
              <label
                htmlFor="subtask-status"
                className="text-xs font-semibold uppercase tracking-wide text-slate-500"
              >
                Status
              </label>
              <select
                id="subtask-status"
                name="status"
                className={`rounded-md border px-3 py-2 text-sm ${statusSelectClasses(
                  "to_do"
                )}`}
                defaultValue="to_do"
              >
                {statusOptions.map((status) => (
                  <option key={status} value={status}>
                    {formatTaskStatusLabel(status)}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid gap-1">
              <label
                htmlFor="subtask-priority"
                className="text-xs font-semibold uppercase tracking-wide text-slate-500"
              >
                Priority
              </label>
              <select
                id="subtask-priority"
                name="priority"
                className="rounded-md border border-slate-300 px-3 py-2 text-sm"
                defaultValue="medium"
              >
                {priorityOptions.map((priority) => (
                  <option key={priority} value={priority}>
                    {priority}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid gap-1">
              <label
                htmlFor="subtask-start-date"
                className="text-xs font-semibold uppercase tracking-wide text-slate-500"
              >
                Start date
              </label>
              <input
                id="subtask-start-date"
                type="date"
                name="start_date"
                className="rounded-md border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
            <div className="grid gap-1">
              <label
                htmlFor="subtask-due-date"
                className="text-xs font-semibold uppercase tracking-wide text-slate-500"
              >
                Due date
              </label>
              <input
                id="subtask-due-date"
                type="date"
                name="due_date"
                className="rounded-md border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
            <div className="grid gap-1">
              <label
                htmlFor="subtask-due-time"
                className="text-xs font-semibold uppercase tracking-wide text-slate-500"
              >
                Due time
              </label>
              <input
                id="subtask-due-time"
                type="time"
                name="due_time"
                className="rounded-md border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
            <button
              type="submit"
              className="md:col-span-5 rounded-md btn-primary px-4 py-2 text-sm font-semibold text-white "
            >
              Create subtask
            </button>
          </form>
        </div>
      </section>
    ) : null}

      {activeTab === "subtasks" ? (
        <section className="rounded-lg border border-slate-200 bg-white">
          <TasksView
            tasks={subtasks || []}
            users={users || []}
            clients={clients || []}
            projects={projects || []}
            assigneesByTask={subtasksById}
            openSubtaskCountByTaskId={openSubtaskCountByTaskId}
            statusOptions={statusOptions}
            priorityOptions={priorityOptions}
            dueOptions={dueDateFilters}
            initialView={selectedSubtaskView}
            returnTo={subtasksReturnTo}
            initialFilters={{
              status: selectedStatuses,
              priority: selectedPriorities,
              assignee: selectedAssignees,
              due: selectedDue,
              client: selectedClientIds,
              project: selectedProjectIds,
            }}
            onUpdate={updateTaskInlineAction}
            hideCompleted={hideCompleted}
            toggleUrl={subtasksToggleUrl}
            includeWatching={false}
            watchToggleUrl={subtasksReturnTo}
            showWatchToggle={false}
            sortKey={subtaskSortKey}
            sortDir={subtaskSortDir}
            basePath={`/tasks/${taskId}`}
            fixedParams={{ tab: "subtasks" }}
          />
        </section>
      ) : null}
      {activeTab === "notes" ? (
        <TaskNotesEditorClient
          taskId={task.id}
          initialContent={task.content ?? null}
          lastEditedAtLabel={lastEditedAtLabel}
          lastEditedByLabel={lastEditedByLabel}
        />
      ) : null}
    </div>
  );
}

