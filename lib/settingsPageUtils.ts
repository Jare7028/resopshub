import { DEFAULT_EDITOR_CONTENT } from "./editorContent";
import {
  DEFAULT_FEATURE_SUGGESTION_STATUS_OPTIONS,
  buildStatusOptionsWithMetadata,
  normalizeStatusColorHex,
  normalizeStatusValue,
  type StatusEntityType,
  type StatusOptionMetadata,
  type StatusOptionRow,
} from "./statusOptions";
import { SUPPORTED_TASK_STATUS_VALUES } from "./taskStatus";
import { extractPlainText } from "./tiptapText";

export type NotificationPrefsDbRow = {
  user_id: string;
  task_assigned: boolean | null;
  task_updated: boolean | null;
  task_due_today: boolean | null;
  task_overdue: boolean | null;
  feature_suggestion_comment: boolean | null;
  feature_suggestion_status: boolean | null;
  mentions_enabled: boolean | null;
  mention_task: boolean | null;
  mention_notes: boolean | null;
  mention_chat: boolean | null;
  mention_social: boolean | null;
  mention_feature_suggestion: boolean | null;
  mention_form_submission: boolean | null;
  mention_quiz: boolean | null;
  schedule_updates: boolean | null;
};

export type NotificationPrefs = {
  user_id: string;
  task_assigned: boolean;
  task_updated: boolean;
  task_due_today: boolean;
  task_overdue: boolean;
  feature_suggestion_comment: boolean;
  feature_suggestion_status: boolean;
  mentions_enabled: boolean;
  mention_task: boolean;
  mention_notes: boolean;
  mention_chat: boolean;
  mention_social: boolean;
  mention_feature_suggestion: boolean;
  mention_form_submission: boolean;
  mention_quiz: boolean;
  schedule_updates: boolean;
};

export type NotificationPrefsUpdatePayload = NotificationPrefs & {
  updated_at: string;
};

export type StatusOptionsResult = {
  data: SettingsStatusOptionRow[] | null;
  error: {
    message: string;
    code?: string;
    details?: string | null;
    hint?: string | null;
  } | null;
};

export type SettingsProfileDisplayRow = {
  email: string | null;
  full_name: string | null;
  avatar_url: string | null;
};

export type SettingsStatusOptionRow = StatusOptionRow & { id: string };
export type SettingsStatusRowWithId = StatusOptionMetadata & { id: string };
export type SettingsStatusSection = {
  title: string;
  entityType: StatusEntityType;
  placeholder: string;
  rows: SettingsStatusRowWithId[];
};

export type SettingsUserRow = {
  id: string;
  full_name: string | null;
  email: string | null;
};

export type SettingsAssignmentGroupRow = {
  id: string;
  name: string;
  memberCount: number;
  memberUserIds: readonly string[];
};

export type SettingsTaskTemplateRecord = {
  id: string;
};

export type SettingsProjectTemplateRecord = {
  id: string;
  name: string;
};

export type SettingsTaskTemplateSubtaskRecord = {
  task_template_id: string;
};

export type SettingsProjectTemplateTaskRecord = {
  project_template_id: string;
  task_template_id: string;
};

export type SettingsTaskTemplateAssigneeRecord = {
  task_template_id: string;
  user_id: string;
};

export type SettingsTaskTemplateSubtaskAssigneeRecord = {
  task_template_subtask_id: string;
  user_id: string;
};

export type SettingsTemplateCustomFieldRecord = {
  id: string;
  entity_type: string;
  entity_id: string | null;
};

export type SettingsTemplateCustomFieldOptionRecord = {
  field_id: string;
};

export type SettingsTemplateCustomFieldValueRecord = {
  field_id: string;
  text_value: string | null;
  option_value: string | null;
};

export type SettingsTemplatesTab = "tasks" | "projects";
export type TaskTemplatePanel = "details" | "custom-fields" | "subtasks";
export type ProjectTemplatePanel = "details" | "custom-fields" | "tasks";
export type SettingsUrlMessage = {
  kind: "error" | "success";
  value: string;
};

export type SettingsTemplateSearchParams = {
  templates?: string | null;
  task_template_id?: string | null;
  project_template_id?: string | null;
  task_template_panel?: string | null;
  project_template_panel?: string | null;
};

