import { randomBytes } from "node:crypto";
import Image from "next/image";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getCurrentRequestUser } from "@/lib/supabase/currentUser";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  isSupabaseMissingColumnError,
  isSupabaseMissingTableError,
} from "@/lib/supabaseErrors";
import { getPageEditAccess } from "@/lib/pageEditAccess";
import { withPerfTiming } from "@/lib/perf";
import {
  buildStatusOptionsWithMetadata,
  isCoreStatus,
  normalizeStatusValue,
  type StatusOptionRow,
} from "@/lib/statusOptions";
import {
  normalizeCustomFieldKind,
  toCustomFieldKey,
  type CustomFieldValueRow,
  type CustomFieldOptionRow,
  type CustomFieldRow,
} from "@/lib/customFields";
import { DEFAULT_EDITOR_CONTENT } from "@/lib/editorContent";
import {
  loadAssignmentGroups,
  resolveAssignmentTargetsToUserIds,
} from "@/lib/assignmentGroups";
import {
  ALLOWED_UPLOAD_IMAGE_ACCEPT,
  validateUploadImageFile,
} from "@/lib/imageUploadValidation";
import {
  isSupportedTaskStatus,
} from "@/lib/taskStatus";
import {
  MAX_AVATAR_SIZE_BYTES,
  SETTINGS_EDIT_PERMISSION_MESSAGE,
  TASK_STATUS_OPTION_VALIDATION_MESSAGE,
  USER_AVATARS_BUCKET,
  buildSettingsAssignmentGroupSummary,
  buildSettingsLegacyNotificationPrefsUpdate,
  buildSettingsNotificationPrefs,
  buildSettingsNotificationPrefsUpdate,
  buildSettingsProfileDisplay,
  buildSettingsProjectTemplateUrl,
  buildSettingsProjectTemplateTaskReturnUrl,
  buildSettingsStatusFormInput,
  buildSettingsStatusSummary,
  buildSettingsTaskTemplateUrl,
  buildSettingsTemplateCustomFieldSummary,
  buildSettingsTemplateEntityUrl,
  buildSettingsTemplateRelationshipSummary,
  buildSettingsUserNameLookup,
  checkbox,
  defaultContentText,
  formatDbError,
  isUuid,
  normalizeSettingsTemplateSearchParams,
  normalizeSettingsStatusEntityType,
  normalizeSettingsStatusPosition,
  type NotificationPrefs,
  type NotificationPrefsDbRow,
  type SettingsUrlMessage,
  type StatusOptionsResult,
} from "@/lib/settingsPageUtils";
import ConfirmSubmitButton from "../_components/ConfirmSubmitButton";
import AssigneeMultiSelect from "../tasks/_components/AssigneeMultiSelect";
import SettingsTabs, {
  normalizeSettingsTabKey,
} from "./_components/SettingsTabs";
import StatusOptionsPanel from "./_components/StatusOptionsPanel";

export const dynamic = "force-dynamic";

