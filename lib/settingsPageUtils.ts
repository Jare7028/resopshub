import { DEFAULT_EDITOR_CONTENT } from "./editorContent";
import { normalizeStatusColorHex, type StatusOptionRow } from "./statusOptions";
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

export type StatusOptionsResult = {
  data: Array<StatusOptionRow & { id: string }> | null;
  error: {
    message: string;
    code?: string;
    details?: string | null;
    hint?: string | null;
  } | null;
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

export type SettingsTemplatesTab = "tasks" | "projects";
export type TaskTemplatePanel = "details" | "custom-fields" | "subtasks";
export type ProjectTemplatePanel = "details" | "custom-fields" | "tasks";

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

export function buildSettingsTemplateEntityUrl(params: {
  entityType: string;
  entityId: string;
  taskTemplatePanelQuery?: string;
  projectTemplatePanelQuery?: string;
  message?: {
    kind: "error" | "success";
    value: string;
  };
}) {
  const isTaskTemplate = params.entityType === "task_template";
  const templatesTab = isTaskTemplate ? "tasks" : "projects";
  const idParam = isTaskTemplate ? "task_template_id" : "project_template_id";
  const panelQuery = isTaskTemplate
    ? params.taskTemplatePanelQuery || ""
    : params.projectTemplatePanelQuery || "";
  const messageQuery = params.message
    ? `&${params.message.kind}=${encodeURIComponent(params.message.value)}`
    : "";

  return `/settings?tab=templates&templates=${templatesTab}&${idParam}=${encodeURIComponent(
    params.entityId
  )}${panelQuery}${messageQuery}`;
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