export function normalizeSettingsTemplateSearchParams(
  searchParams: SettingsTemplateSearchParams | null | undefined
) {
  const templatesTabRaw = String(searchParams?.templates || "")
    .trim()
    .toLowerCase();
  const templatesTab: SettingsTemplatesTab =
    templatesTabRaw === "projects" ? "projects" : "tasks";
  const selectedTaskTemplateId = String(searchParams?.task_template_id || "").trim();
  const selectedProjectTemplateId = String(searchParams?.project_template_id || "").trim();
  const taskTemplatePanelRaw = String(searchParams?.task_template_panel || "")
    .trim()
    .toLowerCase();
  const taskTemplatePanel: TaskTemplatePanel =
    taskTemplatePanelRaw === "custom-fields"
      ? "custom-fields"
      : taskTemplatePanelRaw === "subtasks"
        ? "subtasks"
        : "details";
  const projectTemplatePanelRaw = String(searchParams?.project_template_panel || "")
    .trim()
    .toLowerCase();
  const projectTemplatePanel: ProjectTemplatePanel =
    projectTemplatePanelRaw === "custom-fields"
      ? "custom-fields"
      : projectTemplatePanelRaw === "tasks"
        ? "tasks"
        : "details";

  return {
    templatesTab,
    selectedTaskTemplateId,
    selectedProjectTemplateId,
    taskTemplatePanel,
    projectTemplatePanel,
    taskTemplatePanelQuery: `&task_template_panel=${encodeURIComponent(taskTemplatePanel)}`,
    projectTemplatePanelQuery: `&project_template_panel=${encodeURIComponent(
      projectTemplatePanel
    )}`,
  };
}

export function buildSettingsUserNameLookup(users: readonly SettingsUserRow[]) {
  return users.reduce<Record<string, string>>((acc, row) => {
    acc[row.id] = row.full_name || row.email || "Unknown user";
    return acc;
  }, {});
}

export function buildSettingsAssignmentGroupSummary(
  assignmentGroups: readonly SettingsAssignmentGroupRow[],
  userNameById: Record<string, string>
) {
  const options = assignmentGroups.map((group) => ({
    id: group.id,
    name: group.name,
    memberCount: group.memberCount,
  }));
  const memberIdsByGroupId = assignmentGroups.reduce<Record<string, Set<string>>>(
    (acc, group) => {
      acc[group.id] = new Set(group.memberUserIds);
      return acc;
    },
    {}
  );
  const memberLabelsByGroupId = assignmentGroups.reduce<Record<string, string[]>>(
    (acc, group) => {
      acc[group.id] = group.memberUserIds
        .map((memberId) => userNameById[memberId] || "")
        .filter(Boolean)
        .sort((left, right) => left.localeCompare(right));
      return acc;
    },
    {}
  );
  const totalMemberSlots = assignmentGroups.reduce(
    (total, group) => total + group.memberCount,
    0
  );
  const uniqueMemberCount = new Set(
    assignmentGroups.flatMap((group) => group.memberUserIds)
  ).size;

  return {
    options,
    memberIdsByGroupId,
    memberLabelsByGroupId,
    totalMemberSlots,
    uniqueMemberCount,
  };
}

export function buildSettingsTemplateRelationshipSummary<
  TaskTemplate extends SettingsTaskTemplateRecord,
  ProjectTemplate extends SettingsProjectTemplateRecord,
  TaskTemplateSubtask extends SettingsTaskTemplateSubtaskRecord,
  ProjectTemplateTask extends SettingsProjectTemplateTaskRecord,
  TaskTemplateAssignee extends SettingsTaskTemplateAssigneeRecord,
  TaskTemplateSubtaskAssignee extends SettingsTaskTemplateSubtaskAssigneeRecord,