export default async function SettingsPage(props: {
  searchParams?: Promise<{
    tab?: string;
    templates?: string;
    task_template_id?: string;
    project_template_id?: string;
    task_template_panel?: string;
    project_template_panel?: string;
    success?: string;
    error?: string;
  }>;
}) {
  const searchParams = await props.searchParams;
  const activeTab = normalizeSettingsTabKey(searchParams?.tab);
  const {
    templatesTab,
    selectedTaskTemplateId,
    selectedProjectTemplateId,
    taskTemplatePanel,
    projectTemplatePanel,
    taskTemplatePanelQuery,
    projectTemplatePanelQuery,
  } = normalizeSettingsTemplateSearchParams(searchParams);

  const supabase = createSupabaseServerClient();
  const user = await getCurrentRequestUser(supabase, "settings.auth");

  if (!user) {
    redirect("/login");
  }

  let profile:
    | {
        id: string;
        email: string | null;
        full_name: string | null;
        role: string | null;
        avatar_url: string | null;
        avatar_storage_path: string | null;
      }
    | null = null;

  const profileWithAvatarResult = await withPerfTiming("settings.profile", () =>
    supabase
      .from("users")
      .select("id,email,full_name,role,avatar_url,avatar_storage_path")
      .eq("id", user.id)
      .maybeSingle()
  );

  if (profileWithAvatarResult.error) {
    if (isSupabaseMissingColumnError(profileWithAvatarResult.error)) {
      const profileFallbackResult = await withPerfTiming("settings.profile.fallback", () =>
        supabase.from("users").select("id,email,full_name,role").eq("id", user.id).maybeSingle()
      );
      if (profileFallbackResult.error) {
        redirect(`/dashboard?error=${encodeURIComponent(profileFallbackResult.error.message)}`);
      }
      profile = profileFallbackResult.data
        ? {
            ...profileFallbackResult.data,
            avatar_url: null,
            avatar_storage_path: null,
          }
        : null;
    } else {
      redirect(`/dashboard?error=${encodeURIComponent(profileWithAvatarResult.error.message)}`);
    }
  } else {
    profile = profileWithAvatarResult.data;
  }

  if (!profile) {
    redirect("/dashboard?error=Missing%20profile");
  }

  const shouldLoadTemplatesTab = activeTab === "templates";
  const shouldLoadUsers = shouldLoadTemplatesTab || activeTab === "groups";
  const shouldLoadAssignmentGroups = shouldLoadTemplatesTab || activeTab === "groups";
  const shouldLoadNotificationPrefs = activeTab === "notifications";
  const shouldLoadStatusOptions = activeTab === "statuses" || shouldLoadTemplatesTab;

  const usersResult = shouldLoadUsers
    ? await withPerfTiming("settings.users", () =>
        supabase.from("users").select("id,full_name,email").order("full_name", { ascending: true })
      )
    : { data: [] as Array<{ id: string; full_name: string | null; email: string | null }> };
  const users = (usersResult.data || []) as Array<{
    id: string;
    full_name: string | null;
    email: string | null;
  }>;
  const userNameById = buildSettingsUserNameLookup(users);

  const assignmentGroupsResult = shouldLoadAssignmentGroups
    ? await withPerfTiming("settings.assignment_groups", () =>
        loadAssignmentGroups(supabase)
      )
    : {
        groups: [],
        schemaMissing: false,
        error: null,
      };
  const assignmentGroups = assignmentGroupsResult.groups;
  const assignmentGroupsSchemaMissing = assignmentGroupsResult.schemaMissing;
  const assignmentGroupsError = assignmentGroupsResult.error;
  const {
    options: assignmentGroupOptions,
    memberIdsByGroupId: assignmentGroupMemberIdsByGroupId,
    memberLabelsByGroupId: assignmentGroupMemberLabelsByGroupId,
    totalMemberSlots: assignmentGroupTotalMemberSlots,
    uniqueMemberCount: assignmentGroupUniqueMemberCount,
  } = buildSettingsAssignmentGroupSummary(assignmentGroups, userNameById);

  let prefsResult = shouldLoadNotificationPrefs
    ? ((await withPerfTiming("settings.notification_prefs", () =>
        supabase
          .from("user_notification_preferences")
          .select(
            "user_id,task_assigned,task_updated,task_due_today,task_overdue,feature_suggestion_comment,feature_suggestion_status,mentions_enabled,mention_task,mention_notes,mention_chat,mention_social,mention_feature_suggestion,mention_form_submission,mention_quiz,schedule_updates"
          )
          .eq("user_id", user.id)
          .maybeSingle()
      )) as {
        data: NotificationPrefsDbRow | null;
        error: {
          message: string;
          code?: string;
          details?: string | null;
          hint?: string | null;
        } | null;
      })
    : ({
        data: null,
        error: null,
      } as {
        data: NotificationPrefsDbRow | null;
        error: {
          message: string;
          code?: string;
          details?: string | null;
          hint?: string | null;
        } | null;
      });
  if (
    shouldLoadNotificationPrefs &&
    prefsResult.error &&
    isSupabaseMissingColumnError(prefsResult.error)
  ) {
    const legacyPrefs = await withPerfTiming("settings.notification_prefs.legacy", () =>
      supabase
        .from("user_notification_preferences")
        .select(
          "user_id,task_assigned,task_updated,task_due_today,task_overdue,feature_suggestion_comment,feature_suggestion_status"
        )
        .eq("user_id", user.id)
        .maybeSingle()
    );
    prefsResult = {
      data: (legacyPrefs.data as NotificationPrefsDbRow | null) || null,
      error: legacyPrefs.error as {
        message: string;
        code?: string;
        details?: string | null;
        hint?: string | null;
      } | null,
    };
  }

  const prefsDb = (prefsResult.data || null) as NotificationPrefsDbRow | null;
  const prefs: NotificationPrefs = buildSettingsNotificationPrefs(user.id, prefsDb);

  let statusOptionsResult: StatusOptionsResult = shouldLoadStatusOptions
    ? ((await supabase
        .from("status_options")
        .select("id,entity_type,value,position,is_visible,counts_as_completed,color_hex")
        .order("entity_type", { ascending: true })
        .order("position", { ascending: true })
        .order("value", { ascending: true })
    ) as StatusOptionsResult)
    : ({
        data: [] as Array<StatusOptionRow & { id: string }>,
        error: null,
      } as StatusOptionsResult);
  if (
    shouldLoadStatusOptions &&
    statusOptionsResult.error &&
    isSupabaseMissingColumnError(statusOptionsResult.error)
  ) {
    const legacy = await supabase
      .from("status_options")
      .select("id,entity_type,value,position")
      .order("entity_type", { ascending: true })
      .order("position", { ascending: true })
      .order("value", { ascending: true });
    statusOptionsResult = {
      data: ((legacy.data || []) as Array<StatusOptionRow & { id: string }>),
      error: legacy.error as StatusOptionsResult["error"],
    };
  }
  const statusOptionsError = statusOptionsResult.error;
  const statusOptions = (statusOptionsError ? [] : statusOptionsResult.data || []) as Array<
    StatusOptionRow & { id: string }
  >;
  const {
    taskStatusOptions,
    projectStatusOptions,
    statusSections,
  } = buildSettingsStatusSummary(statusOptions);

  type TaskTemplateRow = {
    id: string;
    name: string;
    title: string;
    description: string | null;
    status: string;
    priority: string;
    due_time: string | null;
    recurrence_frequency: string | null;
    recurrence_lead_days: number | null;
  };

  type ProjectTemplateRow = {
    id: string;
    name: string;
    description: string | null;
    status: string;
  };

  type TaskTemplateSubtaskRow = {
    id: string;
    task_template_id: string;
    position: number;
    title: string;
    description: string | null;
    status: string;
    priority: string;
  };

  type ProjectTemplateTaskRow = {
    id: string;
    project_template_id: string;
    task_template_id: string;
    position: number;
  };

  type TaskTemplateAssigneeRow = {
    task_template_id: string;
    user_id: string;
  };
  type TaskTemplateSubtaskAssigneeRow = {
    task_template_subtask_id: string;
    user_id: string;
  };

  let taskTemplatesError: unknown = null;
  let projectTemplatesError: unknown = null;
  let taskTemplateSubtasksError: unknown = null;
  let projectTemplateTasksError: unknown = null;
  let taskTemplateAssigneesError: unknown = null;
  let taskTemplateSubtaskAssigneesError: unknown = null;
  let taskTemplates: TaskTemplateRow[] = [];
  let mirroredTaskTemplateIds = new Set<string>();
  let projectTemplates: ProjectTemplateRow[] = [];
  let selectedTaskTemplate: TaskTemplateRow | null = null;
  let selectedProjectTemplate: ProjectTemplateRow | null = null;
  const templateCustomFieldEntityFilters: Array<[string, string]> = [];
  let templateCustomFields: CustomFieldRow[] = [];
  let templateCustomFieldOptions: CustomFieldOptionRow[] = [];
  let templateCustomFieldValues: CustomFieldValueRow[] = [];
  let taskTemplateSubtasks: TaskTemplateSubtaskRow[] = [];
  let projectTemplateTasks: ProjectTemplateTaskRow[] = [];
  let taskTemplateAssignees: TaskTemplateAssigneeRow[] = [];
  let taskTemplateSubtaskAssignees: TaskTemplateSubtaskAssigneeRow[] = [];

  if (shouldLoadTemplatesTab) {
    const [taskTemplatesResult, mirroredTaskTemplateResult, projectTemplatesResult] =
      await Promise.all([
        supabase
          .from("task_templates")
          .select(
            "id,name,title,description,status,priority,due_time,recurrence_frequency,recurrence_lead_days"
          )
          .order("name", { ascending: true }),
        supabase
          .from("tasks")
          .select("id")
          .eq("status", "template")
          .is("parent_task_id", null),
        supabase
          .from("project_templates")
          .select("id,name,description,status")
          .order("name", { ascending: true }),
      ]);

    taskTemplatesError = taskTemplatesResult.error;
    projectTemplatesError = projectTemplatesResult.error;
    taskTemplates = (taskTemplatesResult.error ? [] : taskTemplatesResult.data || []) as TaskTemplateRow[];
    mirroredTaskTemplateIds = new Set(
      ((mirroredTaskTemplateResult.data || []) as Array<{ id: string }>).map((row) => row.id)
    );
    projectTemplates = (projectTemplatesResult.error
      ? []
      : projectTemplatesResult.data || []) as ProjectTemplateRow[];

    selectedTaskTemplate =
      selectedTaskTemplateId && templatesTab === "tasks"
        ? taskTemplates.find((tpl) => tpl.id === selectedTaskTemplateId) || null
        : null;
    selectedProjectTemplate =
      selectedProjectTemplateId && templatesTab === "projects"
        ? projectTemplates.find((tpl) => tpl.id === selectedProjectTemplateId) || null
        : null;

    if (selectedTaskTemplate?.id) {
      templateCustomFieldEntityFilters.push(["task_template", selectedTaskTemplate.id]);
    }
    if (selectedProjectTemplate?.id) {
      templateCustomFieldEntityFilters.push(["project_template", selectedProjectTemplate.id]);
    }

    if (templateCustomFieldEntityFilters.length) {
      const filterExpr = templateCustomFieldEntityFilters
        .map(
          ([entityType, entityId]) =>
            `and(entity_type.eq.${entityType},entity_id.eq.${entityId})`
        )
        .join(",");
      const { data: templateFieldsRaw } = await supabase
        .from("custom_fields")
        .select("id,entity_type,entity_id,key,label,field_kind,position")
        .or(filterExpr)
        .order("position", { ascending: true })
        .order("label", { ascending: true });
      templateCustomFields = (templateFieldsRaw || []) as CustomFieldRow[];
      const fieldIds = templateCustomFields.map((field) => field.id);
      if (fieldIds.length) {
        const { data: templateOptionsRaw } = await supabase
          .from("custom_field_options")
          .select("id,field_id,value,position")
          .in("field_id", fieldIds)
          .order("position", { ascending: true })
          .order("value", { ascending: true });
        templateCustomFieldOptions = (templateOptionsRaw || []) as CustomFieldOptionRow[];
        const templateValueExpr = templateCustomFieldEntityFilters
          .map(
            ([entityType, entityId]) =>
              `and(entity_type.eq.${entityType},entity_id.eq.${entityId})`
          )
          .join(",");
        const { data: templateValuesRaw } = await supabase
          .from("custom_field_values")
          .select("field_id,text_value,option_value,entity_type,entity_id")
          .or(templateValueExpr)
          .in("field_id", fieldIds);
        templateCustomFieldValues = (templateValuesRaw || []) as CustomFieldValueRow[];
      }
    }

    const [
      taskTemplateSubtasksResult,
      projectTemplateTasksResult,
      taskTemplateAssigneesResult,
      taskTemplateSubtaskAssigneesResult,
    ] = await Promise.all([
      supabase
        .from("task_template_subtasks")
        .select("id,task_template_id,position,title,description,status,priority")
        .order("task_template_id", { ascending: true })
        .order("position", { ascending: true }),
      supabase
        .from("project_template_tasks")
        .select("id,project_template_id,task_template_id,position")
        .order("project_template_id", { ascending: true })
        .order("position", { ascending: true }),
      supabase
        .from("task_template_assignees")
        .select("task_template_id,user_id")
        .order("created_at", { ascending: true }),
      supabase
        .from("task_template_subtask_assignees")
        .select("task_template_subtask_id,user_id")
        .order("created_at", { ascending: true }),
    ]);

    taskTemplateSubtasksError = taskTemplateSubtasksResult.error;
    projectTemplateTasksError = projectTemplateTasksResult.error;
    taskTemplateAssigneesError = taskTemplateAssigneesResult.error;
    taskTemplateSubtaskAssigneesError = taskTemplateSubtaskAssigneesResult.error;
    taskTemplateSubtasks = (taskTemplateSubtasksResult.error
      ? []
      : taskTemplateSubtasksResult.data || []) as TaskTemplateSubtaskRow[];
    projectTemplateTasks = (projectTemplateTasksResult.error
      ? []
      : projectTemplateTasksResult.data || []) as ProjectTemplateTaskRow[];
    taskTemplateAssignees = (taskTemplateAssigneesResult.error
      ? []
      : taskTemplateAssigneesResult.data || []) as TaskTemplateAssigneeRow[];
    taskTemplateSubtaskAssignees = (taskTemplateSubtaskAssigneesResult.error
      ? []
      : taskTemplateSubtaskAssigneesResult.data || []) as TaskTemplateSubtaskAssigneeRow[];
  }

  const {
    selectedTaskTemplateCustomFields,
    selectedProjectTemplateCustomFields,
    templateCustomFieldOptionsByFieldId,
    templateCustomFieldValueByFieldId,
  } = buildSettingsTemplateCustomFieldSummary({
    templateCustomFields,
    templateCustomFieldOptions,
    templateCustomFieldValues,
    selectedTaskTemplateId: selectedTaskTemplate?.id,
    selectedProjectTemplateId: selectedProjectTemplate?.id,
  });

  const {
    subtasksByTemplateId,
    tasksByProjectTemplateId,
    assigneeIdsByTaskTemplateSubtaskId,
    taskTemplateById,
    projectTemplateById,
    selectedTaskTemplateAssigneeIds,
    selectedTaskTemplateProjectLinks,
    availableProjectTemplatesForTaskTemplate,
  } = buildSettingsTemplateRelationshipSummary({
    taskTemplates,
    projectTemplates,
    taskTemplateSubtasks,
    projectTemplateTasks,
    taskTemplateAssignees,
    taskTemplateSubtaskAssignees,
    selectedTaskTemplateId: selectedTaskTemplate?.id,
  });

  async function updateProfile(formData: FormData) {
    "use server";
    const supabase = createSupabaseServerClient();
    const user = await getCurrentRequestUser(supabase, "settings.update_profile.auth");
    if (!user) redirect("/login");

    const fullName = String(formData.get("full_name") || "").trim();
    const removeAvatar = checkbox(formData, "remove_avatar");
    const avatarFileRaw = formData.get("avatar_file");
    const avatarFile =
      avatarFileRaw instanceof File && avatarFileRaw.size > 0 ? avatarFileRaw : null;

    if (fullName.length < 2) {
      redirect("/settings?error=Name%20is%20too%20short");
    }
    if (fullName.length > 80) {
      redirect("/settings?error=Name%20is%20too%20long");
    }

    const avatarValidation = avatarFile
      ? validateUploadImageFile(avatarFile, { maxSizeBytes: MAX_AVATAR_SIZE_BYTES })
      : null;
    if (avatarValidation && !avatarValidation.ok) {
      redirect(`/settings?error=${encodeURIComponent(avatarValidation.error)}`);
    }

    const { data: currentProfile, error: currentProfileError } = await supabase
      .from("users")
      .select("avatar_url,avatar_storage_path")
      .eq("id", user.id)
      .maybeSingle();
    const avatarColumnsAvailable = !isSupabaseMissingColumnError(currentProfileError);
    if (currentProfileError && avatarColumnsAvailable) {
      redirect(`/settings?error=${encodeURIComponent(currentProfileError.message)}`);
    }

    if (!avatarColumnsAvailable && (avatarFile || removeAvatar)) {
      redirect(
        "/settings?error=Profile%20photo%20is%20not%20available%20yet.%20Run%20the%20latest%20database%20migration."
      );
    }

    const currentAvatarStoragePath = String(currentProfile?.avatar_storage_path || "").trim();
    let nextAvatarUrl = String(currentProfile?.avatar_url || "").trim() || null;
    let nextAvatarStoragePath = currentAvatarStoragePath || null;

    if (avatarFile) {
      if (!avatarValidation?.ok) {
        redirect("/settings?error=Profile%20photo%20must%20be%20PNG%2C%20JPEG%2C%20WebP%2C%20GIF%2C%20or%20AVIF");
      }
      const extension = avatarValidation.extension;
      const storagePath = `${user.id}/${Date.now()}-${randomBytes(5).toString("hex")}.${extension}`;
      const arrayBuffer = await avatarFile.arrayBuffer();
      const { error: uploadError } = await supabase.storage
        .from(USER_AVATARS_BUCKET)
        .upload(storagePath, arrayBuffer, {
          contentType: avatarValidation.mimeType,
          upsert: false,
        });
      if (uploadError) {
        redirect(`/settings?error=${encodeURIComponent(uploadError.message)}`);
      }

      const { data: publicUrlData } = supabase.storage
        .from(USER_AVATARS_BUCKET)
        .getPublicUrl(storagePath);
      const publicUrl = String(publicUrlData.publicUrl || "").trim();
      if (!publicUrl) {
        redirect("/settings?error=Could%20not%20create%20profile%20photo%20URL");
      }

      nextAvatarUrl = publicUrl;
      nextAvatarStoragePath = storagePath;
    } else if (removeAvatar) {
      nextAvatarUrl = null;
      nextAvatarStoragePath = null;
    }

    const profileUpdatePayload = avatarColumnsAvailable
      ? {
          full_name: fullName,
          avatar_url: nextAvatarUrl,
          avatar_storage_path: nextAvatarStoragePath,
        }
      : {
          full_name: fullName,
        };
    const { error } = await supabase
      .from("users")
      .update(profileUpdatePayload)
      .eq("id", user.id);

    if (error) {
      redirect(`/settings?error=${encodeURIComponent(error.message)}`);
    }

    const shouldDeleteOldAvatar =
      avatarColumnsAvailable &&
      Boolean(currentAvatarStoragePath) && currentAvatarStoragePath !== (nextAvatarStoragePath || "");
    if (shouldDeleteOldAvatar) {
      await supabase.storage.from(USER_AVATARS_BUCKET).remove([currentAvatarStoragePath]);
    }

    revalidatePath("/settings");
    revalidatePath("/dashboard");
    revalidatePath("/chat");
    revalidatePath("/social");
    redirect("/settings?success=Profile%20updated");
  }

  async function updateNotificationPrefs(formData: FormData) {
    "use server";
    const supabase = createSupabaseServerClient();
    const user = await getCurrentRequestUser(
      supabase,
      "settings.update_notification_prefs.auth"
    );
    if (!user) redirect("/login");

    const next = buildSettingsNotificationPrefsUpdate(user.id, formData);

    let { error } = await supabase
      .from("user_notification_preferences")
      .upsert(next, { onConflict: "user_id" });
    if (error && isSupabaseMissingColumnError(error)) {
      const retry = await supabase
        .from("user_notification_preferences")
        .upsert(buildSettingsLegacyNotificationPrefsUpdate(next), { onConflict: "user_id" });
      error = retry.error;
    }

    if (error) {
      redirect(
        `/settings?tab=notifications&error=${encodeURIComponent(error.message)}`
      );
    }

    revalidatePath("/settings");
    redirect("/settings?tab=notifications&success=Preferences%20saved");
  }

  async function createTaskTemplate(formData: FormData) {
    "use server";
    const supabase = createSupabaseServerClient();
    const editAccess = await getPageEditAccess(
      supabase,
      "settings",
      "settings.task_templates.create.auth"
    );
    if (!editAccess.ok && editAccess.reason === "unauthenticated") redirect("/login");
    if (!editAccess.ok) {
      redirect(
        `/settings?tab=templates&templates=tasks&error=${encodeURIComponent(
          SETTINGS_EDIT_PERMISSION_MESSAGE
        )}`
      );
    }

    const name = String(formData.get("name") || "").trim();
    const title = String(formData.get("title") || "").trim();
    const description = String(formData.get("description") || "").trim();
    const status = String(formData.get("status") || "to_do").trim();
    const priority = String(formData.get("priority") || "medium").trim();
    const dueTime = String(formData.get("due_time") || "").trim();
    const assigneeResolution = await resolveAssignmentTargetsToUserIds(
      supabase,
      formData.getAll("assignee_user_ids")
    );
    if (assigneeResolution.error) {
      redirect(
        `/settings?tab=templates&templates=tasks&error=${encodeURIComponent(
          assigneeResolution.error
        )}`
      );
    }
    const assigneeIds = assigneeResolution.userIds.filter((value) => isUuid(value));

    if (!name || !title) {
      redirect("/settings?tab=templates&error=Template%20name%20and%20task%20title%20are%20required");
    }

    const { data: created, error } = await supabase
      .from("task_templates")
      .insert({
        name,
        title,
        description: description || null,
        status,
        priority,
        due_time: dueTime || null,
        recurrence_frequency: null,
        recurrence_lead_days: 7,
        created_by: editAccess.user.id,
      })
      .select("id")
      .single();

    if (error) {
      redirect(
        `/settings?tab=templates&templates=tasks&error=${encodeURIComponent(error.message)}`
      );
    }

    if (created?.id) {
      let { error: templateTaskError } = await supabase
        .from("tasks")
        .insert({
          id: created.id,
          title,
          description: description || null,
          status: "template",
          priority,
          due_time: dueTime || null,
          assignee_user_id: assigneeIds[0] || null,
          created_by_user_id: editAccess.user.id,
          content: DEFAULT_EDITOR_CONTENT,
          content_text: defaultContentText,
        });
      if (
        templateTaskError &&
        String(templateTaskError.message || "")
          .toLowerCase()
          .includes("invalid input value for enum task_status")
      ) {
        const retry = await supabase.from("tasks").insert({
          id: created.id,
          title,
          description: description || null,
          status,
          priority,
          due_time: dueTime || null,
          assignee_user_id: assigneeIds[0] || null,
          created_by_user_id: editAccess.user.id,
          content: DEFAULT_EDITOR_CONTENT,
          content_text: defaultContentText,
        });
        templateTaskError = retry.error;
      }
      if (templateTaskError) {
        redirect(
          `/settings?tab=templates&templates=tasks&error=${encodeURIComponent(
            formatDbError("settings.createTaskTemplate.tasks.insert", templateTaskError)
          )}`
        );
      }
    }

    if (created?.id && assigneeIds.length) {
      const { error: assigneeError } = await supabase
        .from("task_template_assignees")
        .insert(
          assigneeIds.map((userId) => ({
            task_template_id: created.id,
            user_id: userId,
          }))
        );

      if (assigneeError) {
        const message = isSupabaseMissingTableError(assigneeError)
          ? "Run sql/templates.sql to enable template assignees."
          : assigneeError.message;
        redirect(
          `/settings?tab=templates&templates=tasks&task_template_id=${encodeURIComponent(
            created.id
          )}&error=${encodeURIComponent(message)}`
        );
      }

      const { error: taskAssigneeError } = await supabase.from("task_assignees").insert(
        assigneeIds.map((userId) => ({
          task_id: created.id,
          user_id: userId,
        }))
      );
      if (taskAssigneeError) {
        redirect(
          `/settings?tab=templates&templates=tasks&task_template_id=${encodeURIComponent(
            created.id
          )}&error=${encodeURIComponent(taskAssigneeError.message)}`
        );
      }
    }

    revalidatePath("/settings");
    const nextId = created?.id ? `&task_template_id=${encodeURIComponent(created.id)}` : "";
    redirect(
      `/settings?tab=templates&templates=tasks${nextId}&success=Task%20template%20created`
    );
  }

  async function updateTaskTemplate(formData: FormData) {
    "use server";
    const supabase = createSupabaseServerClient();
    const editAccess = await getPageEditAccess(
      supabase,
      "settings",
      "settings.task_templates.update.auth"
    );
    if (!editAccess.ok && editAccess.reason === "unauthenticated") redirect("/login");
    if (!editAccess.ok) {
      redirect(
        `/settings?tab=templates&templates=tasks&error=${encodeURIComponent(
          SETTINGS_EDIT_PERMISSION_MESSAGE
        )}`
      );
    }

    const id = String(formData.get("id") || "").trim();
    const name = String(formData.get("name") || "").trim();
    const title = String(formData.get("title") || "").trim();
    const description = String(formData.get("description") || "").trim();
    const status = String(formData.get("status") || "to_do").trim();
    const priority = String(formData.get("priority") || "medium").trim();
    const dueTime = String(formData.get("due_time") || "").trim();
    const assigneeResolution = await resolveAssignmentTargetsToUserIds(
      supabase,
      formData.getAll("assignee_user_ids")
    );
    if (assigneeResolution.error) {
      redirect(
        `/settings?tab=templates&templates=tasks&task_template_id=${encodeURIComponent(
          id
        )}${taskTemplatePanelQuery}&error=${encodeURIComponent(assigneeResolution.error)}`
      );
    }
    const assigneeIds = assigneeResolution.userIds.filter((value) => isUuid(value));

    if (!id) {
      redirect("/settings?tab=templates&templates=tasks&error=Missing%20template%20id");
    }
    const taskTemplateReturnUrl = (message: SettingsUrlMessage) =>
      buildSettingsTaskTemplateUrl({
        taskTemplateId: id,
        taskTemplatePanelQuery,
        message,
      });

    const { error } = await supabase
      .from("task_templates")
      .update({
        name,
        title,
        description: description || null,
        status,
        priority,
        due_time: dueTime || null,
        recurrence_frequency: null,
        recurrence_lead_days: 7,
      })
      .eq("id", id);

    if (error) {
      redirect(
        taskTemplateReturnUrl({ kind: "error", value: error.message })
      );
    }

    let { error: templateTaskError } = await supabase
      .from("tasks")
      .update({
        title,
        description: description || null,
        status: "template",
        priority,
        due_time: dueTime || null,
        assignee_user_id: assigneeIds[0] || null,
      })
      .eq("id", id);
    if (
      templateTaskError &&
      String(templateTaskError.message || "")
        .toLowerCase()
        .includes("invalid input value for enum task_status")
    ) {
      const retry = await supabase
        .from("tasks")
        .update({
          title,
          description: description || null,
          status,
          priority,
          due_time: dueTime || null,
          assignee_user_id: assigneeIds[0] || null,
        })
        .eq("id", id);
      templateTaskError = retry.error;
    }
    if (templateTaskError) {
      redirect(
        taskTemplateReturnUrl({
          kind: "error",
          value: formatDbError("settings.updateTaskTemplate.tasks.update", templateTaskError),
        })
      );
    }

    const { error: clearAssigneesError } = await supabase
      .from("task_template_assignees")
      .delete()
      .eq("task_template_id", id);
    if (clearAssigneesError) {
      const message = isSupabaseMissingTableError(clearAssigneesError)
        ? "Run sql/templates.sql to enable template assignees."
        : clearAssigneesError.message;
      redirect(
        taskTemplateReturnUrl({ kind: "error", value: message })
      );
    }

    const { error: clearTaskAssigneesError } = await supabase
      .from("task_assignees")
      .delete()
      .eq("task_id", id);
    if (clearTaskAssigneesError) {
      redirect(
        taskTemplateReturnUrl({
          kind: "error",
          value: clearTaskAssigneesError.message,
        })
      );
    }

    if (assigneeIds.length) {
      const { error: assigneeError } = await supabase
        .from("task_template_assignees")
        .insert(
          assigneeIds.map((userId) => ({
            task_template_id: id,
            user_id: userId,
          }))
        );

      if (assigneeError) {
        const message = isSupabaseMissingTableError(assigneeError)
          ? "Run sql/templates.sql to enable template assignees."
          : assigneeError.message;
        redirect(
          taskTemplateReturnUrl({ kind: "error", value: message })
        );
      }

      const { error: taskAssigneeError } = await supabase.from("task_assignees").insert(
        assigneeIds.map((userId) => ({
          task_id: id,
          user_id: userId,
        }))
      );
      if (taskAssigneeError) {
        redirect(
          taskTemplateReturnUrl({
            kind: "error",
            value: taskAssigneeError.message,
          })
        );
      }
    }

    revalidatePath("/settings");
    redirect(
      taskTemplateReturnUrl({ kind: "success", value: "Task template updated" })
    );
  }

  async function deleteTaskTemplate(formData: FormData) {
    "use server";
    const supabase = createSupabaseServerClient();
    const editAccess = await getPageEditAccess(
      supabase,
      "settings",
      "settings.task_templates.delete.auth"
    );
    if (!editAccess.ok && editAccess.reason === "unauthenticated") redirect("/login");
    if (!editAccess.ok) {
      redirect(
        `/settings?tab=templates&templates=tasks&error=${encodeURIComponent(
          SETTINGS_EDIT_PERMISSION_MESSAGE
        )}`
      );
    }

    const id = String(formData.get("id") || "").trim();
    if (!id) {
      redirect("/settings?tab=templates&templates=tasks&error=Missing%20template%20id");
    }

    const { error: deleteSubtasksError } = await supabase
      .from("tasks")
      .delete()
      .eq("parent_task_id", id);
    if (deleteSubtasksError) {
      redirect(
        `/settings?tab=templates&templates=tasks&error=${encodeURIComponent(
          deleteSubtasksError.message
        )}`
      );
    }

    const { error: deleteTemplateTaskError } = await supabase.from("tasks").delete().eq("id", id);
    if (deleteTemplateTaskError) {
      redirect(
        `/settings?tab=templates&templates=tasks&error=${encodeURIComponent(
          deleteTemplateTaskError.message
        )}`
      );
    }

    const { error } = await supabase.from("task_templates").delete().eq("id", id);

    if (error) {
      redirect(
        `/settings?tab=templates&templates=tasks&error=${encodeURIComponent(error.message)}`
      );
    }

    revalidatePath("/settings");
    redirect("/settings?tab=templates&templates=tasks&success=Task%20template%20deleted");
  }

  async function createProjectTemplate(formData: FormData) {
    "use server";
    const supabase = createSupabaseServerClient();
    const editAccess = await getPageEditAccess(
      supabase,
      "settings",
      "settings.project_templates.create.auth"
    );
    if (!editAccess.ok && editAccess.reason === "unauthenticated") redirect("/login");
    if (!editAccess.ok) {
      redirect(
        `/settings?tab=templates&templates=projects&error=${encodeURIComponent(
          SETTINGS_EDIT_PERMISSION_MESSAGE
        )}`
      );
    }

    const name = String(formData.get("name") || "").trim();
    const description = String(formData.get("description") || "").trim();
    const status = String(formData.get("status") || "planned").trim();

    if (!name) {
      redirect("/settings?tab=templates&templates=projects&error=Template%20name%20is%20required");
    }

    const { data: created, error } = await supabase
      .from("project_templates")
      .insert({
        name,
        description: description || null,
        status,
        created_by: editAccess.user.id,
      })
      .select("id")
      .single();

    if (error) {
      redirect(
        `/settings?tab=templates&templates=projects&error=${encodeURIComponent(error.message)}`
      );
    }

    revalidatePath("/settings");
    const nextId = created?.id ? `&project_template_id=${encodeURIComponent(created.id)}` : "";
    redirect(
      `/settings?tab=templates&templates=projects${nextId}&success=Project%20template%20created`
    );
  }

  async function updateProjectTemplate(formData: FormData) {
    "use server";
    const supabase = createSupabaseServerClient();
    const editAccess = await getPageEditAccess(
      supabase,
      "settings",
      "settings.project_templates.update.auth"
    );
    if (!editAccess.ok && editAccess.reason === "unauthenticated") redirect("/login");
    if (!editAccess.ok) {
      redirect(
        `/settings?tab=templates&templates=projects&error=${encodeURIComponent(
          SETTINGS_EDIT_PERMISSION_MESSAGE
        )}`
      );
    }

    const id = String(formData.get("id") || "").trim();
    const name = String(formData.get("name") || "").trim();
    const description = String(formData.get("description") || "").trim();
    const status = String(formData.get("status") || "planned").trim();

    if (!id) {
      redirect("/settings?tab=templates&templates=projects&error=Missing%20template%20id");
    }
    const projectTemplateReturnUrl = (message: SettingsUrlMessage) =>
      buildSettingsProjectTemplateUrl({
        projectTemplateId: id,
        projectTemplatePanelQuery,
        message,
      });

    const { error } = await supabase
      .from("project_templates")
      .update({
        name,
        description: description || null,
        status,
      })
      .eq("id", id);

    if (error) {
      redirect(
        projectTemplateReturnUrl({ kind: "error", value: error.message })
      );
    }

    revalidatePath("/settings");
    redirect(
      projectTemplateReturnUrl({ kind: "success", value: "Project template updated" })
    );
  }

  async function deleteProjectTemplate(formData: FormData) {
    "use server";
    const supabase = createSupabaseServerClient();
    const editAccess = await getPageEditAccess(
      supabase,
      "settings",
      "settings.project_templates.delete.auth"
    );
    if (!editAccess.ok && editAccess.reason === "unauthenticated") redirect("/login");
    if (!editAccess.ok) {
      redirect(
        `/settings?tab=templates&templates=projects&error=${encodeURIComponent(
          SETTINGS_EDIT_PERMISSION_MESSAGE
        )}`
      );
    }

    const id = String(formData.get("id") || "").trim();
    if (!id) {
      redirect("/settings?tab=templates&templates=projects&error=Missing%20template%20id");
    }

    const { error } = await supabase.from("project_templates").delete().eq("id", id);

    if (error) {
      redirect(
        `/settings?tab=templates&templates=projects&error=${encodeURIComponent(error.message)}`
      );
    }

    revalidatePath("/settings");
    redirect("/settings?tab=templates&templates=projects&success=Project%20template%20deleted");
  }

  async function createTemplateCustomField(formData: FormData) {
    "use server";
    const supabase = createSupabaseServerClient();
    const editAccess = await getPageEditAccess(
      supabase,
      "settings",
      "settings.template_custom_fields.create.auth"
    );
    if (!editAccess.ok && editAccess.reason === "unauthenticated") redirect("/login");
    if (!editAccess.ok) {
      redirect(
        `/settings?tab=templates&error=${encodeURIComponent(SETTINGS_EDIT_PERMISSION_MESSAGE)}`
      );
    }

    const entityType = String(formData.get("entity_type") || "").trim();
    const entityId = String(formData.get("entity_id") || "").trim();
    const label = String(formData.get("label") || "").trim();
    const fieldKind = normalizeCustomFieldKind(
      String(formData.get("field_kind") || "").trim().toLowerCase()
    );
    const optionsCsv = String(formData.get("options_csv") || "").trim();

    if (
      !entityId ||
      (entityType !== "task_template" && entityType !== "project_template")
    ) {
      redirect("/settings?tab=templates&error=Invalid%20template%20custom%20field%20request");
    }
    if (!label) {
      redirect("/settings?tab=templates&error=Custom%20field%20label%20is%20required");
    }
    const customFieldReturnUrl = (message: SettingsUrlMessage) =>
      buildSettingsTemplateEntityUrl({
        entityType,
        entityId,
        taskTemplatePanelQuery,
        projectTemplatePanelQuery,
        message,
      });

    const siblingFields = templateCustomFields.filter(
      (field) => field.entity_type === entityType && field.entity_id === entityId
    );
    const existingKeys = new Set(siblingFields.map((field) => field.key));
    const keyBase = toCustomFieldKey(label);
    let key = keyBase;
    let suffix = 2;
    while (existingKeys.has(key)) {
      key = `${keyBase}_${suffix}`;
      suffix += 1;
    }
    const nextPosition =
      (siblingFields.reduce(
        (max, field) => (field.position > max ? field.position : max),
        0
      ) || 0) + 1;

    const { data: createdField, error } = await supabase
      .from("custom_fields")
      .insert({
        entity_type: entityType,
        entity_id: entityId,
        key,
        label,
        field_kind: fieldKind,
        position: nextPosition,
      })
      .select("id")
      .single();

    if (error) {
      redirect(customFieldReturnUrl({ kind: "error", value: error.message }));
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
          redirect(
            customFieldReturnUrl({ kind: "error", value: optionsError.message })
          );
        }
      }
    }

    revalidatePath("/settings");
    redirect(customFieldReturnUrl({ kind: "success", value: "Custom field added" }));
  }

  async function deleteTemplateCustomField(formData: FormData) {
    "use server";
    const supabase = createSupabaseServerClient();
    const editAccess = await getPageEditAccess(
      supabase,
      "settings",
      "settings.template_custom_fields.delete.auth"
    );
    if (!editAccess.ok && editAccess.reason === "unauthenticated") redirect("/login");
    if (!editAccess.ok) {
      redirect(
        `/settings?tab=templates&error=${encodeURIComponent(SETTINGS_EDIT_PERMISSION_MESSAGE)}`
      );
    }

    const id = String(formData.get("id") || "").trim();
    const entityType = String(formData.get("entity_type") || "").trim();
    const entityId = String(formData.get("entity_id") || "").trim();
    if (!id || !entityId) {
      redirect("/settings?tab=templates&error=Missing%20custom%20field%20id");
    }

    const { error } = await supabase
      .from("custom_fields")
      .delete()
      .eq("id", id)
      .eq("entity_type", entityType)
      .eq("entity_id", entityId);
    if (error) {
      redirect(`/settings?tab=templates&error=${encodeURIComponent(error.message)}`);
    }

    revalidatePath("/settings");
    redirect(
      buildSettingsTemplateEntityUrl({
        entityType,
        entityId,
        taskTemplatePanelQuery,
        projectTemplatePanelQuery,
        message: { kind: "success", value: "Custom field deleted" },
      })
    );
  }

  async function saveTemplateCustomFieldValues(formData: FormData) {
    "use server";
    const supabase = createSupabaseServerClient();
    const editAccess = await getPageEditAccess(
      supabase,
      "settings",
      "settings.template_custom_field_values.save.auth"
    );
    if (!editAccess.ok && editAccess.reason === "unauthenticated") redirect("/login");
    if (!editAccess.ok) {
      redirect(
        `/settings?tab=templates&error=${encodeURIComponent(SETTINGS_EDIT_PERMISSION_MESSAGE)}`
      );
    }

    const entityType = String(formData.get("entity_type") || "").trim();
    const entityId = String(formData.get("entity_id") || "").trim();
    if (
      !entityId ||
      (entityType !== "task_template" && entityType !== "project_template")
    ) {
      redirect("/settings?tab=templates&error=Invalid%20template%20custom%20field%20save");
    }
    const customFieldReturnUrl = (message: SettingsUrlMessage) =>
      buildSettingsTemplateEntityUrl({
        entityType,
        entityId,
        taskTemplatePanelQuery,
        projectTemplatePanelQuery,
        message,
      });

    const fields = templateCustomFields.filter(
      (field) => field.entity_type === entityType && field.entity_id === entityId
    );
    const clears: string[] = [];
    const upserts: Array<{
      entity_type: string;
      entity_id: string;
      field_id: string;
      text_value: string | null;
      option_value: string | null;
    }> = [];

    for (const field of fields) {
      const value = String(formData.get(`cf_${field.id}`) || "").trim();
      if (!value) {
        clears.push(field.id);
        continue;
      }
      if (field.field_kind === "dropdown") {
        const allowed = (templateCustomFieldOptionsByFieldId[field.id] || []).some(
          (option) => option.value === value
        );
        if (!allowed) {
          redirect(
            customFieldReturnUrl({
              kind: "error",
              value: `Invalid value for ${field.label}`,
            })
          );
        }
      }
      upserts.push({
        entity_type: entityType,
        entity_id: entityId,
        field_id: field.id,
        text_value: field.field_kind === "text" ? value : null,
        option_value: field.field_kind === "dropdown" ? value : null,
      });
    }

    if (clears.length) {
      const { error: clearError } = await supabase
        .from("custom_field_values")
        .delete()
        .eq("entity_type", entityType)
        .eq("entity_id", entityId)
        .in("field_id", clears);
      if (clearError) {
        redirect(
          customFieldReturnUrl({ kind: "error", value: clearError.message })
        );
      }
    }

    if (upserts.length) {
      const { error: upsertError } = await supabase.from("custom_field_values").upsert(
        upserts,
        { onConflict: "entity_type,entity_id,field_id" }
      );
      if (upsertError) {
        redirect(
          customFieldReturnUrl({ kind: "error", value: upsertError.message })
        );
      }
    }

    revalidatePath("/settings");
    redirect(
      customFieldReturnUrl({
        kind: "success",
        value: "Template custom fields saved",
      })
    );
  }

  async function createTaskTemplateSubtask(formData: FormData) {
    "use server";
    const supabase = createSupabaseServerClient();
    const editAccess = await getPageEditAccess(
      supabase,
      "settings",
      "settings.task_template_subtasks.create.auth"
    );
    if (!editAccess.ok && editAccess.reason === "unauthenticated") redirect("/login");
    if (!editAccess.ok) {
      redirect(
        `/settings?tab=templates&templates=tasks&error=${encodeURIComponent(
          SETTINGS_EDIT_PERMISSION_MESSAGE
        )}`
      );
    }

    const taskTemplateId = String(formData.get("task_template_id") || "").trim();
    const title = String(formData.get("title") || "").trim();
    const description = String(formData.get("description") || "").trim();
    const status = String(formData.get("status") || "to_do").trim();
    const priority = String(formData.get("priority") || "medium").trim();
    const assigneeResolution = await resolveAssignmentTargetsToUserIds(
      supabase,
      formData.getAll("assignee_user_ids")
    );
    if (assigneeResolution.error) {
      redirect(
        `/settings?tab=templates&templates=tasks&task_template_id=${encodeURIComponent(
          taskTemplateId || selectedTaskTemplateId
        )}${taskTemplatePanelQuery}&error=${encodeURIComponent(assigneeResolution.error)}`
      );
    }
    const assigneeIds = assigneeResolution.userIds.filter((value) => isUuid(value));

    if (!taskTemplateId || !title) {
      redirect(
        "/settings?tab=templates&templates=tasks&error=Template%20and%20subtask%20title%20are%20required"
      );
    }
    const subtaskReturnUrl = (message: SettingsUrlMessage) =>
      buildSettingsTaskTemplateUrl({
        taskTemplateId,
        taskTemplatePanelQuery,
        message,
      });

    const { data: last } = await supabase
      .from("task_template_subtasks")
      .select("position")
      .eq("task_template_id", taskTemplateId)
      .order("position", { ascending: false })
      .limit(1)
      .maybeSingle();

    const nextPosition = (Number(last?.position) || 0) + 1;

    const { data: createdSubtask, error } = await supabase
      .from("task_template_subtasks")
      .insert({
        task_template_id: taskTemplateId,
        position: nextPosition,
        title,
        description: description || null,
        status,
        priority,
      })
      .select("id")
      .single();

    if (error) {
      const hint = isSupabaseMissingTableError(error)
        ? " Run `sql/templates.sql` in Supabase SQL editor, then refresh."
        : "";
      redirect(
        subtaskReturnUrl({ kind: "error", value: `${error.message}${hint}` })
      );
    }

    if (createdSubtask?.id) {
      const { error: createSubtaskTaskError } = await supabase
        .from("tasks")
        .insert({
          id: createdSubtask.id,
          parent_task_id: taskTemplateId,
          title,
          description: description || null,
          status,
          priority,
          assignee_user_id: assigneeIds[0] || null,
          created_by_user_id: editAccess.user.id,
          content: DEFAULT_EDITOR_CONTENT,
          content_text: defaultContentText,
        });
      if (createSubtaskTaskError) {
        redirect(
          subtaskReturnUrl({
            kind: "error",
            value: formatDbError(
              "settings.addTaskTemplateSubtask.tasks.insert",
              createSubtaskTaskError
            ),
          })
        );
      }
    }

    if (createdSubtask?.id && assigneeIds.length) {
      const { error: assigneeError } = await supabase
        .from("task_template_subtask_assignees")
        .insert(
          assigneeIds.map((userId) => ({
            task_template_subtask_id: createdSubtask.id,
            user_id: userId,
          }))
        );
      if (assigneeError) {
        const message = isSupabaseMissingTableError(assigneeError)
          ? "Run sql/templates.sql to enable subtask template assignees."
          : assigneeError.message;
        redirect(
          subtaskReturnUrl({ kind: "error", value: message })
        );
      }

      const { error: taskAssigneeError } = await supabase.from("task_assignees").insert(
        assigneeIds.map((userId) => ({
          task_id: createdSubtask.id,
          user_id: userId,
        }))
      );
      if (taskAssigneeError) {
        redirect(
          subtaskReturnUrl({ kind: "error", value: taskAssigneeError.message })
        );
      }
    }

    revalidatePath("/settings");
    redirect(subtaskReturnUrl({ kind: "success", value: "Subtask added" }));
  }

  async function deleteTaskTemplateSubtask(formData: FormData) {
    "use server";
    const supabase = createSupabaseServerClient();
    const editAccess = await getPageEditAccess(
      supabase,
      "settings",
      "settings.task_template_subtasks.delete.auth"
    );
    if (!editAccess.ok && editAccess.reason === "unauthenticated") redirect("/login");
    if (!editAccess.ok) {
      redirect(
        `/settings?tab=templates&templates=tasks&error=${encodeURIComponent(
          SETTINGS_EDIT_PERMISSION_MESSAGE
        )}`
      );
    }

    const id = String(formData.get("id") || "").trim();
    const taskTemplateId = String(formData.get("task_template_id") || "").trim();
    if (!id) {
      redirect("/settings?tab=templates&templates=tasks&error=Missing%20subtask%20id");
    }

    const { error } = await supabase.from("task_template_subtasks").delete().eq("id", id);

    if (error) {
      redirect(
        `/settings?tab=templates&templates=tasks&error=${encodeURIComponent(error.message)}`
      );
    }

    const { error: deleteSubtaskTaskError } = await supabase.from("tasks").delete().eq("id", id);
    if (deleteSubtaskTaskError) {
      redirect(
        `/settings?tab=templates&templates=tasks&error=${encodeURIComponent(
          deleteSubtaskTaskError.message
        )}`
      );
    }

    revalidatePath("/settings");
    redirect(
      buildSettingsTaskTemplateUrl({
        taskTemplateId,
        taskTemplatePanelQuery,
        message: { kind: "success", value: "Subtask deleted" },
      })
    );
  }

  async function updateTaskTemplateSubtask(formData: FormData) {
    "use server";
    const supabase = createSupabaseServerClient();
    const editAccess = await getPageEditAccess(
      supabase,
      "settings",
      "settings.task_template_subtasks.update.auth"
    );
    if (!editAccess.ok && editAccess.reason === "unauthenticated") redirect("/login");
    if (!editAccess.ok) {
      redirect(
        `/settings?tab=templates&templates=tasks&error=${encodeURIComponent(
          SETTINGS_EDIT_PERMISSION_MESSAGE
        )}`
      );
    }

    const id = String(formData.get("id") || "").trim();
    const taskTemplateId = String(formData.get("task_template_id") || "").trim();
    const title = String(formData.get("title") || "").trim();
    const description = String(formData.get("description") || "").trim();
    const status = String(formData.get("status") || "to_do").trim();
    const priority = String(formData.get("priority") || "medium").trim();
    const assigneeResolution = await resolveAssignmentTargetsToUserIds(
      supabase,
      formData.getAll("assignee_user_ids")
    );
    if (assigneeResolution.error) {
      redirect(
        `/settings?tab=templates&templates=tasks&task_template_id=${encodeURIComponent(
          taskTemplateId || selectedTaskTemplateId
        )}${taskTemplatePanelQuery}&error=${encodeURIComponent(assigneeResolution.error)}`
      );
    }
    const assigneeIds = assigneeResolution.userIds.filter((value) => isUuid(value));

    if (!id || !taskTemplateId || !title) {
      redirect(
        "/settings?tab=templates&templates=tasks&error=Subtask%20id,%20template%20id,%20and%20title%20are%20required"
      );
    }
    const subtaskReturnUrl = (message: SettingsUrlMessage) =>
      buildSettingsTaskTemplateUrl({
        taskTemplateId,
        taskTemplatePanelQuery,
        message,
      });

    const { error } = await supabase
      .from("task_template_subtasks")
      .update({
        title,
        description: description || null,
        status,
        priority,
      })
      .eq("id", id)
      .eq("task_template_id", taskTemplateId);

    if (error) {
      redirect(
        subtaskReturnUrl({ kind: "error", value: error.message })
      );
    }

    const { error: updateSubtaskTaskError } = await supabase
      .from("tasks")
      .update({
        title,
        description: description || null,
        status,
        priority,
        assignee_user_id: assigneeIds[0] || null,
      })
      .eq("id", id);
    if (updateSubtaskTaskError) {
      redirect(
        subtaskReturnUrl({
          kind: "error",
          value: formatDbError(
            "settings.updateTaskTemplateSubtask.tasks.update",
            updateSubtaskTaskError
          ),
        })
      );
    }

    const { error: clearAssigneesError } = await supabase
      .from("task_template_subtask_assignees")
      .delete()
      .eq("task_template_subtask_id", id);

    if (clearAssigneesError && !isSupabaseMissingTableError(clearAssigneesError)) {
      redirect(
        subtaskReturnUrl({ kind: "error", value: clearAssigneesError.message })
      );
    }

    const { error: clearTaskAssigneesError } = await supabase
      .from("task_assignees")
      .delete()
      .eq("task_id", id);
    if (clearTaskAssigneesError) {
      redirect(
        subtaskReturnUrl({
          kind: "error",
          value: clearTaskAssigneesError.message,
        })
      );
    }

    if (assigneeIds.length) {
      if (clearAssigneesError && isSupabaseMissingTableError(clearAssigneesError)) {
        redirect(
          subtaskReturnUrl({
            kind: "error",
            value: "Run sql/templates.sql to enable subtask template assignees.",
          })
        );
      }

      const { error: assigneeError } = await supabase
        .from("task_template_subtask_assignees")
        .insert(
          assigneeIds.map((userId) => ({
            task_template_subtask_id: id,
            user_id: userId,
          }))
        );
      if (assigneeError) {
        const message = isSupabaseMissingTableError(assigneeError)
          ? "Run sql/templates.sql to enable subtask template assignees."
          : assigneeError.message;
        redirect(
          subtaskReturnUrl({ kind: "error", value: message })
        );
      }

      const { error: taskAssigneeError } = await supabase.from("task_assignees").insert(
        assigneeIds.map((userId) => ({
          task_id: id,
          user_id: userId,
        }))
      );
      if (taskAssigneeError) {
        redirect(
          subtaskReturnUrl({ kind: "error", value: taskAssigneeError.message })
        );
      }
    }

    revalidatePath("/settings");
    redirect(subtaskReturnUrl({ kind: "success", value: "Subtask updated" }));
  }

  async function addProjectTemplateTask(formData: FormData) {
    "use server";
    const supabase = createSupabaseServerClient();
    const editAccess = await getPageEditAccess(
      supabase,
      "settings",
      "settings.project_template_tasks.add.auth"
    );
    if (!editAccess.ok && editAccess.reason === "unauthenticated") redirect("/login");
    if (!editAccess.ok) {
      redirect(
        `/settings?tab=templates&error=${encodeURIComponent(SETTINGS_EDIT_PERMISSION_MESSAGE)}`
      );
    }

    const projectTemplateId = String(formData.get("project_template_id") || "").trim();
    const taskTemplateId = String(formData.get("task_template_id") || "").trim();
    const returnTemplatesTab =
      String(formData.get("return_templates_tab") || "").trim().toLowerCase() === "tasks"
        ? "tasks"
        : "projects";
    const returnTaskTemplateId = String(formData.get("return_task_template_id") || "").trim();
    const projectTaskReturnUrl = (
      message: SettingsUrlMessage,
      options?: { includeProjectContext?: boolean }
    ) =>
      buildSettingsProjectTemplateTaskReturnUrl({
        returnTemplatesTab,
        returnTaskTemplateId,
        projectTemplateId,
        taskTemplatePanelQuery,
        projectTemplatePanelQuery,
        includeProjectContext: options?.includeProjectContext,
        message,
      });

    if (!projectTemplateId || !taskTemplateId) {
      redirect(
        projectTaskReturnUrl(
          {
            kind: "error",
            value: "Project template and task template are required",
          },
          { includeProjectContext: false }
        )
      );
    }

    const { data: last } = await supabase
      .from("project_template_tasks")
      .select("position")
      .eq("project_template_id", projectTemplateId)
      .order("position", { ascending: false })
      .limit(1)
      .maybeSingle();

    const nextPosition = (Number(last?.position) || 0) + 1;

    const { error } = await supabase.from("project_template_tasks").insert({
      project_template_id: projectTemplateId,
      task_template_id: taskTemplateId,
      position: nextPosition,
    });

    if (error) {
      const hint = isSupabaseMissingTableError(error)
        ? " Run `sql/templates.sql` in Supabase SQL editor, then refresh."
        : "";
      redirect(
        projectTaskReturnUrl({ kind: "error", value: `${error.message}${hint}` })
      );
    }

    revalidatePath("/settings");
    redirect(
      projectTaskReturnUrl({
        kind: "success",
        value:
          returnTemplatesTab === "tasks"
            ? "Project template linked"
            : "Task added to project template",
      })
    );
  }

  async function removeProjectTemplateTask(formData: FormData) {
    "use server";
    const supabase = createSupabaseServerClient();
    const editAccess = await getPageEditAccess(
      supabase,
      "settings",
      "settings.project_template_tasks.remove.auth"
    );
    if (!editAccess.ok && editAccess.reason === "unauthenticated") redirect("/login");
    if (!editAccess.ok) {
      redirect(
        `/settings?tab=templates&error=${encodeURIComponent(SETTINGS_EDIT_PERMISSION_MESSAGE)}`
      );
    }

    const id = String(formData.get("id") || "").trim();
    const projectTemplateId = String(formData.get("project_template_id") || "").trim();
    const returnTemplatesTab =
      String(formData.get("return_templates_tab") || "").trim().toLowerCase() === "tasks"
        ? "tasks"
        : "projects";
    const returnTaskTemplateId = String(formData.get("return_task_template_id") || "").trim();
    const projectTaskReturnUrl = (
      message: SettingsUrlMessage,
      options?: { includeProjectContext?: boolean }
    ) =>
      buildSettingsProjectTemplateTaskReturnUrl({
        returnTemplatesTab,
        returnTaskTemplateId,
        projectTemplateId,
        taskTemplatePanelQuery,
        projectTemplatePanelQuery,
        includeProjectContext: options?.includeProjectContext,
        message,
      });
    if (!id) {
      redirect(
        projectTaskReturnUrl(
          { kind: "error", value: "Missing link id" },
          { includeProjectContext: false }
        )
      );
    }

    const { error } = await supabase.from("project_template_tasks").delete().eq("id", id);

    if (error) {
      redirect(
        projectTaskReturnUrl(
          { kind: "error", value: error.message },
          { includeProjectContext: false }
        )
      );
    }

    revalidatePath("/settings");
    redirect(
      projectTaskReturnUrl({
        kind: "success",
        value:
          returnTemplatesTab === "tasks"
            ? "Project template unlinked"
            : "Task removed from project template",
      })
    );
  }

  async function createStatusOption(formData: FormData) {
    "use server";
    const supabase = createSupabaseServerClient();
    const editAccess = await getPageEditAccess(
      supabase,
      "settings",
      "settings.status_options.create.auth"
    );
    if (!editAccess.ok && editAccess.reason === "unauthenticated") redirect("/login");
    if (!editAccess.ok) {
      redirect(
        `/settings?tab=statuses&error=${encodeURIComponent(SETTINGS_EDIT_PERMISSION_MESSAGE)}`
      );
    }

    const { entityType, value, isVisible, countsAsCompleted, rawColorHex, colorHex } =
      buildSettingsStatusFormInput(formData);

    if (!value) {
      redirect("/settings?tab=statuses&error=Status%20is%20required");
    }
    if (rawColorHex && !colorHex) {
      redirect("/settings?tab=statuses&error=Color%20must%20be%20a%20hex%20value%20like%20%2300aaff");
    }
    if (entityType === "task" && !isSupportedTaskStatus(value)) {
      redirect(
        `/settings?tab=statuses&error=${encodeURIComponent(TASK_STATUS_OPTION_VALIDATION_MESSAGE)}`
      );
    }

    const { data: last } = await supabase
      .from("status_options")
      .select("position")
      .eq("entity_type", entityType)
      .order("position", { ascending: false })
      .limit(1)
      .maybeSingle();
    const nextPosition = (Number(last?.position) || 0) + 1;

    const payload = {
      entity_type: entityType,
      value,
      position: nextPosition,
      is_visible: isVisible,
      counts_as_completed: countsAsCompleted,
      color_hex: colorHex,
    };

    let { error } = await supabase.from("status_options").insert(payload);
    if (error && isSupabaseMissingColumnError(error)) {
      ({ error } = await supabase
        .from("status_options")
        .insert({ entity_type: entityType, value, position: nextPosition }));
    }

    if (error) {
      const hint = isSupabaseMissingTableError(error)
        ? " Run sql/status_options.sql in Supabase SQL editor first."
        : "";
      redirect(`/settings?tab=statuses&error=${encodeURIComponent(`${error.message}${hint}`)}`);
    }

    revalidatePath("/settings");
    revalidatePath("/tasks");
    revalidatePath("/projects");
    revalidatePath("/feature-suggestions");
    redirect("/settings?tab=statuses&success=Status%20added");
  }

  async function deleteStatusOption(formData: FormData) {
    "use server";
    const supabase = createSupabaseServerClient();
    const editAccess = await getPageEditAccess(
      supabase,
      "settings",
      "settings.status_options.delete.auth"
    );
    if (!editAccess.ok && editAccess.reason === "unauthenticated") redirect("/login");
    if (!editAccess.ok) {
      redirect(
        `/settings?tab=statuses&error=${encodeURIComponent(SETTINGS_EDIT_PERMISSION_MESSAGE)}`
      );
    }

    const id = String(formData.get("id") || "").trim();
    const entityType = normalizeSettingsStatusEntityType(formData.get("entity_type"));
    const value = normalizeStatusValue(String(formData.get("value") || ""));
    if (!id) {
      redirect("/settings?tab=statuses&error=Missing%20status%20id");
    }
    if (isCoreStatus(entityType, value)) {
      redirect("/settings?tab=statuses&error=Core%20statuses%20cannot%20be%20deleted");
    }

    const { error } = await supabase.from("status_options").delete().eq("id", id);
    if (error) {
      redirect(`/settings?tab=statuses&error=${encodeURIComponent(error.message)}`);
    }

    revalidatePath("/settings");
    revalidatePath("/tasks");
    revalidatePath("/projects");
    revalidatePath("/feature-suggestions");
    redirect("/settings?tab=statuses&success=Status%20deleted");
  }

  async function updateStatusOption(formData: FormData): Promise<{ ok: boolean; error?: string } | void> {
    "use server";
    const supabase = createSupabaseServerClient();
    const autosave = String(formData.get("autosave") || "").trim() === "1";
    const editAccess = await getPageEditAccess(
      supabase,
      "settings",
      "settings.status_options.update.auth"
    );
    if (!editAccess.ok && editAccess.reason === "unauthenticated") redirect("/login");
    if (!editAccess.ok) {
      if (autosave) return { ok: false, error: SETTINGS_EDIT_PERMISSION_MESSAGE };
      redirect(
        `/settings?tab=statuses&error=${encodeURIComponent(SETTINGS_EDIT_PERMISSION_MESSAGE)}`
      );
    }

    const id = String(formData.get("id") || "").trim();
    const { entityType, value, isVisible, countsAsCompleted, rawColorHex, colorHex } =
      buildSettingsStatusFormInput(formData);
    const requestedPosition = normalizeSettingsStatusPosition(formData.get("position"));

    if (!value) {
      if (autosave) return { ok: false, error: "Missing status" };
      redirect("/settings?tab=statuses&error=Missing%20status");
    }
    if (rawColorHex && !colorHex) {
      if (autosave) {
        return { ok: false, error: "Color must be a hex value like #00aaff" };
      }
      redirect("/settings?tab=statuses&error=Color%20must%20be%20a%20hex%20value%20like%20%2300aaff");
    }
    if (entityType === "task" && !isSupportedTaskStatus(value)) {
      if (autosave) return { ok: false, error: TASK_STATUS_OPTION_VALIDATION_MESSAGE };
      redirect(
        `/settings?tab=statuses&error=${encodeURIComponent(TASK_STATUS_OPTION_VALIDATION_MESSAGE)}`
      );
    }

    type StatusOptionDbRow = {
      id: string;
      value: string;
      position: number;
      is_visible: boolean | null;
      counts_as_completed: boolean | null;
      color_hex: string | null;
    };

    const loadStatusRows = async (): Promise<{
      data: StatusOptionDbRow[] | null;
      error: { message: string } | null;
    }> => {
      const withMetadata = await supabase
        .from("status_options")
        .select("id,value,position,is_visible,counts_as_completed,color_hex")
        .eq("entity_type", entityType)
        .order("position", { ascending: true })
        .order("value", { ascending: true });

      if (!withMetadata.error) {
        return {
          data: (withMetadata.data || []) as StatusOptionDbRow[],
          error: null,
        };
      }

      if (!isSupabaseMissingColumnError(withMetadata.error)) {
        return { data: null, error: withMetadata.error };
      }

      const legacy = await supabase
        .from("status_options")
        .select("id,value,position")
        .eq("entity_type", entityType)
        .order("position", { ascending: true })
        .order("value", { ascending: true });
      if (legacy.error) {
        return { data: null, error: legacy.error };
      }

      return {
        data: ((legacy.data || []) as Array<{ id: string; value: string; position: number }>).map((row) => ({
          id: row.id,
          value: row.value,
          position: row.position,
          is_visible: null,
          counts_as_completed: null,
          color_hex: null,
        })),
        error: null,
      };
    };

    const insertStatus = async (
      statusValue: string,
      position: number,
      visible: boolean,
      completed: boolean,
      statusColor: string | null
    ) => {
      let insertError: { message: string } | null = null;
      ({ error: insertError } = await supabase.from("status_options").insert({
        entity_type: entityType,
        value: statusValue,
        position,
        is_visible: visible,
        counts_as_completed: completed,
        color_hex: statusColor,
      }));
      if (insertError && isSupabaseMissingColumnError(insertError)) {
        ({ error: insertError } = await supabase.from("status_options").insert({
          entity_type: entityType,
          value: statusValue,
          position,
        }));
      }
      return insertError;
    };

    const updateById = async (targetId: string) => {
      let updateError: { message: string } | null = null;
      ({ error: updateError } = await supabase
        .from("status_options")
        .update({
          is_visible: isVisible,
          counts_as_completed: countsAsCompleted,
          color_hex: colorHex,
          position: requestedPosition,
        })
        .eq("id", targetId));
      if (updateError && isSupabaseMissingColumnError(updateError)) {
        ({ error: updateError } = await supabase
          .from("status_options")
          .update({
            position: requestedPosition,
          })
          .eq("id", targetId));
      }
      return updateError;
    };

    let error: { message: string } | null = null;

    if (id) {
      error = await updateById(id);
    } else {
      const existingStatus = await loadStatusRows();
      if (existingStatus.error) {
        error = existingStatus.error;
      } else {
        const matched = (existingStatus.data || []).find(
          (row) => normalizeStatusValue(String(row.value || "")) === value
        );
        if (matched?.id) {
          error = await updateById(matched.id);
        } else {
          error = await insertStatus(
            value,
            requestedPosition,
            isVisible,
            countsAsCompleted,
            colorHex
          );
        }
      }
    }

    if (!error) {
      let statusRowsResult = await loadStatusRows();
      if (statusRowsResult.error) {
        error = statusRowsResult.error;
      } else {
        let statusRows = statusRowsResult.data || [];
        const targetRowExists = statusRows.some(
          (row) => normalizeStatusValue(String(row.value || "")) === value
        );

        if (!targetRowExists) {
          error = await insertStatus(
            value,
            requestedPosition,
            isVisible,
            countsAsCompleted,
            colorHex
          );
          if (!error) {
            statusRowsResult = await loadStatusRows();
            if (statusRowsResult.error) {
              error = statusRowsResult.error;
            } else {
              statusRows = statusRowsResult.data || [];
            }
          }
        }

        if (!error) {
          const orderedStatuses = buildStatusOptionsWithMetadata(
            entityType,
            statusRows.map((row) => ({
              entity_type: entityType,
              value: row.value,
              position: row.position,
              is_visible: row.is_visible,
              counts_as_completed: row.counts_as_completed,
              color_hex: row.color_hex,
            })),
            []
          );
          let currentIndex = orderedStatuses.findIndex((status) => status.value === value);
          if (currentIndex === -1) {
            orderedStatuses.push({
              value,
              position: orderedStatuses.length + 1,
              isVisible,
              countsAsCompleted,
              colorHex,
            });
            currentIndex = orderedStatuses.length - 1;
          }
          const targetIndex = Math.min(
            Math.max(requestedPosition - 1, 0),
            Math.max(orderedStatuses.length - 1, 0)
          );
          if (currentIndex !== targetIndex) {
            const [moved] = orderedStatuses.splice(currentIndex, 1);
            if (moved) {
              orderedStatuses.splice(targetIndex, 0, moved);
            }
          }

          const statusRowByValue = new Map(
            statusRows.map((row) => [normalizeStatusValue(String(row.value || "")), row] as const)
          );

          for (let index = 0; index < orderedStatuses.length; index += 1) {
            const status = orderedStatuses[index];
            const nextPosition = index + 1;
            const existing = statusRowByValue.get(status.value);

            if (existing?.id) {
              const currentPosition = Number(existing.position);
              if (Number.isFinite(currentPosition) && currentPosition === nextPosition) {
                continue;
              }
              const { error: positionError } = await supabase
                .from("status_options")
                .update({ position: nextPosition })
                .eq("id", existing.id);
              if (positionError) {
                error = positionError;
                break;
              }
            } else {
              error = await insertStatus(
                status.value,
                nextPosition,
                status.isVisible,
                status.countsAsCompleted,
                status.colorHex
              );
              if (error) {
                break;
              }
            }
          }
        }
      }
    }

    if (error) {
      if (autosave) return { ok: false, error: error.message };
      redirect(`/settings?tab=statuses&error=${encodeURIComponent(error.message)}`);
    }

    revalidatePath("/settings");
    revalidatePath("/tasks");
    revalidatePath("/projects");
    revalidatePath("/feature-suggestions");
    if (autosave) {
      return { ok: true };
    }
    redirect("/settings?tab=statuses&success=Status%20updated");
  }

  async function createAssignmentGroup(formData: FormData) {
    "use server";
    const supabase = createSupabaseServerClient();
    const editAccess = await getPageEditAccess(
      supabase,
      "settings",
      "settings.assignment_groups.create.auth"
    );
    if (!editAccess.ok && editAccess.reason === "unauthenticated") redirect("/login");
    if (!editAccess.ok) {
      redirect("/settings?tab=groups&error=You%20do%20not%20have%20permission%20to%20manage%20groups");
    }

    const name = String(formData.get("name") || "").trim();
    const description = String(formData.get("description") || "").trim();
    const memberUserIds = Array.from(
      new Set(
        formData
          .getAll("member_user_ids")
          .map((value) => String(value || "").trim())
          .filter((value) => isUuid(value))
      )
    );

    if (!name) {
      redirect("/settings?tab=groups&error=Group%20name%20is%20required");
    }

    const { data: createdGroup, error: createGroupError } = await supabase
      .from("assignment_groups")
      .insert({
        name,
        description: description || null,
        created_by_user_id: editAccess.user.id,
      })
      .select("id")
      .single();

    if (createGroupError || !createdGroup?.id) {
      redirect(
        `/settings?tab=groups&error=${encodeURIComponent(
          createGroupError?.message || "Unable to create group"
        )}`
      );
    }

    if (memberUserIds.length) {
      const { error: addMembersError } = await supabase.from("assignment_group_members").insert(
        memberUserIds.map((userId) => ({
          group_id: createdGroup.id,
          user_id: userId,
          created_by_user_id: editAccess.user.id,
        }))
      );
      if (addMembersError) {
        redirect(`/settings?tab=groups&error=${encodeURIComponent(addMembersError.message)}`);
      }
    }

    revalidatePath("/settings");
    redirect("/settings?tab=groups&success=Group%20created");
  }

  async function updateAssignmentGroup(formData: FormData) {
    "use server";
    const supabase = createSupabaseServerClient();
    const editAccess = await getPageEditAccess(
      supabase,
      "settings",
      "settings.assignment_groups.update.auth"
    );
    if (!editAccess.ok && editAccess.reason === "unauthenticated") redirect("/login");
    if (!editAccess.ok) {
      redirect("/settings?tab=groups&error=You%20do%20not%20have%20permission%20to%20manage%20groups");
    }

    const groupId = String(formData.get("group_id") || "").trim();
    const name = String(formData.get("name") || "").trim();
    const description = String(formData.get("description") || "").trim();
    const memberUserIds = Array.from(
      new Set(
        formData
          .getAll("member_user_ids")
          .map((value) => String(value || "").trim())
          .filter((value) => isUuid(value))
      )
    );

    if (!isUuid(groupId)) {
      redirect("/settings?tab=groups&error=Invalid%20group%20id");
    }
    if (!name) {
      redirect("/settings?tab=groups&error=Group%20name%20is%20required");
    }

    const { error: updateGroupError } = await supabase
      .from("assignment_groups")
      .update({
        name,
        description: description || null,
      })
      .eq("id", groupId);

    if (updateGroupError) {
      redirect(`/settings?tab=groups&error=${encodeURIComponent(updateGroupError.message)}`);
    }

    const { error: clearMembersError } = await supabase
      .from("assignment_group_members")
      .delete()
      .eq("group_id", groupId);
    if (clearMembersError) {
      redirect(`/settings?tab=groups&error=${encodeURIComponent(clearMembersError.message)}`);
    }

    if (memberUserIds.length) {
      const { error: addMembersError } = await supabase.from("assignment_group_members").insert(
        memberUserIds.map((userId) => ({
          group_id: groupId,
          user_id: userId,
          created_by_user_id: editAccess.user.id,
        }))
      );
      if (addMembersError) {
        redirect(`/settings?tab=groups&error=${encodeURIComponent(addMembersError.message)}`);
      }
    }

    revalidatePath("/settings");
    redirect("/settings?tab=groups&success=Group%20saved");
  }

  async function deleteAssignmentGroup(formData: FormData) {
    "use server";
    const supabase = createSupabaseServerClient();
    const editAccess = await getPageEditAccess(
      supabase,
      "settings",
      "settings.assignment_groups.delete.auth"
    );
    if (!editAccess.ok && editAccess.reason === "unauthenticated") redirect("/login");
    if (!editAccess.ok) {
      redirect("/settings?tab=groups&error=You%20do%20not%20have%20permission%20to%20manage%20groups");
    }

    const groupId = String(formData.get("group_id") || "").trim();
    if (!isUuid(groupId)) {
      redirect("/settings?tab=groups&error=Invalid%20group%20id");
    }

    const { error } = await supabase.from("assignment_groups").delete().eq("id", groupId);
    if (error) {
      redirect(`/settings?tab=groups&error=${encodeURIComponent(error.message)}`);
    }

    revalidatePath("/settings");
    redirect("/settings?tab=groups&success=Group%20deleted");
  }

  const renderMessage = (value: string | undefined, kind: "error" | "success") => {
    if (!value) return null;
    if (kind === "error") {
      return (
        <p className="rounded-md border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
          {value}
        </p>
      );
    }
    return (
      <p className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-700">
        {value}
      </p>
    );
  };

  const {
    displayName: profileDisplayName,
    initials: profileInitials,
    avatarUrl: profileAvatarUrl,
  } = buildSettingsProfileDisplay(profile);

  return (
    <div className="space-y-8">
      <section className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Settings</h1>
          <p className="text-sm text-slate-600">
            Update your profile and choose which alerts you receive.
          </p>
        </div>
      </section>

      {renderMessage(searchParams?.error, "error")}
      {renderMessage(searchParams?.success, "success")}

      <SettingsTabs active={activeTab} showAdminLink={profile.role === "admin"} />

      {activeTab === "profile" ? (
        <section className="rounded-lg border border-slate-200 bg-white">
          <div className="border-b border-slate-200 px-6 py-4">
            <h2 className="text-lg font-semibold text-slate-900">Profile</h2>
          </div>
          <div className="p-6">
            <form
              action={updateProfile}
              encType="multipart/form-data"
              className="grid gap-4 md:max-w-xl"
            >
              <div className="flex items-center gap-4 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
                <div className="relative h-14 w-14 overflow-hidden rounded-full border border-slate-200 bg-white">
                  {profileAvatarUrl ? (
                    <Image
                      src={profileAvatarUrl}
                      alt={`${profileDisplayName} profile photo`}
                      fill
                      unoptimized
                      sizes="56px"
                      className="object-cover"
                    />
                  ) : (
                    <span className="inline-flex h-full w-full items-center justify-center text-sm font-semibold text-slate-700">
                      {profileInitials}
                    </span>
                  )}
                </div>
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-slate-900">{profileDisplayName}</p>
                  <p className="text-xs text-slate-600">Used in chat and social activity.</p>
                </div>
              </div>

              <label className="grid gap-1">
                <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Full name
                </span>
                <input
                  name="full_name"
                  defaultValue={profile.full_name || ""}
                  className="rounded-md border border-slate-300 px-3 py-2 text-sm"
                  placeholder="Your name"
                  required
                />
              </label>

              <label className="grid gap-1">
                <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Email
                </span>
                <input
                  value={profile.email || ""}
                  className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700"
                  readOnly
                />
              </label>

              <label className="grid gap-1">
                <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Profile photo
                </span>
                <input
                  type="file"
                  name="avatar_file"
                  accept={ALLOWED_UPLOAD_IMAGE_ACCEPT}
                  className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
                />
                <span className="text-xs text-slate-500">
                  PNG, JPG, WEBP, GIF, or AVIF. Max 5MB.
                </span>
              </label>

              {profileAvatarUrl ? (
                <label className="inline-flex items-center gap-2 text-sm text-slate-700">
                  <input type="checkbox" name="remove_avatar" className="h-4 w-4 rounded border-slate-300" />
                  Remove current photo
                </label>
              ) : null}

              <div className="flex items-center justify-end">
                <button
                  type="submit"
                  className="rounded-md btn-primary px-4 py-2 text-sm font-semibold text-white"
                >
                  Save
                </button>
              </div>
            </form>
          </div>
        </section>
      ) : null}

      {activeTab === "notifications" ? (
        <section className="rounded-lg border border-slate-200 bg-white">
          <div className="border-b border-slate-200 px-6 py-4">
            <h2 className="text-lg font-semibold text-slate-900">Notifications</h2>
            <p className="mt-1 text-sm text-slate-600">
              Configure in-app alerts by source. Email delivery is not enabled yet.
            </p>
          </div>
          <div className="p-6">
            <form action={updateNotificationPrefs} className="space-y-8">
              <section className="space-y-3">
                <h3 className="text-sm font-semibold text-slate-900">Global controls</h3>
                <div className="grid gap-3 md:grid-cols-2">
                  <label className="flex items-start gap-3 rounded-md border border-slate-200 px-4 py-3 text-sm">
                    <input
                      type="checkbox"
                      name="mentions_enabled"
                      defaultChecked={prefs.mentions_enabled}
                      className="mt-1 h-4 w-4 rounded border-slate-300"
                    />
                    <span>
                      <span className="block font-semibold text-slate-900">
                        Allow @mentions
                      </span>
                      <span className="block text-slate-600">
                        Master switch for all mention notifications.
                      </span>
                    </span>
                  </label>
                  <label className="flex items-start gap-3 rounded-md border border-slate-200 px-4 py-3 text-sm">
                    <input
                      type="checkbox"
                      name="schedule_updates"
                      defaultChecked={prefs.schedule_updates}
                      className="mt-1 h-4 w-4 rounded border-slate-300"
                    />
                    <span>
                      <span className="block font-semibold text-slate-900">
                        Schedule updates
                      </span>
                      <span className="block text-slate-600">
                        Alerts for rostering and schedule publishing activity.
                      </span>
                    </span>
                  </label>
                </div>
              </section>

              <section className="space-y-3">
                <h3 className="text-sm font-semibold text-slate-900">Tasks</h3>
                <div className="grid gap-3 md:grid-cols-2">
                  <label className="flex items-start gap-3 rounded-md border border-slate-200 px-4 py-3 text-sm">
                    <input
                      type="checkbox"
                      name="task_assigned"
                      defaultChecked={prefs.task_assigned}
                      className="mt-1 h-4 w-4 rounded border-slate-300"
                    />
                    <span>
                      <span className="block font-semibold text-slate-900">
                        Assigned to me
                      </span>
                      <span className="block text-slate-600">
                        Get notified when a task is assigned to you.
                      </span>
                    </span>
                  </label>

                  <label className="flex items-start gap-3 rounded-md border border-slate-200 px-4 py-3 text-sm">
                    <input
                      type="checkbox"
                      name="task_updated"
                      defaultChecked={prefs.task_updated}
                      className="mt-1 h-4 w-4 rounded border-slate-300"
                    />
                    <span>
                      <span className="block font-semibold text-slate-900">
                        Task updated
                      </span>
                      <span className="block text-slate-600">
                        Get notified when your assigned task changes.
                      </span>
                    </span>
                  </label>

                  <label className="flex items-start gap-3 rounded-md border border-slate-200 px-4 py-3 text-sm">
                    <input
                      type="checkbox"
                      name="task_due_today"
                      defaultChecked={prefs.task_due_today}
                      className="mt-1 h-4 w-4 rounded border-slate-300"
                    />
                    <span>
                      <span className="block font-semibold text-slate-900">
                        Due today
                      </span>
                      <span className="block text-slate-600">
                        Daily reminder for tasks due today.
                      </span>
                    </span>
                  </label>

                  <label className="flex items-start gap-3 rounded-md border border-slate-200 px-4 py-3 text-sm">
                    <input
                      type="checkbox"
                      name="task_overdue"
                      defaultChecked={prefs.task_overdue}
                      className="mt-1 h-4 w-4 rounded border-slate-300"
                    />
                    <span>
                      <span className="block font-semibold text-slate-900">
                        Overdue
                      </span>
                      <span className="block text-slate-600">
                        Daily reminder for overdue tasks.
                      </span>
                    </span>
                  </label>
                </div>
              </section>

              <section className="space-y-3">
                <h3 className="text-sm font-semibold text-slate-900">Mentions by area</h3>
                <div className="grid gap-3 md:grid-cols-2">
                  <label className="flex items-start gap-3 rounded-md border border-slate-200 px-4 py-3 text-sm">
                    <input
                      type="checkbox"
                      name="mention_task"
                      defaultChecked={prefs.mention_task}
                      className="mt-1 h-4 w-4 rounded border-slate-300"
                    />
                    <span>
                      <span className="block font-semibold text-slate-900">Tasks</span>
                      <span className="block text-slate-600">
                        Mentions in task pages and updates.
                      </span>
                    </span>
                  </label>

                  <label className="flex items-start gap-3 rounded-md border border-slate-200 px-4 py-3 text-sm">
                    <input
                      type="checkbox"
                      name="mention_notes"
                      defaultChecked={prefs.mention_notes}
                      className="mt-1 h-4 w-4 rounded border-slate-300"
                    />
                    <span>
                      <span className="block font-semibold text-slate-900">Notes</span>
                      <span className="block text-slate-600">
                        Mentions in personal and client notes.
                      </span>
                    </span>
                  </label>

                  <label className="flex items-start gap-3 rounded-md border border-slate-200 px-4 py-3 text-sm">
                    <input
                      type="checkbox"
                      name="mention_chat"
                      defaultChecked={prefs.mention_chat}
                      className="mt-1 h-4 w-4 rounded border-slate-300"
                    />
                    <span>
                      <span className="block font-semibold text-slate-900">Chat</span>
                      <span className="block text-slate-600">
                        Mentions in direct and group chat messages.
                      </span>
                    </span>
                  </label>

                  <label className="flex items-start gap-3 rounded-md border border-slate-200 px-4 py-3 text-sm">
                    <input
                      type="checkbox"
                      name="mention_social"
                      defaultChecked={prefs.mention_social}
                      className="mt-1 h-4 w-4 rounded border-slate-300"
                    />
                    <span>
                      <span className="block font-semibold text-slate-900">Social</span>
                      <span className="block text-slate-600">
                        Mentions in social posts, comments, and replies.
                      </span>
                    </span>
                  </label>

                  <label className="flex items-start gap-3 rounded-md border border-slate-200 px-4 py-3 text-sm">
                    <input
                      type="checkbox"
                      name="mention_feature_suggestion"
                      defaultChecked={prefs.mention_feature_suggestion}
                      className="mt-1 h-4 w-4 rounded border-slate-300"
                    />
                    <span>
                      <span className="block font-semibold text-slate-900">
                        Feature suggestions
                      </span>
                      <span className="block text-slate-600">
                        Mentions in ideas, idea updates, and idea comments.
                      </span>
                    </span>
                  </label>

                  <label className="flex items-start gap-3 rounded-md border border-slate-200 px-4 py-3 text-sm">
                    <input
                      type="checkbox"
                      name="mention_form_submission"
                      defaultChecked={prefs.mention_form_submission}
                      className="mt-1 h-4 w-4 rounded border-slate-300"
                    />
                    <span>
                      <span className="block font-semibold text-slate-900">
                        Form submissions
                      </span>
                      <span className="block text-slate-600">
                        Mentions in form submission comments.
                      </span>
                    </span>
                  </label>

                  <label className="flex items-start gap-3 rounded-md border border-slate-200 px-4 py-3 text-sm md:col-span-2">
                    <input
                      type="checkbox"
                      name="mention_quiz"
                      defaultChecked={prefs.mention_quiz}
                      className="mt-1 h-4 w-4 rounded border-slate-300"
                    />
                    <span>
                      <span className="block font-semibold text-slate-900">
                        Quizzes (forward-compatible)
                      </span>
                      <span className="block text-slate-600">
                        Reserved for quiz mentions as quiz collaboration expands.
                      </span>
                    </span>
                  </label>
                </div>
              </section>

              <section className="space-y-3">
                <h3 className="text-sm font-semibold text-slate-900">
                  Feature suggestions
                </h3>
                <div className="grid gap-3 md:grid-cols-2">
                  <label className="flex items-start gap-3 rounded-md border border-slate-200 px-4 py-3 text-sm">
                    <input
                      type="checkbox"
                      name="feature_suggestion_comment"
                      defaultChecked={prefs.feature_suggestion_comment}
                      className="mt-1 h-4 w-4 rounded border-slate-300"
                    />
                    <span>
                      <span className="block font-semibold text-slate-900">
                        Comment on my idea
                      </span>
                      <span className="block text-slate-600">
                        Get notified when someone comments on your suggestion.
                      </span>
                    </span>
                  </label>

                  <label className="flex items-start gap-3 rounded-md border border-slate-200 px-4 py-3 text-sm">
                    <input
                      type="checkbox"
                      name="feature_suggestion_status"
                      defaultChecked={prefs.feature_suggestion_status}
                      className="mt-1 h-4 w-4 rounded border-slate-300"
                    />
                    <span>
                      <span className="block font-semibold text-slate-900">
                        Status change
                      </span>
                      <span className="block text-slate-600">
                        Get notified when your suggestion status changes.
                      </span>
                    </span>
                  </label>
                </div>
              </section>

              <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
                Tip: keep @mentions enabled globally, then tune noisy areas individually.
              </p>

              <div className="flex items-center justify-end">
                <button
                  type="submit"
                  className="rounded-md btn-primary px-4 py-2 text-sm font-semibold text-white"
                >
                  Save preferences
                </button>
              </div>
            </form>
          </div>
        </section>
      ) : null}
      {activeTab === "groups" ? (
        <section className="rounded-lg border border-slate-200 bg-white">
          <div className="border-b border-slate-200 px-6 py-4">
            <h2 className="text-lg font-semibold text-slate-900">Assignment groups</h2>
            <p className="mt-1 text-sm text-slate-600">
              Create reusable groups to assign work faster across tasks, projects, forms, quizzes, chat, and social pages.
            </p>
          </div>
          <div className="space-y-6 p-6">
            {assignmentGroupsSchemaMissing ? (
              <p className="rounded-md border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900">
                Assignment groups are not set up yet. Run <code>sql/20260301150000_assignment_groups.sql</code> in Supabase SQL editor.
              </p>
            ) : null}
            {assignmentGroupsError ? (
              <p className="rounded-md border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
                {assignmentGroupsError}
              </p>
            ) : null}
            <section className="grid gap-3 sm:grid-cols-3">
              <article className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Groups</p>
                <p className="mt-1 text-2xl font-semibold text-slate-900">{assignmentGroups.length}</p>
              </article>
              <article className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Members Across Groups</p>
                <p className="mt-1 text-2xl font-semibold text-slate-900">{assignmentGroupTotalMemberSlots}</p>
              </article>
              <article className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Unique Members</p>
                <p className="mt-1 text-2xl font-semibold text-slate-900">{assignmentGroupUniqueMemberCount}</p>
              </article>
            </section>

            <section className="grid gap-6 xl:grid-cols-[22rem_minmax(0,1fr)]">
              <article className="rounded-xl border border-slate-200 bg-slate-50/60 p-4">
                <h3 className="text-sm font-semibold text-slate-900">Create group</h3>
                <p className="mt-1 text-xs text-slate-600">
                  Create once, then reuse everywhere assignment is available.
                </p>
                <form action={createAssignmentGroup} className="mt-4 space-y-3">
                  <label className="grid gap-1 text-xs font-semibold uppercase tracking-wide text-slate-600">
                    Group name
                    <input
                      name="name"
                      required
                      maxLength={80}
                      placeholder="Managers"
                      className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-normal text-slate-800"
                    />
                  </label>
                  <label className="grid gap-1 text-xs font-semibold uppercase tracking-wide text-slate-600">
                    Description
                    <textarea
                      name="description"
                      rows={2}
                      maxLength={240}
                      placeholder="Who belongs in this group?"
                      className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-normal text-slate-800"
                    />
                  </label>
                  <div className="space-y-2">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">Members</p>
                    {users.length ? (
                      <div className="max-h-56 overflow-auto rounded-md border border-slate-200 bg-white p-2">
                        <div className="space-y-1">
                          {users.map((member) => (
                            <label
                              key={`new-group-${member.id}`}
                              className="flex items-center gap-2 rounded px-2 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
                            >
                              <input type="checkbox" name="member_user_ids" value={member.id} />
                              <span className="truncate">{member.full_name || member.email || member.id}</span>
                            </label>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <p className="rounded-md border border-dashed border-slate-300 px-3 py-2 text-xs text-slate-500">
                        No users found.
                      </p>
                    )}
                  </div>
                  <button
                    type="submit"
                    className="w-full rounded-md btn-primary px-4 py-2 text-sm font-semibold text-white"
                  >
                    Create group
                  </button>
                </form>
              </article>

              <article className="space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold text-slate-900">Existing groups</h3>
                  <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs font-semibold text-slate-600">
                    {assignmentGroups.length}
                  </span>
                </div>

                {assignmentGroups.length ? (
                  <div className="space-y-3">
                    {assignmentGroups.map((group) => {
                      const selectedMembers = assignmentGroupMemberIdsByGroupId[group.id] || new Set<string>();
                      const selectedMemberLabels = assignmentGroupMemberLabelsByGroupId[group.id] || [];
                      const previewLabels = selectedMemberLabels.slice(0, 3);
                      const remainingMembersCount = Math.max(
                        selectedMemberLabels.length - previewLabels.length,
                        0
                      );

                      return (
                        <details
                          key={group.id}
                          className="overflow-hidden rounded-xl border border-slate-200 bg-white"
                        >
                          <summary className="cursor-pointer list-none px-4 py-3 hover:bg-slate-50">
                            <div className="flex flex-wrap items-start justify-between gap-3">
                              <div className="min-w-0 space-y-1">
                                <p className="truncate text-sm font-semibold text-slate-900">{group.name}</p>
                                <p className="line-clamp-2 text-xs text-slate-600">
                                  {group.description || "No description"}
                                </p>
                                {previewLabels.length ? (
                                  <div className="mt-2 flex flex-wrap gap-1">
                                    {previewLabels.map((label) => (
                                      <span
                                        key={`${group.id}-${label}`}
                                        className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] text-slate-700"
                                      >
                                        {label}
                                      </span>
                                    ))}
                                    {remainingMembersCount ? (
                                      <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] text-slate-700">
                                        +{remainingMembersCount} more
                                      </span>
                                    ) : null}
                                  </div>
                                ) : (
                                  <p className="text-[11px] text-slate-500">No members assigned</p>
                                )}
                              </div>
                              <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-semibold text-slate-700">
                                {group.memberCount} members
                              </span>
                            </div>
                          </summary>

                          <form action={updateAssignmentGroup} className="space-y-4 border-t border-slate-200 p-4">
                            <input type="hidden" name="group_id" value={group.id} />
                            <div className="grid gap-3 md:grid-cols-2">
                              <label className="grid gap-1 text-xs font-semibold uppercase tracking-wide text-slate-600">
                                Group name
                                <input
                                  name="name"
                                  required
                                  defaultValue={group.name}
                                  maxLength={80}
                                  className="rounded-md border border-slate-300 px-3 py-2 text-sm font-normal text-slate-800"
                                />
                              </label>
                              <label className="grid gap-1 text-xs font-semibold uppercase tracking-wide text-slate-600">
                                Description
                                <input
                                  name="description"
                                  defaultValue={group.description}
                                  maxLength={240}
                                  className="rounded-md border border-slate-300 px-3 py-2 text-sm font-normal text-slate-800"
                                />
                              </label>
                            </div>

                            <div className="space-y-2">
                              <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                                Members ({group.memberCount})
                              </p>
                              {users.length ? (
                                <div className="max-h-56 overflow-auto rounded-md border border-slate-200 bg-slate-50 p-2">
                                  <div className="space-y-1">
                                    {users.map((member) => (
                                      <label
                                        key={`${group.id}-${member.id}`}
                                        className="flex items-center gap-2 rounded px-2 py-1.5 text-sm text-slate-700 hover:bg-white"
                                      >
                                        <input
                                          type="checkbox"
                                          name="member_user_ids"
                                          value={member.id}
                                          defaultChecked={selectedMembers.has(member.id)}
                                        />
                                        <span className="truncate">
                                          {member.full_name || member.email || member.id}
                                        </span>
                                      </label>
                                    ))}
                                  </div>
                                </div>
                              ) : (
                                <p className="rounded-md border border-dashed border-slate-300 px-3 py-2 text-xs text-slate-500">
                                  No users found.
                                </p>
                              )}
                            </div>

                            <div className="flex flex-wrap items-center justify-end gap-2">
                              <button
                                type="submit"
                                className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
                              >
                                Save
                              </button>
                              <button
                                type="submit"
                                formAction={deleteAssignmentGroup}
                                className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700 hover:bg-red-100"
                              >
                                Delete
                              </button>
                            </div>
                          </form>
                        </details>
                      );
                    })}
                  </div>
                ) : (
                  <p className="rounded-md border border-dashed border-slate-300 bg-slate-50 px-4 py-3 text-sm text-slate-600">
                    No groups created yet.
                  </p>
                )}
              </article>
            </section>
          </div>
        </section>
      ) : null}

      {activeTab === "statuses" ? (
        <section className="rounded-lg border border-slate-200 bg-white">
          <div className="border-b border-slate-200 px-6 py-4">
            <h2 className="text-lg font-semibold text-slate-900">Status options</h2>
            <p className="mt-1 text-sm text-slate-600">
              Manage task, project, and feature suggestion statuses used across forms, templates, and filters.
              Open statuses stay visible in lists. Closed statuses are hidden unless someone chooses to show closed.
              Existing status rows auto-save when you change any option.
            </p>
          </div>
          <div className="p-6 space-y-6">
            {statusOptionsError && isSupabaseMissingTableError(statusOptionsError) ? (
              <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                Status settings are not set up yet. Run `sql/status_options.sql` in
                Supabase SQL editor, then refresh this page.
              </div>
            ) : null}

            <StatusOptionsPanel
              sections={statusSections}
              onCreate={createStatusOption}
              onUpdate={updateStatusOption}
              onDelete={deleteStatusOption}
            />
          </div>
        </section>
      ) : null}

      {activeTab === "templates" ? (
        <section className="rounded-lg border border-slate-200 bg-white">
          <div className="border-b border-slate-200 px-6 py-4">
            <h2 className="text-lg font-semibold text-slate-900">Templates</h2>
            <p className="mt-1 text-sm text-slate-600">
              Company-wide templates. Anyone can create or edit.
            </p>
          </div>
          <div className="p-6 space-y-6">
            {taskTemplatesError || projectTemplatesError ? (
              <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                <p className="font-semibold">Templates are not set up yet.</p>
                <p className="mt-1">
                  Run the SQL script `sql/templates.sql` in Supabase SQL editor,
                  then refresh this page.
                </p>
              </div>
            ) : null}
            {taskTemplateAssigneesError &&
            isSupabaseMissingTableError(taskTemplateAssigneesError) ? (
              <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                Task template assignees are not set up yet. Re-run `sql/templates.sql` in
                Supabase SQL editor, then refresh this page.
              </div>
            ) : null}
            <nav className="flex flex-wrap gap-2 border-b border-slate-200 pb-4 text-sm">
              <a
                href="/settings?tab=templates&templates=tasks"
                className={`rounded-md px-3 py-1.5 font-medium ${
                  templatesTab === "tasks"
                    ? "tab-active"
                    : "border border-slate-200 text-slate-700 hover:bg-slate-100 hover:text-slate-900"
                }`}
              >
                Task templates
              </a>
              <a
                href="/settings?tab=templates&templates=projects"
                className={`rounded-md px-3 py-1.5 font-medium ${
                  templatesTab === "projects"
                    ? "tab-active"
                    : "border border-slate-200 text-slate-700 hover:bg-slate-100 hover:text-slate-900"
                }`}
              >
                Project templates
              </a>
            </nav>

            {templatesTab === "tasks" ? (
              <div className="space-y-6">
                <section className="rounded-md border border-slate-200 bg-slate-50 p-4">
                  <h3 className="text-sm font-semibold text-slate-900">
                    Create task template
                  </h3>
                  <form action={createTaskTemplate} className="mt-3 grid gap-3 md:grid-cols-6">
                    <input
                      name="name"
                      placeholder="Template name"
                      className="md:col-span-2 rounded-md border border-slate-300 px-3 py-2 text-sm"
                      required
                    />
                    <input
                      name="title"
                      placeholder="Default task title"
                      className="md:col-span-2 rounded-md border border-slate-300 px-3 py-2 text-sm"
                      required
                    />
                    <select
                      name="status"
                      className="rounded-md border border-slate-300 px-3 py-2 text-sm"
                      defaultValue="to_do"
                    >
                      {taskStatusOptions.map((status) => (
                        <option key={status} value={status}>
                          {status.replace("_", " ")}
                        </option>
                      ))}
                    </select>
                    <select
                      name="priority"
                      className="rounded-md border border-slate-300 px-3 py-2 text-sm"
                      defaultValue="medium"
                    >
                      {["low","medium","high","critical"].map((priority) => (
                        <option key={priority} value={priority}>
                          {priority}
                        </option>
                      ))}
                    </select>

                    <textarea
                      name="description"
                      placeholder="Template notes (optional)"
                      rows={3}
                      className="md:col-span-4 rounded-md border border-slate-300 px-3 py-2 text-sm"
                    />
                    <input
                      type="time"
                      name="due_time"
                      className="rounded-md border border-slate-300 px-3 py-2 text-sm"
                      defaultValue="09:00"
                    />
                    <div className="md:col-span-6 relative">
                      <AssigneeMultiSelect
                        users={users}
                        groups={assignmentGroupOptions}
                        name="assignee_user_ids"
                      />
                    </div>

                    <button
                      type="submit"
                      className="md:col-span-6 rounded-md btn-primary px-4 py-2 text-sm font-semibold text-white"
                      disabled={Boolean(taskTemplatesError) || Boolean(taskTemplateAssigneesError)}
                    >
                      Create template
                    </button>
                  </form>
                </section>
                <section className="space-y-3">
                  <h3 className="text-sm font-semibold text-slate-900">Existing task templates</h3>

                  {!taskTemplates.length ? (
                    <p className="text-sm text-slate-600">No templates yet.</p>
                  ) : (
                    <div className="rounded-lg border border-slate-200 bg-white">
                      <div className="overflow-x-auto">
                        <table className="min-w-full text-left text-sm">
                          <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                            <tr>
                              <th className="px-6 py-3">Template</th>
                              <th className="px-6 py-3">Default title</th>
                              <th className="px-6 py-3">Status</th>
                              <th className="px-6 py-3">Priority</th>
                              <th className="px-6 py-3">Recurrence</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-200">
                            {taskTemplates.map((tpl) => {
                              const isSelected = tpl.id === selectedTaskTemplateId;
                              const recurrenceLabel = tpl.recurrence_frequency
                                ? tpl.recurrence_frequency
                                : "once";
                              const leadDays =
                                typeof tpl.recurrence_lead_days === "number"
                                  ? tpl.recurrence_lead_days
                                  : 7;
                              return (
                                <tr
                                  key={tpl.id}
                                  className={isSelected ? "bg-slate-50" : "hover:bg-slate-50"}
                                >
                                  <td className="px-6 py-3 font-semibold text-slate-900">
                                    <a
                                      className="underline-offset-2 hover:underline"
                                      href={
                                        mirroredTaskTemplateIds.has(tpl.id)
                                          ? `/tasks/${encodeURIComponent(tpl.id)}`
                                          : `/settings?tab=templates&templates=tasks&task_template_id=${encodeURIComponent(
                                              tpl.id
                                            )}&task_template_panel=details`
                                      }
                                    >
                                      {tpl.name}
                                    </a>
                                  </td>
                                  <td className="px-6 py-3 text-slate-700">{tpl.title}</td>
                                  <td className="px-6 py-3 text-slate-700">
                                    {tpl.status?.replace("_", " ")}
                                  </td>
                                  <td className="px-6 py-3 text-slate-700">{tpl.priority}</td>
                                  <td className="px-6 py-3 text-slate-700">
                                    {recurrenceLabel}
                                    {tpl.recurrence_frequency ? ` (lead ${leadDays}d)` : ""}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {selectedTaskTemplate ? (
                    <section className="space-y-8">
                      <section className="space-y-2">
                        <p className="text-sm font-semibold uppercase tracking-wide text-slate-500">
                          Task
                        </p>
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="min-w-0">
                            <h4 className="truncate text-3xl font-semibold text-slate-900">
                              {selectedTaskTemplate.title}
                            </h4>
                            <div className="text-sm text-slate-600">
                              <p>Template: {selectedTaskTemplate.name}</p>
                              <p>
                                Preset assignees:{" "}
                                {selectedTaskTemplateAssigneeIds.length
                                  ? selectedTaskTemplateAssigneeIds
                                      .map((userId) => userNameById[userId] || "Unknown user")
                                      .join(", ")
                                  : "--"}
                              </p>
                            </div>
                          </div>
                          <form action={deleteTaskTemplate} className="shrink-0">
                            <input type="hidden" name="id" value={selectedTaskTemplate.id} />
                            <ConfirmSubmitButton
                              className="text-sm font-semibold text-red-600 hover:text-red-700"
                              confirmText={`Delete template: ${selectedTaskTemplate.name}?`}
                              pendingLabel="Deleting..."
                            >
                              Delete task
                            </ConfirmSubmitButton>
                          </form>
                        </div>
                      </section>

                      <nav className="flex flex-wrap gap-2 border-b border-slate-200 pb-4 text-sm">
                        <a
                          href={`/settings?tab=templates&templates=tasks&task_template_id=${encodeURIComponent(
                            selectedTaskTemplate.id
                          )}&task_template_panel=details`}
                          className={`rounded-md px-3 py-1.5 font-medium ${
                            taskTemplatePanel === "details"
                              ? "tab-active"
                              : "border border-slate-200 text-slate-700 hover:bg-slate-100 hover:text-slate-900"
                          }`}
                        >
                          Details
                        </a>
                        <a
                          href={`/settings?tab=templates&templates=tasks&task_template_id=${encodeURIComponent(
                            selectedTaskTemplate.id
                          )}&task_template_panel=custom-fields`}
                          className={`rounded-md px-3 py-1.5 font-medium ${
                            taskTemplatePanel === "custom-fields"
                              ? "tab-active"
                              : "border border-slate-200 text-slate-700 hover:bg-slate-100 hover:text-slate-900"
                          }`}
                        >
                          Custom fields
                        </a>
                        <a
                          href={`/settings?tab=templates&templates=tasks&task_template_id=${encodeURIComponent(
                            selectedTaskTemplate.id
                          )}&task_template_panel=subtasks`}
                          className={`rounded-md px-3 py-1.5 font-medium ${
                            taskTemplatePanel === "subtasks"
                              ? "tab-active"
                              : "border border-slate-200 text-slate-700 hover:bg-slate-100 hover:text-slate-900"
                          }`}
                        >
                          Subtasks
                        </a>
                      </nav>

                      {taskTemplatePanel === "details" ? (
                      <section className="rounded-lg border border-slate-200 bg-white">
                        <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-6 py-4">
                          <h2 className="text-lg font-semibold text-slate-900">Task details</h2>
                          <a
                            href={`/settings?tab=templates&templates=tasks&task_template_id=${encodeURIComponent(
                              selectedTaskTemplate.id
                            )}&task_template_panel=custom-fields`}
                            className="rounded-md border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                          >
                            Add field
                          </a>
                        </div>
                        <div className="px-6 pb-6">
                          <form action={updateTaskTemplate} className="mt-4 grid gap-4 md:grid-cols-4">
                            <input type="hidden" name="id" value={selectedTaskTemplate.id} />
                            <input
                              name="title"
                              defaultValue={selectedTaskTemplate.title}
                              className="md:col-span-4 rounded-md border border-slate-300 px-3 py-2 text-sm"
                              required
                            />
                            <div className="grid gap-1">
                              <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                                Status
                              </label>
                              <select
                                name="status"
                                className="rounded-md border border-slate-300 px-3 py-2 text-sm"
                                defaultValue={selectedTaskTemplate.status || "to_do"}
                              >
                                {taskStatusOptions.map((status) => (
                                  <option key={status} value={status}>
                                    {status.replace("_", " ")}
                                  </option>
                                ))}
                              </select>
                            </div>
                            <div className="grid gap-1">
                              <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                                Priority
                              </label>
                              <select
                                name="priority"
                                className="rounded-md border border-slate-300 px-3 py-2 text-sm"
                                defaultValue={selectedTaskTemplate.priority || "medium"}
                              >
                                {["low", "medium", "high", "critical"].map((priority) => (
                                  <option key={priority} value={priority}>
                                    {priority}
                                  </option>
                                ))}
                              </select>
                            </div>
                            <div className="grid gap-1 md:col-span-2">
                              <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                                Assignees
                              </label>
                              <div className="relative">
                                <AssigneeMultiSelect
                                  users={users}
                                  groups={assignmentGroupOptions}
                                  name="assignee_user_ids"
                                  defaultSelected={selectedTaskTemplateAssigneeIds}
                                />
                              </div>
                            </div>
                            <div className="grid gap-1">
                              <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                                Due time
                              </label>
                              <input
                                type="time"
                                name="due_time"
                                defaultValue={selectedTaskTemplate.due_time || ""}
                                className="rounded-md border border-slate-300 px-3 py-2 text-sm"
                              />
                            </div>
                            <div className="grid gap-1 md:col-span-3">
                              <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                                Template name
                              </label>
                              <input
                                name="name"
                                defaultValue={selectedTaskTemplate.name}
                                className="rounded-md border border-slate-300 px-3 py-2 text-sm"
                                required
                              />
                            </div>
                            <div className="grid gap-1 md:col-span-4">
                              <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                                Template notes
                              </label>
                              <textarea
                                name="description"
                                defaultValue={selectedTaskTemplate.description || ""}
                                rows={4}
                                className="rounded-md border border-slate-300 px-3 py-2 text-sm"
                              />
                            </div>
                            <button
                              type="submit"
                              className="md:col-span-4 rounded-md btn-primary px-4 py-2 text-sm font-semibold text-white"
                              disabled={Boolean(taskTemplateAssigneesError)}
                            >
                              Save task
                            </button>
                          </form>

                          <div className="mt-6 rounded-md border border-slate-200 bg-slate-50 p-3">
                            <p className="text-sm font-semibold text-slate-900">
                              Linked project templates
                            </p>

                            {projectTemplateTasksError &&
                            isSupabaseMissingTableError(projectTemplateTasksError) ? (
                              <p className="mt-2 text-sm text-amber-900">
                                Project template links are not set up yet. Run `sql/templates.sql`
                                in Supabase SQL editor, then refresh this page.
                              </p>
                            ) : null}

                            <div className="mt-3 space-y-2">
                              {selectedTaskTemplateProjectLinks.length ? (
                                selectedTaskTemplateProjectLinks.map((link) => {
                                  const projectTpl = projectTemplateById[link.project_template_id];
                                  const label = projectTpl?.name || link.project_template_id;
                                  return (
                                    <div
                                      key={link.id}
                                      className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm"
                                    >
                                      <div className="min-w-0">
                                        <p className="truncate font-semibold text-slate-900">
                                          {label}
                                        </p>
                                        <p className="text-xs text-slate-500">
                                          Position {link.position} in project template
                                        </p>
                                      </div>
                                      <form action={removeProjectTemplateTask}>
                                        <input type="hidden" name="id" value={link.id} />
                                        <input
                                          type="hidden"
                                          name="project_template_id"
                                          value={link.project_template_id}
                                        />
                                        <input
                                          type="hidden"
                                          name="return_templates_tab"
                                          value="tasks"
                                        />
                                        <input
                                          type="hidden"
                                          name="return_task_template_id"
                                          value={selectedTaskTemplate.id}
                                        />
                                        <ConfirmSubmitButton
                                          className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700 hover:bg-red-100"
                                          confirmText={`Remove ${selectedTaskTemplate.name} from ${label}?`}
                                          pendingLabel="Removing..."
                                          disabled={Boolean(projectTemplateTasksError)}
                                        >
                                          Remove
                                        </ConfirmSubmitButton>
                                      </form>
                                    </div>
                                  );
                                })
                              ) : (
                                <p className="text-sm text-slate-600">
                                  No project templates linked yet.
                                </p>
                              )}
                            </div>

                            <form
                              action={addProjectTemplateTask}
                              className="mt-3 grid gap-2 md:grid-cols-6"
                            >
                              <input
                                type="hidden"
                                name="task_template_id"
                                value={selectedTaskTemplate.id}
                              />
                              <input type="hidden" name="return_templates_tab" value="tasks" />
                              <input
                                type="hidden"
                                name="return_task_template_id"
                                value={selectedTaskTemplate.id}
                              />
                              <select
                                name="project_template_id"
                                className="md:col-span-4 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
                                defaultValue=""
                                disabled={
                                  Boolean(projectTemplateTasksError) ||
                                  Boolean(projectTemplatesError) ||
                                  !availableProjectTemplatesForTaskTemplate.length
                                }
                                required
                              >
                                <option value="">Select a project template</option>
                                {availableProjectTemplatesForTaskTemplate.map((projectTpl) => (
                                  <option key={projectTpl.id} value={projectTpl.id}>
                                    {projectTpl.name}
                                  </option>
                                ))}
                              </select>
                              <button
                                type="submit"
                                className="md:col-span-2 rounded-md border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
                                disabled={
                                  Boolean(projectTemplateTasksError) ||
                                  Boolean(projectTemplatesError) ||
                                  !availableProjectTemplatesForTaskTemplate.length
                                }
                              >
                                Assign project
                              </button>
                            </form>
                            {!projectTemplatesError &&
                            !projectTemplateTasksError &&
                            projectTemplates.length > 0 &&
                            !availableProjectTemplatesForTaskTemplate.length ? (
                              <p className="mt-2 text-xs text-slate-500">
                                This task template is already linked to every project template.
                              </p>
                            ) : null}
                          </div>
                        </div>
                      </section>
                      ) : null}

                      {taskTemplatePanel === "custom-fields" ? (
                      <div className="mt-4 rounded-md border border-slate-200 bg-slate-50 p-3">
                        <p className="text-sm font-semibold text-slate-900">Template custom fields</p>
                        <form action={createTemplateCustomField} className="mt-2 grid gap-2 md:grid-cols-12">
                          <input type="hidden" name="entity_type" value="task_template" />
                          <input type="hidden" name="entity_id" value={selectedTaskTemplate.id} />
                          <input
                            name="label"
                            placeholder="Field label"
                            className="md:col-span-5 rounded-md border border-slate-300 px-3 py-2 text-sm"
                            required
                          />
                          <select
                            name="field_kind"
                            defaultValue="text"
                            className="md:col-span-3 rounded-md border border-slate-300 px-3 py-2 text-sm"
                          >
                            <option value="text">Text</option>
                            <option value="dropdown">Dropdown</option>
                          </select>
                          <input
                            name="options_csv"
                            placeholder="Dropdown options (comma-separated)"
                            className="md:col-span-4 rounded-md border border-slate-300 px-3 py-2 text-sm"
                          />
                          <button
                            type="submit"
                            className="md:col-span-12 rounded-md border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
                          >
                            Add custom field
                          </button>
                        </form>
                        <form action={saveTemplateCustomFieldValues} className="mt-3 space-y-2">
                          <input type="hidden" name="entity_type" value="task_template" />
                          <input type="hidden" name="entity_id" value={selectedTaskTemplate.id} />
                          {selectedTaskTemplateCustomFields.length ? (
                            selectedTaskTemplateCustomFields.map((field) => (
                              <div
                                key={field.id}
                                className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm"
                              >
                                <div>
                                  <p className="font-semibold text-slate-900">{field.label}</p>
                                  <p className="text-xs text-slate-500">
                                    {field.field_kind === "dropdown" ? "Dropdown" : "Text"}
                                    {field.field_kind === "dropdown" &&
                                    (templateCustomFieldOptionsByFieldId[field.id] || []).length
                                      ? ` - ${(
                                          templateCustomFieldOptionsByFieldId[field.id] || []
                                        )
                                          .map((option) => option.value)
                                          .join(", ")}`
                                      : ""}
                                  </p>
                                  {field.field_kind === "dropdown" ? (
                                    <select
                                      name={`cf_${field.id}`}
                                      defaultValue={templateCustomFieldValueByFieldId.get(field.id) || ""}
                                      className="mt-2 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                                    >
                                      <option value="">Select...</option>
                                      {(templateCustomFieldOptionsByFieldId[field.id] || []).map((option) => (
                                        <option key={option.id} value={option.value}>
                                          {option.value}
                                        </option>
                                      ))}
                                    </select>
                                  ) : (
                                    <input
                                      name={`cf_${field.id}`}
                                      defaultValue={templateCustomFieldValueByFieldId.get(field.id) || ""}
                                      className="mt-2 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                                    />
                                  )}
                                </div>
                                <button
                                  type="submit"
                                  formAction={deleteTemplateCustomField}
                                  name="id"
                                  value={field.id}
                                  className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700 hover:bg-red-100"
                                >
                                  Delete
                                </button>
                              </div>
                            ))
                          ) : (
                            <p className="text-sm text-slate-600">No custom fields yet.</p>
                          )}
                          {selectedTaskTemplateCustomFields.length ? (
                            <div className="flex items-center justify-end">
                              <button
                                type="submit"
                                className="rounded-md border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
                              >
                                Save custom field values
                              </button>
                            </div>
                          ) : null}
                        </form>
                      </div>
                      ) : null}

                      {taskTemplatePanel === "subtasks" ? (
                      <div className="mt-6 rounded-md border border-slate-200 bg-slate-50 p-3">
                        <p className="text-sm font-semibold text-slate-900">Subtask templates</p>

                        {taskTemplateSubtasksError &&
                        isSupabaseMissingTableError(taskTemplateSubtasksError) ? (
                          <p className="mt-2 text-sm text-amber-900">
                            Subtasks are not set up yet. Run `sql/templates.sql` in Supabase SQL
                            editor, then refresh this page.
                          </p>
                        ) : null}
                        {taskTemplateSubtaskAssigneesError &&
                        isSupabaseMissingTableError(taskTemplateSubtaskAssigneesError) ? (
                          <p className="mt-2 text-sm text-amber-900">
                            Subtask assignees are not set up yet. Re-run `sql/templates.sql` in
                            Supabase SQL editor, then refresh this page.
                          </p>
                        ) : null}

                        <div className="mt-3">
                          {(subtasksByTemplateId[selectedTaskTemplate.id] || []).length ? (
                            <div className="overflow-x-auto rounded-md border border-slate-200 bg-white">
                              <table className="min-w-full text-left text-sm">
                                <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                                  <tr>
                                    <th className="px-3 py-2">#</th>
                                    <th className="px-3 py-2">Title</th>
                                    <th className="px-3 py-2">Status</th>
                                    <th className="px-3 py-2">Priority</th>
                                    <th className="px-3 py-2">Assignees</th>
                                    <th className="px-3 py-2">Actions</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-200">
                                  {(subtasksByTemplateId[selectedTaskTemplate.id] || []).map(
                                    (subtask) => {
                                      const rowFormId = `task-template-subtask-${subtask.id}-edit`;
                                      return (
                                        <tr key={subtask.id}>
                                          <td className="px-3 py-2 text-slate-500">{subtask.position}</td>
                                          <td className="px-3 py-2">
                                            <input type="hidden" name="id" value={subtask.id} form={rowFormId} />
                                            <input
                                              type="hidden"
                                              name="task_template_id"
                                              value={selectedTaskTemplate.id}
                                              form={rowFormId}
                                            />
                                            <input
                                              name="title"
                                              defaultValue={subtask.title}
                                              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                                              disabled={Boolean(taskTemplateSubtasksError)}
                                              form={rowFormId}
                                              required
                                            />
                                            <input
                                              name="description"
                                              defaultValue={subtask.description || ""}
                                              className="mt-2 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                                              placeholder="Description (optional)"
                                              disabled={Boolean(taskTemplateSubtasksError)}
                                              form={rowFormId}
                                            />
                                          </td>
                                          <td className="px-3 py-2 align-top">
                                            <select
                                              name="status"
                                              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                                              defaultValue={subtask.status || "to_do"}
                                              disabled={Boolean(taskTemplateSubtasksError)}
                                              form={rowFormId}
                                            >
                                              {taskStatusOptions.map((status) => (
                                                <option key={status} value={status}>
                                                  {status.replace("_", " ")}
                                                </option>
                                              ))}
                                            </select>
                                          </td>
                                          <td className="px-3 py-2 align-top">
                                            <select
                                              name="priority"
                                              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                                              defaultValue={subtask.priority || "medium"}
                                              disabled={Boolean(taskTemplateSubtasksError)}
                                              form={rowFormId}
                                            >
                                              {["low", "medium", "high", "critical"].map((priority) => (
                                                <option key={priority} value={priority}>
                                                  {priority}
                                                </option>
                                              ))}
                                            </select>
                                          </td>
                                          <td className="px-3 py-2 align-top">
                                            <div className="relative min-w-[220px]">
                                              <AssigneeMultiSelect
                                                users={users}
                                                groups={assignmentGroupOptions}
                                                name="assignee_user_ids"
                                                form={rowFormId}
                                                defaultSelected={
                                                  assigneeIdsByTaskTemplateSubtaskId[subtask.id] || []
                                                }
                                              />
                                            </div>
                                          </td>
                                          <td className="px-3 py-2 align-top">
                                            <div className="flex gap-2">
                                              <form id={rowFormId} action={updateTaskTemplateSubtask}>
                                                <button
                                                  type="submit"
                                                  className="rounded-md border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                                                  disabled={Boolean(taskTemplateSubtasksError)}
                                                >
                                                  Save
                                                </button>
                                              </form>
                                              <form action={deleteTaskTemplateSubtask}>
                                                <input type="hidden" name="id" value={subtask.id} />
                                                <input
                                                  type="hidden"
                                                  name="task_template_id"
                                                  value={selectedTaskTemplate.id}
                                                />
                                                <ConfirmSubmitButton
                                                  className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700 hover:bg-red-100"
                                                  confirmText={`Delete subtask: ${subtask.title}?`}
                                                  pendingLabel="Deleting..."
                                                  disabled={Boolean(taskTemplateSubtasksError)}
                                                >
                                                  Delete
                                                </ConfirmSubmitButton>
                                              </form>
                                            </div>
                                          </td>
                                        </tr>
                                      );
                                    }
                                  )}
                                </tbody>
                              </table>
                            </div>
                          ) : (
                            <p className="text-sm text-slate-600">No subtasks yet.</p>
                          )}
                        </div>

                        <form
                          action={createTaskTemplateSubtask}
                          className="mt-3 grid gap-2 md:grid-cols-6"
                        >
                          <input
                            type="hidden"
                            name="task_template_id"
                            value={selectedTaskTemplate.id}
                          />
                          <input
                            name="title"
                            placeholder="Subtask title"
                            className="md:col-span-2 rounded-md border border-slate-300 px-3 py-2 text-sm"
                            disabled={Boolean(taskTemplateSubtasksError)}
                            required
                          />
                          <select
                            name="status"
                            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
                            defaultValue="to_do"
                            disabled={Boolean(taskTemplateSubtasksError)}
                          >
                            {taskStatusOptions.map(
                              (status) => (
                                <option key={status} value={status}>
                                  {status.replace("_", " ")}
                                </option>
                              )
                            )}
                          </select>
                          <select
                            name="priority"
                            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
                            defaultValue="medium"
                            disabled={Boolean(taskTemplateSubtasksError)}
                          >
                            {["low", "medium", "high", "critical"].map((priority) => (
                              <option key={priority} value={priority}>
                                {priority}
                              </option>
                            ))}
                          </select>
                          <input
                            name="description"
                            placeholder="Description (optional)"
                            className="md:col-span-2 rounded-md border border-slate-300 px-3 py-2 text-sm"
                            disabled={Boolean(taskTemplateSubtasksError)}
                          />
                          <div className="md:col-span-6 relative">
                            <AssigneeMultiSelect
                              users={users}
                              groups={assignmentGroupOptions}
                              name="assignee_user_ids"
                            />
                          </div>
                          <button
                            type="submit"
                            className="md:col-span-6 rounded-md border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
                            disabled={Boolean(taskTemplateSubtasksError)}
                          >
                            Add subtask template
                          </button>
                        </form>
                      </div>
                      ) : null}
                    </section>
                  ) : (
                    <p className="text-sm text-slate-600">Click a task template in the table to view it.</p>
                  )}
                </section>
              </div>
            ) : null}

            {templatesTab === "projects" ? (
              <div className="space-y-6">
                <section className="rounded-md border border-slate-200 bg-slate-50 p-4">
                  <h3 className="text-sm font-semibold text-slate-900">
                    Create project template
                  </h3>
                  <form action={createProjectTemplate} className="mt-3 grid gap-3 md:grid-cols-6">
                    <input
                      name="name"
                      placeholder="Template name"
                      className="md:col-span-2 rounded-md border border-slate-300 px-3 py-2 text-sm"
                      required
                    />
                    <select
                      name="status"
                      className="md:col-span-2 rounded-md border border-slate-300 px-3 py-2 text-sm"
                      defaultValue="planned"
                    >
                      {projectStatusOptions.map((status) => (
                        <option key={status} value={status}>
                          {status.replace("_", " ")}
                        </option>
                      ))}
                    </select>
                    <textarea
                      name="description"
                      placeholder="Template notes (optional)"
                      rows={3}
                      className="md:col-span-2 rounded-md border border-slate-300 px-3 py-2 text-sm"
                    />
                    <button
                      type="submit"
                      className="md:col-span-6 rounded-md btn-primary px-4 py-2 text-sm font-semibold text-white"
                      disabled={Boolean(projectTemplatesError)}
                    >
                      Create template
                    </button>
                  </form>
                </section>
                <section className="space-y-3">
                  <h3 className="text-sm font-semibold text-slate-900">Existing project templates</h3>

                  {!projectTemplates.length ? (
                    <p className="text-sm text-slate-600">No templates yet.</p>
                  ) : (
                    <div className="rounded-lg border border-slate-200 bg-white">
                      <div className="overflow-x-auto">
                        <table className="min-w-full text-left text-sm">
                          <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                            <tr>
                              <th className="px-6 py-3">Template</th>
                              <th className="px-6 py-3">Status</th>
                              <th className="px-6 py-3">Linked task templates</th>
                              <th className="px-6 py-3">Description</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-200">
                            {projectTemplates.map((tpl) => {
                              const isSelected = tpl.id === selectedProjectTemplateId;
                              const linkedCount = (tasksByProjectTemplateId[tpl.id] || []).length;
                              return (
                                <tr
                                  key={tpl.id}
                                  className={isSelected ? "bg-slate-50" : "hover:bg-slate-50"}
                                >
                                  <td className="px-6 py-3 font-semibold text-slate-900">
                                    <a
                                      className="underline-offset-2 hover:underline"
                                      href={`/settings?tab=templates&templates=projects&project_template_id=${encodeURIComponent(
                                        tpl.id
                                      )}`}
                                    >
                                      {tpl.name}
                                    </a>
                                  </td>
                                  <td className="px-6 py-3 text-slate-700">
                                    {tpl.status?.replace("_", " ")}
                                  </td>
                                  <td className="px-6 py-3 text-slate-700">{linkedCount}</td>
                                  <td className="px-6 py-3 text-slate-700">{tpl.description || ""}</td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {selectedProjectTemplate ? (
                    <section className="space-y-4 rounded-lg border border-slate-200 bg-white p-6">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm font-semibold uppercase tracking-wide text-slate-500">
                            Project template
                          </p>
                          <h4 className="truncate text-3xl font-semibold text-slate-900">
                            {selectedProjectTemplate.name}
                          </h4>
                        </div>
                        <div className="flex items-center gap-2">
                          <a
                            href="/settings?tab=templates&templates=projects"
                            className="rounded-md border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
                          >
                            Back to templates
                          </a>
                          <form action={deleteProjectTemplate} className="shrink-0">
                            <input type="hidden" name="id" value={selectedProjectTemplate.id} />
                            <ConfirmSubmitButton
                              className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700 hover:bg-red-100"
                              confirmText={`Delete template: ${selectedProjectTemplate.name}?`}
                              pendingLabel="Deleting..."
                            >
                              Delete
                            </ConfirmSubmitButton>
                          </form>
                        </div>
                      </div>

                      <nav className="mt-4 flex flex-wrap gap-2 border-b border-slate-200 pb-3 text-sm">
                        <a
                          href={`/settings?tab=templates&templates=projects&project_template_id=${encodeURIComponent(
                            selectedProjectTemplate.id
                          )}&project_template_panel=details`}
                          className={`rounded-md px-3 py-1.5 font-medium ${
                            projectTemplatePanel === "details"
                              ? "tab-active"
                              : "border border-slate-200 text-slate-700 hover:bg-slate-100 hover:text-slate-900"
                          }`}
                        >
                          Details
                        </a>
                        <a
                          href={`/settings?tab=templates&templates=projects&project_template_id=${encodeURIComponent(
                            selectedProjectTemplate.id
                          )}&project_template_panel=custom-fields`}
                          className={`rounded-md px-3 py-1.5 font-medium ${
                            projectTemplatePanel === "custom-fields"
                              ? "tab-active"
                              : "border border-slate-200 text-slate-700 hover:bg-slate-100 hover:text-slate-900"
                          }`}
                        >
                          Custom fields
                        </a>
                        <a
                          href={`/settings?tab=templates&templates=projects&project_template_id=${encodeURIComponent(
                            selectedProjectTemplate.id
                          )}&project_template_panel=tasks`}
                          className={`rounded-md px-3 py-1.5 font-medium ${
                            projectTemplatePanel === "tasks"
                              ? "tab-active"
                              : "border border-slate-200 text-slate-700 hover:bg-slate-100 hover:text-slate-900"
                          }`}
                        >
                          Template tasks
                        </a>
                      </nav>

                      {projectTemplatePanel === "details" ? (
                      <form action={updateProjectTemplate} className="mt-4 grid gap-3 md:grid-cols-6">
                        <input type="hidden" name="id" value={selectedProjectTemplate.id} />
                        <input
                          name="name"
                          defaultValue={selectedProjectTemplate.name}
                          className="md:col-span-2 rounded-md border border-slate-300 px-3 py-2 text-sm"
                          required
                        />
                        <select
                          name="status"
                          className="md:col-span-2 rounded-md border border-slate-300 px-3 py-2 text-sm"
                          defaultValue={selectedProjectTemplate.status || "planned"}
                        >
                          {projectStatusOptions.map(
                            (status) => (
                              <option key={status} value={status}>
                                {status.replace("_", " ")}
                              </option>
                            )
                          )}
                        </select>
                        <div className="md:col-span-2 grid gap-1">
                          <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                            Template notes
                          </label>
                          <textarea
                            name="description"
                            defaultValue={selectedProjectTemplate.description || ""}
                            rows={4}
                            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
                          />
                        </div>
                        <div className="md:col-span-6 flex items-center justify-end">
                          <button
                            type="submit"
                            className="rounded-md border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
                          >
                            Save
                          </button>
                        </div>
                      </form>
                      ) : null}

                      {projectTemplatePanel === "custom-fields" ? (
                      <div className="mt-4 rounded-md border border-slate-200 bg-slate-50 p-3">
                        <p className="text-sm font-semibold text-slate-900">Template custom fields</p>
                        <form action={createTemplateCustomField} className="mt-2 grid gap-2 md:grid-cols-12">
                          <input type="hidden" name="entity_type" value="project_template" />
                          <input type="hidden" name="entity_id" value={selectedProjectTemplate.id} />
                          <input
                            name="label"
                            placeholder="Field label"
                            className="md:col-span-5 rounded-md border border-slate-300 px-3 py-2 text-sm"
                            required
                          />
                          <select
                            name="field_kind"
                            defaultValue="text"
                            className="md:col-span-3 rounded-md border border-slate-300 px-3 py-2 text-sm"
                          >
                            <option value="text">Text</option>
                            <option value="dropdown">Dropdown</option>
                          </select>
                          <input
                            name="options_csv"
                            placeholder="Dropdown options (comma-separated)"
                            className="md:col-span-4 rounded-md border border-slate-300 px-3 py-2 text-sm"
                          />
                          <button
                            type="submit"
                            className="md:col-span-12 rounded-md border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
                          >
                            Add custom field
                          </button>
                        </form>
                        <form action={saveTemplateCustomFieldValues} className="mt-3 space-y-2">
                          <input type="hidden" name="entity_type" value="project_template" />
                          <input type="hidden" name="entity_id" value={selectedProjectTemplate.id} />
                          {selectedProjectTemplateCustomFields.length ? (
                            selectedProjectTemplateCustomFields.map((field) => (
                              <div
                                key={field.id}
                                className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm"
                              >
                                <div>
                                  <p className="font-semibold text-slate-900">{field.label}</p>
                                  <p className="text-xs text-slate-500">
                                    {field.field_kind === "dropdown" ? "Dropdown" : "Text"}
                                    {field.field_kind === "dropdown" &&
                                    (templateCustomFieldOptionsByFieldId[field.id] || []).length
                                      ? ` - ${(
                                          templateCustomFieldOptionsByFieldId[field.id] || []
                                        )
                                          .map((option) => option.value)
                                          .join(", ")}`
                                      : ""}
                                  </p>
                                  {field.field_kind === "dropdown" ? (
                                    <select
                                      name={`cf_${field.id}`}
                                      defaultValue={templateCustomFieldValueByFieldId.get(field.id) || ""}
                                      className="mt-2 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                                    >
                                      <option value="">Select...</option>
                                      {(templateCustomFieldOptionsByFieldId[field.id] || []).map((option) => (
                                        <option key={option.id} value={option.value}>
                                          {option.value}
                                        </option>
                                      ))}
                                    </select>
                                  ) : (
                                    <input
                                      name={`cf_${field.id}`}
                                      defaultValue={templateCustomFieldValueByFieldId.get(field.id) || ""}
                                      className="mt-2 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                                    />
                                  )}
                                </div>
                                <button
                                  type="submit"
                                  formAction={deleteTemplateCustomField}
                                  name="id"
                                  value={field.id}
                                  className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700 hover:bg-red-100"
                                >
                                  Delete
                                </button>
                              </div>
                            ))
                          ) : (
                            <p className="text-sm text-slate-600">No custom fields yet.</p>
                          )}
                          {selectedProjectTemplateCustomFields.length ? (
                            <div className="flex items-center justify-end">
                              <button
                                type="submit"
                                className="rounded-md border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
                              >
                                Save custom field values
                              </button>
                            </div>
                          ) : null}
                        </form>
                      </div>
                      ) : null}

                      {projectTemplatePanel === "tasks" ? (
                      <div className="mt-6 rounded-md border border-slate-200 bg-slate-50 p-3">
                        <p className="text-sm font-semibold text-slate-900">Template tasks</p>

                        {projectTemplateTasksError &&
                        isSupabaseMissingTableError(projectTemplateTasksError) ? (
                          <p className="mt-2 text-sm text-amber-900">
                            Project template tasks are not set up yet. Run `sql/templates.sql` in
                            Supabase SQL editor, then refresh this page.
                          </p>
                        ) : null}

                        <div className="mt-3 space-y-2">
                          {(tasksByProjectTemplateId[selectedProjectTemplate.id] || []).length ? (
                            (tasksByProjectTemplateId[selectedProjectTemplate.id] || []).map((link) => {
                              const taskTpl = taskTemplateById[link.task_template_id];
                              const label = taskTpl?.name || link.task_template_id;
                              const title = taskTpl?.title ? ` (${taskTpl.title})` : "";
                              return (
                                <div
                                  key={link.id}
                                  className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm"
                                >
                                  <div className="min-w-0">
                                    <p className="truncate font-semibold text-slate-900">
                                      {link.position}. {label}
                                      {title}
                                    </p>
                                  </div>
                                  <form action={removeProjectTemplateTask}>
                                    <input type="hidden" name="id" value={link.id} />
                                    <input
                                      type="hidden"
                                      name="project_template_id"
                                      value={selectedProjectTemplate.id}
                                    />
                                    <ConfirmSubmitButton
                                      className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700 hover:bg-red-100"
                                      confirmText={`Remove ${label} from ${selectedProjectTemplate.name}?`}
                                      pendingLabel="Removing..."
                                      disabled={Boolean(projectTemplateTasksError)}
                                    >
                                      Remove
                                    </ConfirmSubmitButton>
                                  </form>
                                </div>
                              );
                            })
                          ) : (
                            <p className="text-sm text-slate-600">No task templates linked yet.</p>
                          )}
                        </div>

                        <form action={addProjectTemplateTask} className="mt-3 grid gap-2 md:grid-cols-6">
                          <input
                            type="hidden"
                            name="project_template_id"
                            value={selectedProjectTemplate.id}
                          />
                          <select
                            name="task_template_id"
                            className="md:col-span-4 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
                            defaultValue=""
                            disabled={
                              Boolean(projectTemplateTasksError) ||
                              Boolean(taskTemplatesError) ||
                              !taskTemplates.length
                            }
                            required
                          >
                            <option value="">Select a task template</option>
                            {taskTemplates.map((taskTpl) => (
                              <option key={taskTpl.id} value={taskTpl.id}>
                                {taskTpl.name}
                              </option>
                            ))}
                          </select>
                          <button
                            type="submit"
                            className="md:col-span-2 rounded-md border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
                            disabled={
                              Boolean(projectTemplateTasksError) ||
                              Boolean(taskTemplatesError) ||
                              !taskTemplates.length
                            }
                          >
                            Add task
                          </button>
                        </form>
                      </div>
                      ) : null}
                    </section>
                  ) : (
                    <p className="text-sm text-slate-600">Click a project template in the table to view it.</p>
                  )}
                </section>
              </div>
            ) : null}
          </div>
        </section>
      ) : null}
    </div>
  );
}