>(params: {
  taskTemplates: readonly TaskTemplate[];
  projectTemplates: readonly ProjectTemplate[];
  taskTemplateSubtasks: readonly TaskTemplateSubtask[];
  projectTemplateTasks: readonly ProjectTemplateTask[];
  taskTemplateAssignees: readonly TaskTemplateAssignee[];
  taskTemplateSubtaskAssignees: readonly TaskTemplateSubtaskAssignee[];
  selectedTaskTemplateId?: string | null;
}) {
  const subtasksByTemplateId = params.taskTemplateSubtasks.reduce<
    Record<string, TaskTemplateSubtask[]>
  >((acc, row) => {
    acc[row.task_template_id] ||= [];
    acc[row.task_template_id].push(row);
    return acc;
  }, {});
  const tasksByProjectTemplateId = params.projectTemplateTasks.reduce<
    Record<string, ProjectTemplateTask[]>
  >((acc, row) => {
    acc[row.project_template_id] ||= [];
    acc[row.project_template_id].push(row);
    return acc;
  }, {});
  const assigneeIdsByTaskTemplateId = params.taskTemplateAssignees.reduce<
    Record<string, string[]>
  >((acc, row) => {
    acc[row.task_template_id] ||= [];
    acc[row.task_template_id].push(row.user_id);
    return acc;
  }, {});
  const assigneeIdsByTaskTemplateSubtaskId =
    params.taskTemplateSubtaskAssignees.reduce<Record<string, string[]>>(
      (acc, row) => {
        acc[row.task_template_subtask_id] ||= [];
        acc[row.task_template_subtask_id].push(row.user_id);
        return acc;
      },
      {}
    );
  const taskTemplateById = params.taskTemplates.reduce<Record<string, TaskTemplate>>(
    (acc, template) => {
      acc[template.id] = template;
      return acc;
    },
    {}
  );
  const projectTemplateById = params.projectTemplates.reduce<
    Record<string, ProjectTemplate>
  >((acc, template) => {
    acc[template.id] = template;
    return acc;
  }, {});
  const projectTemplateLinksByTaskTemplateId = params.projectTemplateTasks.reduce<
    Record<string, ProjectTemplateTask[]>
  >((acc, row) => {
    acc[row.task_template_id] ||= [];
    acc[row.task_template_id].push(row);
    return acc;
  }, {});
  const selectedTaskTemplateId = String(params.selectedTaskTemplateId || "").trim();
  const selectedTaskTemplateAssigneeIds = selectedTaskTemplateId
    ? assigneeIdsByTaskTemplateId[selectedTaskTemplateId] || []
    : [];
  const selectedTaskTemplateProjectLinks = selectedTaskTemplateId
    ? [...(projectTemplateLinksByTaskTemplateId[selectedTaskTemplateId] || [])].sort(
        (left, right) => {
          const leftName =
            projectTemplateById[left.project_template_id]?.name || left.project_template_id;
          const rightName =
            projectTemplateById[right.project_template_id]?.name || right.project_template_id;
          return leftName.localeCompare(rightName, undefined, { sensitivity: "base" });
        }
      )
    : [];
  const selectedTaskTemplateLinkedProjectTemplateIds = new Set(
    selectedTaskTemplateProjectLinks.map((link) => link.project_template_id)
  );
  const availableProjectTemplatesForTaskTemplate = selectedTaskTemplateId
    ? params.projectTemplates.filter(
        (template) => !selectedTaskTemplateLinkedProjectTemplateIds.has(template.id)
      )
    : [];

  return {
    subtasksByTemplateId,
    tasksByProjectTemplateId,
    assigneeIdsByTaskTemplateId,
    assigneeIdsByTaskTemplateSubtaskId,
    taskTemplateById,
    projectTemplateById,
    projectTemplateLinksByTaskTemplateId,
    selectedTaskTemplateAssigneeIds,
    selectedTaskTemplateProjectLinks,
    selectedTaskTemplateLinkedProjectTemplateIds,
    availableProjectTemplatesForTaskTemplate,
  };
}

export function buildSettingsTemplateCustomFieldSummary<
  Field extends SettingsTemplateCustomFieldRecord,
  Option extends SettingsTemplateCustomFieldOptionRecord,
  Value extends SettingsTemplateCustomFieldValueRecord,
>(params: {
  templateCustomFields: readonly Field[];
  templateCustomFieldOptions: readonly Option[];
  templateCustomFieldValues: readonly Value[];
  selectedTaskTemplateId?: string | null;
  selectedProjectTemplateId?: string | null;
}) {
  const selectedTaskTemplateId = String(params.selectedTaskTemplateId || "").trim();
  const selectedProjectTemplateId = String(params.selectedProjectTemplateId || "").trim();
  const selectedTaskTemplateCustomFields = selectedTaskTemplateId
    ? params.templateCustomFields.filter(
        (field) =>
          field.entity_type === "task_template" &&
          field.entity_id === selectedTaskTemplateId
      )
    : [];
  const selectedProjectTemplateCustomFields = selectedProjectTemplateId
    ? params.templateCustomFields.filter(
        (field) =>
          field.entity_type === "project_template" &&
          field.entity_id === selectedProjectTemplateId
      )
    : [];
  const templateCustomFieldOptionsByFieldId =
    params.templateCustomFieldOptions.reduce<Record<string, Option[]>>(
      (acc, option) => {
        acc[option.field_id] ||= [];
        acc[option.field_id].push(option);
        return acc;
      },
      {}
    );
  const templateCustomFieldValueByFieldId = new Map<string, string>(
    params.templateCustomFieldValues.map((row) => [
      row.field_id,
      row.option_value || row.text_value || "",
    ])
  );

  return {
    selectedTaskTemplateCustomFields,
    selectedProjectTemplateCustomFields,
    templateCustomFieldOptionsByFieldId,
    templateCustomFieldValueByFieldId,
  };
}

export function buildSettingsProfileDisplay(profile: SettingsProfileDisplayRow) {
  const displayName =
    String(profile.full_name || profile.email || "User").trim() || "User";
  return {
    displayName,
    initials: toInitials(displayName),
    avatarUrl: String(profile.avatar_url || "").trim(),
  };
}

export function buildSettingsNotificationPrefs(
  userId: string,
  prefsDb: NotificationPrefsDbRow | null | undefined
): NotificationPrefs {
  return {
    user_id: userId,
    task_assigned: prefValue(prefsDb?.task_assigned, defaultPrefs.task_assigned),
    task_updated: prefValue(prefsDb?.task_updated, defaultPrefs.task_updated),
    task_due_today: prefValue(prefsDb?.task_due_today, defaultPrefs.task_due_today),
    task_overdue: prefValue(prefsDb?.task_overdue, defaultPrefs.task_overdue),
    feature_suggestion_comment: prefValue(
      prefsDb?.feature_suggestion_comment,
      defaultPrefs.feature_suggestion_comment
    ),
    feature_suggestion_status: prefValue(
      prefsDb?.feature_suggestion_status,
      defaultPrefs.feature_suggestion_status
    ),
    mentions_enabled: prefValue(prefsDb?.mentions_enabled, defaultPrefs.mentions_enabled),
    mention_task: prefValue(prefsDb?.mention_task, defaultPrefs.mention_task),
    mention_notes: prefValue(prefsDb?.mention_notes, defaultPrefs.mention_notes),
    mention_chat: prefValue(prefsDb?.mention_chat, defaultPrefs.mention_chat),
    mention_social: prefValue(prefsDb?.mention_social, defaultPrefs.mention_social),
    mention_feature_suggestion: prefValue(
      prefsDb?.mention_feature_suggestion,
      defaultPrefs.mention_feature_suggestion
    ),
    mention_form_submission: prefValue(
      prefsDb?.mention_form_submission,
      defaultPrefs.mention_form_submission
    ),
    mention_quiz: prefValue(prefsDb?.mention_quiz, defaultPrefs.mention_quiz),
    schedule_updates: prefValue(prefsDb?.schedule_updates, defaultPrefs.schedule_updates),
  };
}

export function buildSettingsNotificationPrefsUpdate(
  userId: string,
  formData: FormData,
  updatedAt = new Date().toISOString()
): NotificationPrefsUpdatePayload {
  return {
    user_id: userId,
    task_assigned: checkbox(formData, "task_assigned"),
    task_updated: checkbox(formData, "task_updated"),
    task_due_today: checkbox(formData, "task_due_today"),
    task_overdue: checkbox(formData, "task_overdue"),
    feature_suggestion_comment: checkbox(formData, "feature_suggestion_comment"),
    feature_suggestion_status: checkbox(formData, "feature_suggestion_status"),
    mentions_enabled: checkbox(formData, "mentions_enabled"),
    mention_task: checkbox(formData, "mention_task"),
    mention_notes: checkbox(formData, "mention_notes"),
    mention_chat: checkbox(formData, "mention_chat"),
    mention_social: checkbox(formData, "mention_social"),
    mention_feature_suggestion: checkbox(formData, "mention_feature_suggestion"),
    mention_form_submission: checkbox(formData, "mention_form_submission"),
    mention_quiz: checkbox(formData, "mention_quiz"),
    schedule_updates: checkbox(formData, "schedule_updates"),
    updated_at: updatedAt,
  };
}

export function buildSettingsLegacyNotificationPrefsUpdate(
  prefs: NotificationPrefsUpdatePayload
) {
  return {
    user_id: prefs.user_id,
    task_assigned: prefs.task_assigned,
    task_updated: prefs.task_updated,
    task_due_today: prefs.task_due_today,
    task_overdue: prefs.task_overdue,
    feature_suggestion_comment: prefs.feature_suggestion_comment,
    feature_suggestion_status: prefs.feature_suggestion_status,
    updated_at: prefs.updated_at,
  };
}

export function buildSettingsStatusRowsWithIds(
  entityType: StatusEntityType,
  statusRows: readonly StatusOptionMetadata[],
  statusOptions: readonly SettingsStatusOptionRow[]
) {
  const idByValue = new Map(
    statusOptions
      .filter((option) => option.entity_type === entityType)
      .map((option) => [normalizeStatusValue(option.value), option.id] as const)
  );
  return statusRows.map((status) => ({
    ...status,
    id: idByValue.get(status.value) || "",
  }));
}

export function buildSettingsStatusSummary(
  statusOptions: readonly SettingsStatusOptionRow[]
) {
  const statusRows = Array.from(statusOptions);
  const taskStatusOptionsWithMetadata = buildStatusOptionsWithMetadata(
    "task",
    statusRows,
    []
  );
  const projectStatusOptionsWithMetadata = buildStatusOptionsWithMetadata(
    "project",
    statusRows,
    []
  );
  const featureSuggestionStatusOptions = buildStatusOptionsWithMetadata(
    "feature_suggestion",
    statusRows,
    DEFAULT_FEATURE_SUGGESTION_STATUS_OPTIONS
  );
  const taskStatusRowsWithIds = buildSettingsStatusRowsWithIds(
    "task",
    taskStatusOptionsWithMetadata,
    statusOptions
  );
  const projectStatusRowsWithIds = buildSettingsStatusRowsWithIds(
    "project",
    projectStatusOptionsWithMetadata,
    statusOptions
  );
  const featureSuggestionStatusRowsWithIds = buildSettingsStatusRowsWithIds(
    "feature_suggestion",
    featureSuggestionStatusOptions,
    statusOptions
  );
  const statusSections: SettingsStatusSection[] = [
    {
      title: "Task statuses",
      entityType: "task",
      placeholder: "e.g. qa_review",
      rows: taskStatusRowsWithIds,
    },
    {
      title: "Project statuses",
      entityType: "project",
      placeholder: "e.g. pending_review",
      rows: projectStatusRowsWithIds,
    },
    {
      title: "Feature suggestion statuses",
      entityType: "feature_suggestion",
      placeholder: "e.g. blocked_pending",
      rows: featureSuggestionStatusRowsWithIds,
    },
  ];

  return {
    taskStatusOptionsWithMetadata,
    projectStatusOptionsWithMetadata,
    featureSuggestionStatusOptions,
    taskStatusOptions: taskStatusOptionsWithMetadata.map((status) => status.value),
    projectStatusOptions: projectStatusOptionsWithMetadata.map((status) => status.value),
    statusSections,
  };
}

export function buildSettingsTemplateEntityUrl(params: {
  entityType: string;
  entityId: string;
  taskTemplatePanelQuery?: string;
  projectTemplatePanelQuery?: string;
  message?: SettingsUrlMessage;
}) {
  const isTaskTemplate = params.entityType === "task_template";
  const templatesTab = isTaskTemplate ? "tasks" : "projects";
  const idParam = isTaskTemplate ? "task_template_id" : "project_template_id";
  const panelQuery = isTaskTemplate
    ? params.taskTemplatePanelQuery || ""
    : params.projectTemplatePanelQuery || "";
  const messageQuery = buildSettingsMessageQuery(params.message);

  return `/settings?tab=templates&templates=${templatesTab}&${idParam}=${encodeURIComponent(
    params.entityId
  )}${panelQuery}${messageQuery}`;
}

function buildSettingsMessageQuery(
  message: SettingsUrlMessage | null | undefined
) {
  return message ? `&${message.kind}=${encodeURIComponent(message.value)}` : "";
}

export function buildSettingsTaskTemplateUrl(params: {
  taskTemplateId?: string | null;
  taskTemplatePanelQuery?: string;
  message?: SettingsUrlMessage;
}) {
  const taskTemplateId = String(params.taskTemplateId || "").trim();
  const idQuery = taskTemplateId
    ? `&task_template_id=${encodeURIComponent(taskTemplateId)}`
    : "";
  return `/settings?tab=templates&templates=tasks${idQuery}${
    params.taskTemplatePanelQuery || ""
  }${buildSettingsMessageQuery(params.message)}`;
}

export function buildSettingsProjectTemplateUrl(params: {
  projectTemplateId?: string | null;
  projectTemplatePanelQuery?: string;
  message?: SettingsUrlMessage;
}) {
  const projectTemplateId = String(params.projectTemplateId || "").trim();
  const idQuery = projectTemplateId
    ? `&project_template_id=${encodeURIComponent(projectTemplateId)}`
    : "";
  return `/settings?tab=templates&templates=projects${idQuery}${
    params.projectTemplatePanelQuery || ""
  }${buildSettingsMessageQuery(params.message)}`;
}

export function buildSettingsProjectTemplateTaskReturnUrl(params: {
  returnTemplatesTab: string;
  returnTaskTemplateId?: string | null;
  projectTemplateId?: string | null;
  taskTemplatePanelQuery?: string;
  projectTemplatePanelQuery?: string;
  includeProjectContext?: boolean;
  message: SettingsUrlMessage;
}) {
  return params.returnTemplatesTab === "tasks"
    ? buildSettingsTaskTemplateUrl({
        taskTemplateId: params.returnTaskTemplateId,
        taskTemplatePanelQuery: params.taskTemplatePanelQuery,
        message: params.message,
      })
    : buildSettingsProjectTemplateUrl({
        projectTemplateId:
          params.includeProjectContext === false ? "" : params.projectTemplateId,
        projectTemplatePanelQuery:
          params.includeProjectContext === false ? "" : params.projectTemplatePanelQuery,
        message: params.message,
      });
}

export const defaultPrefs: Omit<NotificationPrefs, "user_id"> = {
  task_assigned: true,
  task_updated: true,
  task_due_today: true,
  task_overdue: true,
  feature_suggestion_comment: true,
  feature_suggestion_status: true,
  mentions_enabled: true,
  mention_task: true,
  mention_notes: true,
  mention_chat: true,
  mention_social: true,
  mention_feature_suggestion: true,
  mention_form_submission: true,
  mention_quiz: true,
  schedule_updates: true,
};

export const defaultContentText = extractPlainText(DEFAULT_EDITOR_CONTENT);
export const USER_AVATARS_BUCKET = "user-avatars";
export const MAX_AVATAR_SIZE_BYTES = 5 * 1024 * 1024;
export const TASK_STATUS_OPTION_VALIDATION_MESSAGE = `Task statuses must use supported values: ${SUPPORTED_TASK_STATUS_VALUES.join(", ")}.`;
export const SETTINGS_EDIT_PERMISSION_MESSAGE =
  "You do not have permission to manage settings.";

export function toInitials(label: string) {
  const words = label
    .split(/\s+/)
    .map((word) => word.trim())
    .filter(Boolean)
    .slice(0, 2);
  if (!words.length) return "NA";
  return words.map((word) => word.charAt(0).toUpperCase()).join("");
}

export function checkbox(formData: FormData, key: string) {
  return String(formData.get(key) || "") === "on";
}

export function statusColorValue(formData: FormData, key: string): string | null {
  const raw = String(formData.get(key) || "").trim();
  if (!raw) return null;
  return normalizeStatusColorHex(raw);
}

export function normalizeSettingsStatusEntityType(value: unknown): StatusEntityType {
  const entityTypeRaw = String(value || "").trim().toLowerCase();
  return entityTypeRaw === "task" ||
    entityTypeRaw === "project" ||
    entityTypeRaw === "feature_suggestion"
    ? entityTypeRaw
    : "task";
}

export function buildSettingsStatusFormInput(formData: FormData) {
  const rawColorHex = String(formData.get("color_hex") || "").trim();
  return {
    entityType: normalizeSettingsStatusEntityType(formData.get("entity_type")),
    value: normalizeStatusValue(String(formData.get("value") || "")),
    isVisible: checkbox(formData, "is_visible"),
    countsAsCompleted: checkbox(formData, "counts_as_completed"),
    rawColorHex,
    colorHex: rawColorHex ? normalizeStatusColorHex(rawColorHex) : null,
  };
}

export function normalizeSettingsStatusPosition(value: unknown): number {
  const parsed = Number(value || "");
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 1;
}

export function prefValue(
  value: boolean | null | undefined,
  fallback: boolean
): boolean {
  return value === false ? false : value === true ? true : fallback;
}

export function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value
  );
}

export function formatDbError(
  context: string,
  error:
    | {
        message: string;
        code?: string;
        details?: string | null;
        hint?: string | null;
      }
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
