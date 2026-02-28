import Link from "next/link";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { randomBytes } from "crypto";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { DEFAULT_EDITOR_CONTENT } from "@/lib/editorContent";
import { extractPlainText } from "@/lib/tiptapText";
import { normalizeTaskStatusOrDefault } from "@/lib/taskStatus";
import {
  loadAssignmentGroups,
  resolveAssignmentTargetsToUserIds,
} from "@/lib/assignmentGroups";
import {
  isSupabaseMissingFunctionError,
  isSupabaseMissingTableError,
} from "@/lib/supabaseErrors";
import FormSubmissionBuilder from "../FormSubmissionBuilder";
import FormConfigureAutosave from "../FormConfigureAutosave";
import FormAccessPopover from "../FormAccessPopover";
import FormShareLinksPopover from "../FormShareLinksPopover";
import {
  formatSubmissionValue,
  shortQuestionLabel,
  type SubmissionTableField,
} from "../formSubmissionTableUtils";
import {
  buildFieldKey,
  doesFormFieldVisibilityMatch,
  ensureUniqueFormFieldKeys,
  formatFormLabel,
  normalizeFormActionPriority,
  normalizeFormAccessLevel,
  normalizeFormFieldMetadata,
  normalizeFormFieldVisibility,
  normalizeFormFieldType,
  normalizeFormStatus,
  renderTemplate,
  validateFormFieldValue,
  type FormAccessAssignment,
  type FormField,
} from "../types";

type FormDetailTabKey = "submissions" | "configure" | "create_submission";
type SubmissionScope = "completed" | "open" | "all";
type SubmissionSortKey = "created_at" | "status" | "submitted_by";
type SubmissionSortDir = "asc" | "desc";

function normalizeFormDetailTabKey(value: string | null | undefined): FormDetailTabKey {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  if (normalized === "configure" || normalized === "create_submission") return normalized;
  return "submissions";
}

function normalizeSubmissionScope(value: string | null | undefined): SubmissionScope {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  if (normalized === "completed" || normalized === "open") return normalized;
  return "all";
}

function normalizeSubmissionSortKey(value: string | null | undefined): SubmissionSortKey {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  if (normalized === "status" || normalized === "submitted_by") return normalized;
  return "created_at";
}

function normalizeSubmissionSortDir(value: string | null | undefined): SubmissionSortDir {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  if (normalized === "asc") return "asc";
  return "desc";
}

function formStatusBadgeClass(status: ReturnType<typeof normalizeFormStatus>) {
  if (status === "active") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (status === "draft") return "border-amber-200 bg-amber-50 text-amber-700";
  return "border-slate-200 bg-slate-50 text-slate-600";
}

function parseFields(value: unknown): FormField[] {
  if (!Array.isArray(value)) return [];
  const fields = value
    .map((item, index) => {
      if (!item || typeof item !== "object") return null;
      const row = item as Record<string, unknown>;
      const key = buildFieldKey(String(row.key || ""), `field_${index + 1}`);
      if (!key) return null;
      const visibility = normalizeFormFieldVisibility(row);
      const metadata = normalizeFormFieldMetadata(row);
      return {
        id: String(row.id || `field_${index + 1}`),
        key,
        label: String(row.label || key),
        type: normalizeFormFieldType(String(row.type || "text")),
        required: Boolean(row.required),
        options: Array.isArray(row.options)
          ? row.options.map((entry) => String(entry || "").trim()).filter(Boolean)
          : [],
        placeholder: metadata.placeholder,
        helpText: metadata.helpText,
        minValue: metadata.minValue,
        maxValue: metadata.maxValue,
        pattern: metadata.pattern,
        conditionMode: visibility.conditionMode,
        conditions: visibility.conditions,
        condition: visibility.condition,
      } satisfies FormField;
    })
    .filter(Boolean) as FormField[];

  return ensureUniqueFormFieldKeys(fields);
}

function parseFieldsJson(raw: string): FormField[] {
  try {
    return parseFields(JSON.parse(raw));
  } catch {
    return [];
  }
}

function parseTaskTemplateIdsJson(raw: string): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return Array.from(
    new Set(parsed.map((item) => String(item || "").trim()).filter(Boolean))
  );
}

function parseFormAccessAssignmentsJson(raw: string): FormAccessAssignment[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const seen = new Set<string>();
  return parsed
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const row = item as Record<string, unknown>;
      const userId = String(row.user_id || "").trim();
      if (!userId) return null;
      return {
        user_id: userId,
        access_level: normalizeFormAccessLevel(String(row.access_level || "view")),
      } satisfies FormAccessAssignment;
    })
    .filter((row): row is FormAccessAssignment => Boolean(row))
    .filter((row) => {
      if (seen.has(row.user_id)) return false;
      seen.add(row.user_id);
      return true;
    });
}

async function resolveFormAccessAssignments(
  supabase: ReturnType<typeof createSupabaseServerClient>,
  assignments: FormAccessAssignment[]
) {
  const resolvedByUserId = new Map<string, FormAccessAssignment["access_level"]>();

  for (const assignment of assignments) {
    const resolution = await resolveAssignmentTargetsToUserIds(supabase, [assignment.user_id]);
    if (resolution.error) {
      return { assignments: [] as FormAccessAssignment[], error: resolution.error };
    }
    for (const userId of resolution.userIds) {
      if (!resolvedByUserId.has(userId)) {
        resolvedByUserId.set(userId, assignment.access_level);
      }
    }
  }

  return {
    assignments: Array.from(resolvedByUserId.entries()).map(([user_id, access_level]) => ({
      user_id,
      access_level,
    })),
    error: null as string | null,
  };
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

type ManualTask = {
  id: string;
  title: string;
  description: string;
};

type FormShareLinkRow = {
  id: string;
  token: string;
  access_mode: "public" | "authenticated";
  is_active: boolean;
  created_at: string;
  last_used_at: string | null;
  expires_at: string | null;
};

function normalizeFormShareLinkAccessMode(value: string | null | undefined): "public" | "authenticated" {
  return String(value || "").trim().toLowerCase() === "authenticated"
    ? "authenticated"
    : "public";
}

function normalizeAppBaseUrl(value: string | null | undefined) {
  const normalized = String(value || "").trim();
  if (!normalized) return "";
  const withoutTrailingSlash = normalized.replace(/\/+$/, "");
  if (
    withoutTrailingSlash.startsWith("http://") ||
    withoutTrailingSlash.startsWith("https://")
  ) {
    return withoutTrailingSlash;
  }
  return `https://${withoutTrailingSlash}`;
}

function fieldShouldBeIncluded(field: FormField, values: Record<string, string>) {
  return doesFormFieldVisibilityMatch(field, values);
}

export default async function FormDetailPage(props: {
  params: Promise<{ formId: string }>;
  searchParams?: Promise<{
    return_to?: string;
    error?: string;
    success?: string;
    tab?: string;
    scope?: string;
    sort?: string;
    dir?: string;
  }>;
}) {
  const { formId } = await props.params;
  const searchParams = await props.searchParams;
  const returnToRaw = String(searchParams?.return_to || "").trim();
  const returnTo = returnToRaw.startsWith("/forms") ? returnToRaw : "/forms";
  const activeTab = normalizeFormDetailTabKey(searchParams?.tab);
  const submissionScope = normalizeSubmissionScope(searchParams?.scope);
  const submissionSortKey = normalizeSubmissionSortKey(searchParams?.sort);
  const submissionSortDir = normalizeSubmissionSortDir(searchParams?.dir);

  const supabase = createSupabaseServerClient();
  const { data: authData } = await supabase.auth.getUser();
  const authEmail = authData.user?.email;
  if (!authEmail) {
    redirect("/login");
  }

  const { data: currentUser } = await supabase
    .from("users")
    .select("id,role")
    .eq("email", authEmail)
    .maybeSingle();
  if (!currentUser?.id) {
    redirect("/tasks?error=Missing%20user%20profile");
  }

  const { data: form, error: formError } = await supabase
    .from("forms")
    .select("id,title,description,status,fields,created_by,created_at,updated_at")
    .eq("id", formId)
    .maybeSingle();
  if (formError) {
    notFound();
  }
  if (!form) {
    notFound();
  }

  let canManageForm = true;
  let formPermissionErrorMessage: string | null = null;
  const canManageFormResult = await supabase.rpc("can_manage_form", {
    form_uuid: formId,
  });
  if (isSupabaseMissingFunctionError(canManageFormResult.error)) {
    canManageForm = true;
  } else if (canManageFormResult.error) {
    canManageForm = false;
    formPermissionErrorMessage = `Could not verify form edit permission (${canManageFormResult.error.message}).`;
  } else {
    canManageForm = Boolean(canManageFormResult.data);
  }

  const formFields = parseFields(form.fields);

  const [
    { data: templateLinksRaw, error: templateLinksError },
    { data: submissionsRaw },
    { data: taskTemplatesRaw, error: taskTemplatesError },
    { data: manualActionsRaw, error: manualActionsError },
    { data: formAccessRowsRaw, error: formAccessRowsError },
    { data: workspaceUsersRaw, error: workspaceUsersError },
  ] = await Promise.all([
    supabase
      .from("form_submission_task_templates")
      .select("id,task_template_id,enabled,position")
      .eq("form_id", formId)
      .order("position", { ascending: true })
      .order("created_at", { ascending: true }),
    supabase
      .from("form_submissions")
      .select("id,status,submitted_by,created_at,values_json")
      .eq("form_id", formId)
      .order("created_at", { ascending: false }),
    supabase.from("task_templates").select("id,name,title").order("name", { ascending: true }),
    supabase
      .from("form_submission_actions")
      .select("id,task_title_template,task_description_template,enabled,position")
      .eq("form_id", formId)
      .eq("enabled", true)
      .order("position", { ascending: true })
      .order("created_at", { ascending: true }),
    supabase
      .from("form_user_permissions")
      .select("user_id,access_level")
      .eq("form_id", formId),
    supabase.from("users").select("id,full_name,email").order("full_name", { ascending: true }),
  ]);

  const taskTemplateLinks = (templateLinksError
    ? []
    : templateLinksRaw || []) as Array<{
    id: string;
    task_template_id: string;
    enabled: boolean | null;
    position: number | null;
  }>;
  const selectedTaskTemplateIds = taskTemplateLinks
    .filter((row) => row.enabled !== false)
    .map((row) => row.task_template_id)
    .filter(Boolean);
  const taskTemplates = (taskTemplatesError ? [] : taskTemplatesRaw || []) as Array<{
    id: string;
    name: string;
    title: string;
  }>;
  const manualTasks = (manualActionsError ? [] : manualActionsRaw || []).map((row, index) => ({
    id: String((row as { id?: string }).id || `manual_${index + 1}`),
    title: String((row as { task_title_template?: string }).task_title_template || "").trim(),
    description: String(
      (row as { task_description_template?: string | null }).task_description_template || ""
    ).trim(),
  })).filter((row) => row.title) as ManualTask[];

  const formAccessSchemaMissing = isSupabaseMissingTableError(formAccessRowsError);
  const formAccessAssignments = (
    formAccessSchemaMissing ? [] : formAccessRowsRaw || []
  ).map((row) => ({
    user_id: String((row as { user_id?: string | null }).user_id || "").trim(),
    access_level: normalizeFormAccessLevel(
      String((row as { access_level?: string | null }).access_level || "view")
    ),
  })).filter((row) => row.user_id) as FormAccessAssignment[];

  const workspaceUserOptions = ((workspaceUsersError ? [] : workspaceUsersRaw || []) as Array<{
    id: string;
    full_name: string | null;
    email: string | null;
  }>)
    .map((user) => ({
      id: String(user.id || "").trim(),
      label: String(user.full_name || "").trim() || String(user.email || "").trim(),
      secondaryLabel: String(user.email || "").trim(),
    }))
    .filter((user) => user.id && user.label);
  const assignmentGroupsResult = await loadAssignmentGroups(supabase);
  const assignmentGroupOptions = assignmentGroupsResult.groups.map((group) => ({
    id: group.id,
    name: group.name,
    memberCount: group.memberCount,
  }));

  const submissions = (submissionsRaw || []) as Array<{
    id: string;
    status: string | null;
    submitted_by: string | null;
    created_at: string;
    values_json: Record<string, unknown> | null;
  }>;

  const questionColumns = formFields.map((field) => ({
    key: field.key,
    label: String(field.label || formatFormLabel(field.key)),
    type: field.type,
  })) as SubmissionTableField[];

  const submissionUserIds = Array.from(
    new Set(submissions.map((submission) => submission.submitted_by).filter(Boolean))
  ) as string[];
  const { data: users } = submissionUserIds.length
    ? await supabase
        .from("users")
        .select("id,full_name,email")
        .in("id", submissionUserIds)
    : {
        data: [] as Array<{ id: string; full_name: string | null; email: string | null }>,
      };

  const userMap = new Map<string, string>();
  (users || []).forEach((user) => {
    userMap.set(user.id, user.full_name || user.email || "Unknown user");
  });

  const headerList = await headers();
  const forwardedHost = headerList.get("x-forwarded-host");
  const forwardedProto = headerList.get("x-forwarded-proto");
  const host = forwardedHost || headerList.get("host");
  const appBaseUrlFromHeaders = host
    ? `${forwardedProto || "https"}://${host}`
    : "";
  const appBaseUrl = normalizeAppBaseUrl(
    process.env.NEXT_PUBLIC_SITE_URL ||
      process.env.NEXT_PUBLIC_VERCEL_URL ||
      appBaseUrlFromHeaders
  );

  const {
    data: formShareLinksRaw,
    error: formShareLinksError,
  } = await supabase
    .from("form_share_links")
    .select("id,token,access_mode,is_active,created_at,last_used_at,expires_at")
    .eq("form_id", formId)
    .order("created_at", { ascending: false });

  const formShareLinksSchemaMissing = isSupabaseMissingTableError(formShareLinksError);
  const formShareLinksLoadErrorMessage =
    formShareLinksError && !formShareLinksSchemaMissing
      ? `Could not load form share links (${formShareLinksError.message}).`
      : null;
  const formShareLinks = (
    formShareLinksSchemaMissing ? [] : formShareLinksRaw || []
  )
    .map((row) => ({
      id: String((row as { id?: string | null }).id || "").trim(),
      token: String((row as { token?: string | null }).token || "").trim(),
      access_mode: normalizeFormShareLinkAccessMode(
        String((row as { access_mode?: string | null }).access_mode || "public")
      ),
      is_active: Boolean((row as { is_active?: boolean | null }).is_active !== false),
      created_at: String((row as { created_at?: string | null }).created_at || ""),
      last_used_at:
        ((row as { last_used_at?: string | null }).last_used_at as string | null) || null,
      expires_at:
        ((row as { expires_at?: string | null }).expires_at as string | null) || null,
    }))
    .filter((row) => row.id && row.token) as FormShareLinkRow[];

  const detailPath = `/forms/${formId}`;
  const buildDetailUrl = (
    tab: FormDetailTabKey,
    scope = submissionScope,
    sortKey = submissionSortKey,
    sortDir = submissionSortDir,
    extra?: { error?: string; success?: string }
  ) => {
    const sp = new URLSearchParams();
    sp.set("return_to", returnTo);
    sp.set("tab", tab);
    if (tab === "submissions") {
      sp.set("scope", scope);
      sp.set("sort", sortKey);
      sp.set("dir", sortDir);
    }
    if (extra?.error) {
      sp.set("error", extra.error);
    }
    if (extra?.success) {
      sp.set("success", extra.success);
    }
    return `${detailPath}?${sp.toString()}`;
  };
  const tabUrls: Record<FormDetailTabKey, string> = {
    submissions: buildDetailUrl("submissions"),
    configure: buildDetailUrl("configure"),
    create_submission: buildDetailUrl("create_submission"),
  };
  const exportSubmissionsCsvUrl = `/forms/${formId}/export?${new URLSearchParams({
    scope: submissionScope,
    sort: submissionSortKey,
    dir: submissionSortDir,
  }).toString()}`;
  const canConfigureForm = canManageForm;
  const formStatus = normalizeFormStatus(form.status);
  const openSubmissionCount = submissions.filter((submission) => {
    const status = String(submission.status || "open");
    return status !== "completed" && status !== "rejected";
  }).length;

  const filteredSubmissions = submissions.filter((submission) => {
    const status = String(submission.status || "open");
    if (submissionScope === "all") return true;
    if (submissionScope === "open") {
      return status !== "completed" && status !== "rejected";
    }
    return status === "completed";
  });

  const sortedSubmissions = [...filteredSubmissions].sort((a, b) => {
    if (submissionSortKey === "status") {
      const result = String(a.status || "open").localeCompare(String(b.status || "open"));
      return submissionSortDir === "asc" ? result : -result;
    }
    if (submissionSortKey === "submitted_by") {
      const aLabel = (userMap.get(a.submitted_by || "") || "").toLowerCase();
      const bLabel = (userMap.get(b.submitted_by || "") || "").toLowerCase();
      const result = aLabel.localeCompare(bLabel);
      return submissionSortDir === "asc" ? result : -result;
    }
    const result = a.created_at.localeCompare(b.created_at);
    return submissionSortDir === "asc" ? result : -result;
  });

  async function saveFormDraft(formData: FormData) {
    "use server";
    const supabase = createSupabaseServerClient();
    const title = String(formData.get("title") || "").trim();
    const description = String(formData.get("description") || "").trim();
    const status = normalizeFormStatus(String(formData.get("status") || "draft"));
    const fields = parseFieldsJson(String(formData.get("fields_json") || "[]"));
    const selectedTaskTemplateIds = parseTaskTemplateIdsJson(
      String(formData.get("task_template_ids_json") || "[]")
    );
    const manualTasks = (() => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(String(formData.get("manual_tasks_json") || "[]"));
      } catch {
        return [] as Array<{ title: string; description: string }>;
      }
      if (!Array.isArray(parsed)) return [] as Array<{ title: string; description: string }>;
      return parsed
        .map((item) => {
          if (!item || typeof item !== "object") return null;
          const row = item as Record<string, unknown>;
          const title = String(row.title || "").trim();
          const description = String(row.description || "").trim();
          if (!title) return null;
          return { title, description };
        })
        .filter(Boolean) as Array<{ title: string; description: string }>;
    })();

    const canManageResult = await supabase.rpc("can_manage_form", {
      form_uuid: formId,
    });
    if (!isSupabaseMissingFunctionError(canManageResult.error)) {
      if (canManageResult.error || !canManageResult.data) {
        return {
          ok: false as const,
          error: "You do not have permission to edit this form.",
        };
      }
    }

    if (!title) {
      return { ok: false as const, error: "Form title is required" };
    }
    if (!fields.length) {
      return { ok: false as const, error: "Add at least one field" };
    }

    const { error: updateError } = await supabase
      .from("forms")
      .update({
        title,
        description: description || null,
        status,
        fields,
      })
      .eq("id", formId);
    if (updateError) {
      return { ok: false as const, error: updateError.message };
    }

    const { error: deleteError } = await supabase
      .from("form_submission_task_templates")
      .delete()
      .eq("form_id", formId);
    if (deleteError && !isSupabaseMissingTableError(deleteError)) {
      return { ok: false as const, error: deleteError.message };
    }

    if (selectedTaskTemplateIds.length) {
      const { error: actionError } = await supabase
        .from("form_submission_task_templates")
        .insert(
          selectedTaskTemplateIds.map((taskTemplateId, index) => ({
            form_id: formId,
            task_template_id: taskTemplateId,
            enabled: true,
            position: index,
          }))
        );
      if (actionError && !isSupabaseMissingTableError(actionError)) {
        return { ok: false as const, error: actionError.message };
      }
    }

    const { error: deleteActionsError } = await supabase
      .from("form_submission_actions")
      .delete()
      .eq("form_id", formId);
    if (deleteActionsError && !isSupabaseMissingTableError(deleteActionsError)) {
      return { ok: false as const, error: deleteActionsError.message };
    }

    if (manualTasks.length) {
      const { error: manualTaskError } = await supabase
        .from("form_submission_actions")
        .insert(
          manualTasks.map((task, index) => ({
            form_id: formId,
            label: task.title,
            task_title_template: task.title,
            task_description_template: task.description || null,
            assignee_user_id: null,
            priority: "medium",
            enabled: true,
            position: index,
          }))
        );
      if (manualTaskError && !isSupabaseMissingTableError(manualTaskError)) {
        return { ok: false as const, error: manualTaskError.message };
      }
    }

    revalidatePath("/forms");
    revalidatePath(detailPath);
    return { ok: true as const };
  }

  async function saveFormAccess(formData: FormData) {
    "use server";
    const supabase = createSupabaseServerClient();
    const formAccessAssignmentsInput = parseFormAccessAssignmentsJson(
      String(formData.get("form_access_json") || "[]")
    );

    if (formAccessSchemaMissing) {
      return {
        ok: false as const,
        error: "Form user access is not set up yet. Run sql/forms_form_permissions.sql first.",
      };
    }

    const canManageResult = await supabase.rpc("can_manage_form", {
      form_uuid: formId,
    });
    if (!isSupabaseMissingFunctionError(canManageResult.error)) {
      if (canManageResult.error || !canManageResult.data) {
        return {
          ok: false as const,
          error: "You do not have permission to edit form access.",
        };
      }
    }

    const resolvedFormAccessAssignments = await resolveFormAccessAssignments(
      supabase,
      formAccessAssignmentsInput
    );
    if (resolvedFormAccessAssignments.error) {
      return { ok: false as const, error: resolvedFormAccessAssignments.error };
    }

    const { error: clearAccessError } = await supabase
      .from("form_user_permissions")
      .delete()
      .eq("form_id", formId);
    if (clearAccessError && !isSupabaseMissingTableError(clearAccessError)) {
      return { ok: false as const, error: clearAccessError.message };
    }

    if (resolvedFormAccessAssignments.assignments.length) {
      const { error: upsertAccessError } = await supabase
        .from("form_user_permissions")
        .upsert(
          resolvedFormAccessAssignments.assignments.map((assignment) => ({
            form_id: formId,
            user_id: assignment.user_id,
            access_level: assignment.access_level,
          })),
          { onConflict: "form_id,user_id" }
        );
      if (upsertAccessError && !isSupabaseMissingTableError(upsertAccessError)) {
        return { ok: false as const, error: upsertAccessError.message };
      }
    }

    revalidatePath("/forms");
    revalidatePath(detailPath);
    return { ok: true as const };
  }

  async function createFormShareLink(formData: FormData) {
    "use server";
    const supabase = createSupabaseServerClient();

    if (formShareLinksSchemaMissing) {
      return {
        ok: false as const,
        error: "Form share links are not set up yet. Run sql/forms_share_links.sql first.",
      };
    }

    const canManageResult = await supabase.rpc("can_manage_form", {
      form_uuid: formId,
    });
    if (!isSupabaseMissingFunctionError(canManageResult.error)) {
      if (canManageResult.error || !canManageResult.data) {
        return {
          ok: false as const,
          error: "You do not have permission to manage share links for this form.",
        };
      }
    }

    const { data: authData } = await supabase.auth.getUser();
    const authEmail = authData.user?.email;
    if (!authEmail) {
      return { ok: false as const, error: "Please log in again." };
    }
    const { data: actor } = await supabase
      .from("users")
      .select("id")
      .eq("email", authEmail)
      .maybeSingle();
    if (!actor?.id) {
      return { ok: false as const, error: "Missing user profile." };
    }

    const accessMode = normalizeFormShareLinkAccessMode(
      String(formData.get("access_mode") || "public")
    );

    let lastErrorMessage = "Failed to create share link.";
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const token = randomBytes(24).toString("hex");
      const { error } = await supabase.from("form_share_links").insert({
        form_id: formId,
        token,
        access_mode: accessMode,
        is_active: true,
        created_by_user_id: actor.id,
      });
      if (!error) {
        revalidatePath("/forms");
        revalidatePath(detailPath);
        return { ok: true as const };
      }
      if (error.code !== "23505") {
        lastErrorMessage = error.message;
        break;
      }
      lastErrorMessage = error.message;
    }

    return { ok: false as const, error: lastErrorMessage };
  }

  async function toggleFormShareLink(formData: FormData) {
    "use server";
    const supabase = createSupabaseServerClient();

    if (formShareLinksSchemaMissing) {
      return {
        ok: false as const,
        error: "Form share links are not set up yet. Run sql/forms_share_links.sql first.",
      };
    }

    const linkId = String(formData.get("link_id") || "").trim();
    const nextIsActive = String(formData.get("next_is_active") || "").trim() === "true";
    if (!linkId) {
      return { ok: false as const, error: "Missing share link id." };
    }

    const canManageResult = await supabase.rpc("can_manage_form", {
      form_uuid: formId,
    });
    if (!isSupabaseMissingFunctionError(canManageResult.error)) {
      if (canManageResult.error || !canManageResult.data) {
        return {
          ok: false as const,
          error: "You do not have permission to manage share links for this form.",
        };
      }
    }

    const { error } = await supabase
      .from("form_share_links")
      .update({ is_active: nextIsActive })
      .eq("id", linkId)
      .eq("form_id", formId);
    if (error) {
      return { ok: false as const, error: error.message };
    }

    revalidatePath("/forms");
    revalidatePath(detailPath);
    return { ok: true as const };
  }

  async function createSubmission(formData: FormData) {
    "use server";
    const supabase = createSupabaseServerClient();
    const createSubmissionUrl = (extra?: { error?: string; success?: string }) => {
      const sp = new URLSearchParams();
      sp.set("return_to", returnTo);
      sp.set("tab", "create_submission");
      if (extra?.error) sp.set("error", extra.error);
      if (extra?.success) sp.set("success", extra.success);
      return `${detailPath}?${sp.toString()}`;
    };
    const submissionsUrl = (
      scope: SubmissionScope,
      sortKey: SubmissionSortKey,
      sortDir: SubmissionSortDir,
      extra?: { error?: string; success?: string }
    ) => {
      const sp = new URLSearchParams();
      sp.set("return_to", returnTo);
      sp.set("tab", "submissions");
      sp.set("scope", scope);
      sp.set("sort", sortKey);
      sp.set("dir", sortDir);
      if (extra?.error) sp.set("error", extra.error);
      if (extra?.success) sp.set("success", extra.success);
      return `${detailPath}?${sp.toString()}`;
    };

    const { data: authData } = await supabase.auth.getUser();
    const authUser = authData.user;
    if (!authUser?.id || !authUser.email) {
      redirect("/login");
    }
    const authUserId = authUser.id;
    const authEmail = authUser.email;

    const { data: currentUser } = await supabase
      .from("users")
      .select("id")
      .eq("email", authEmail)
      .maybeSingle();
    if (!currentUser?.id) {
      redirect(createSubmissionUrl({ error: "Missing user profile" }));
    }

    const { data: form, error: formError } = await supabase
      .from("forms")
      .select("id,fields")
      .eq("id", formId)
      .single();
    if (formError || !form) {
      redirect(createSubmissionUrl({ error: formError?.message || "Form not found" }));
    }

    const fields = parseFields(form.fields);
    const rawValues: Record<string, string> = {};
    const multiSelectValuesByKey: Record<string, string[]> = {};
    fields.forEach((field) => {
      const key = `field_${field.key}`;
      if (field.type === "checkbox") {
        rawValues[field.key] = formData.get(key) ? "true" : "false";
      } else if (field.type === "multi_select") {
        const allowedOptions = new Set((field.options || []).map((option) => String(option || "").trim()).filter(Boolean));
        const selectedOptions = Array.from(
          new Set(formData.getAll(key).map((entry) => String(entry || "").trim()).filter(Boolean))
        ).filter((value) => (allowedOptions.size ? allowedOptions.has(value) : false));
        multiSelectValuesByKey[field.key] = selectedOptions;
        rawValues[field.key] = selectedOptions.join(", ");
      } else {
        rawValues[field.key] = String(formData.get(key) || "").trim();
      }
    });

    const visibleFields = fields.filter((field) => fieldShouldBeIncluded(field, rawValues));
    const valuesForTemplates: Record<string, string> = {};
    const valuesForStorage: Record<string, unknown> = {};
    for (const field of visibleFields) {
      if (field.type === "multi_select") {
        const selectedOptions = multiSelectValuesByKey[field.key] || [];
        if (field.required && selectedOptions.length === 0) {
          const fieldLabel = field.label || formatFormLabel(field.key);
          redirect(createSubmissionUrl({ error: `Required field missing: ${fieldLabel}` }));
        }
        valuesForTemplates[field.key] = selectedOptions.join(", ");
        valuesForStorage[field.key] = selectedOptions;
        continue;
      }

      const value = rawValues[field.key] || "";
      if (field.required && !value) {
        const fieldLabel = field.label || formatFormLabel(field.key);
        redirect(createSubmissionUrl({ error: `Required field missing: ${fieldLabel}` }));
      }
      const validationError = validateFormFieldValue(field, value);
      if (validationError) {
        redirect(createSubmissionUrl({ error: validationError }));
      }
      valuesForTemplates[field.key] = value;
      valuesForStorage[field.key] = value;
    }

    const { data: insertedSubmission, error: submissionInsertError } = await supabase
      .from("form_submissions")
      .insert({
        form_id: formId,
        status: "open",
        values_json: valuesForStorage,
        submitted_by: currentUser.id,
      })
      .select("id")
      .single();

    if (submissionInsertError || !insertedSubmission?.id) {
      redirect(createSubmissionUrl({ error: submissionInsertError?.message || "Failed to create submission" }));
    }

    const { data: templateLinksRaw, error: templateLinksError } = await supabase
      .from("form_submission_task_templates")
      .select("task_template_id")
      .eq("form_id", formId)
      .eq("enabled", true)
      .order("position", { ascending: true })
      .order("created_at", { ascending: true });
    if (templateLinksError && !isSupabaseMissingTableError(templateLinksError)) {
      redirect(createSubmissionUrl({ error: templateLinksError.message }));
    }

    const templateIds = Array.from(
      new Set(
        ((templateLinksError ? [] : templateLinksRaw || []) as Array<{ task_template_id: string }>)
          .map((row) => row.task_template_id)
          .filter(Boolean)
      )
    );

    const defaultContentText = extractPlainText(DEFAULT_EDITOR_CONTENT);

    const { data: manualActionsRaw, error: manualActionsError } = await supabase
      .from("form_submission_actions")
      .select("id,task_title_template,task_description_template,assignee_user_id,priority")
      .eq("form_id", formId)
      .eq("enabled", true)
      .order("position", { ascending: true })
      .order("created_at", { ascending: true });
    if (manualActionsError && !isSupabaseMissingTableError(manualActionsError)) {
      redirect(createSubmissionUrl({ error: manualActionsError.message }));
    }

    for (const action of (manualActionsError ? [] : manualActionsRaw || []) as Array<{
      id: string;
      task_title_template: string;
      task_description_template: string | null;
      assignee_user_id: string | null;
      priority: string | null;
    }>) {
      const taskTitle = renderTemplate(action.task_title_template || "", valuesForTemplates).trim();
      if (!taskTitle) continue;
      const taskDescription = renderTemplate(action.task_description_template || "", valuesForTemplates).trim();
      const { data: insertedTask, error: insertedTaskError } = await supabase
        .from("tasks")
        .insert({
          title: taskTitle,
          description: taskDescription || null,
          status: "to_do",
          priority: normalizeFormActionPriority(action.priority),
          assignee_user_id: action.assignee_user_id,
          created_by_user_id: authUserId,
          content: DEFAULT_EDITOR_CONTENT,
          content_text: defaultContentText,
        })
        .select("id")
        .single();
      if (insertedTaskError || !insertedTask?.id) {
        redirect(
          createSubmissionUrl({
            error:
              formatDbError("forms.createSubmission.manualTask.tasks.insert", insertedTaskError) ||
              "Failed to create task",
          })
        );
      }
      const { error: actionTaskError } = await supabase.from("form_submission_action_tasks").insert({
        submission_id: insertedSubmission.id,
        action_id: action.id,
        task_id: insertedTask.id,
      });
      if (actionTaskError && !isSupabaseMissingTableError(actionTaskError)) {
        redirect(createSubmissionUrl({ error: actionTaskError.message }));
      }
    }

    if (templateIds.length) {
      const { data: templateTasksRaw, error: templateTasksError } = await supabase
        .from("task_templates")
        .select("id,title,description,status,priority")
        .in("id", templateIds);
      if (templateTasksError) {
        redirect(createSubmissionUrl({ error: templateTasksError.message }));
      }
      const templateTasks = (templateTasksRaw || []) as Array<{
        id: string;
        title: string;
        description: string | null;
        status: string;
        priority: string;
      }>;
      const templateById = new Map(templateTasks.map((template) => [template.id, template]));

      const { data: templateAssigneesRaw, error: templateAssigneesError } = await supabase
        .from("task_template_assignees")
        .select("task_template_id,user_id")
        .in("task_template_id", templateIds);
      if (templateAssigneesError && !isSupabaseMissingTableError(templateAssigneesError)) {
        redirect(createSubmissionUrl({ error: templateAssigneesError.message }));
      }
      const assigneeIdsByTemplateId = (
        (templateAssigneesError ? [] : templateAssigneesRaw || []) as Array<{
          task_template_id: string;
          user_id: string;
        }>
      ).reduce<Record<string, string[]>>((acc, row) => {
        acc[row.task_template_id] ||= [];
        acc[row.task_template_id].push(row.user_id);
        return acc;
      }, {});

      for (const templateId of templateIds) {
        const template = templateById.get(templateId);
        if (!template) continue;

        const assigneeIds = Array.from(new Set(assigneeIdsByTemplateId[templateId] || []));
        const primaryAssignee = assigneeIds[0] || null;
        const { data: createdTask, error: createdTaskError } = await supabase
          .from("tasks")
          .insert({
            title: template.title,
            description: template.description || null,
            status: normalizeTaskStatusOrDefault(template.status),
            priority: String(template.priority || "medium"),
            assignee_user_id: primaryAssignee,
            created_by_user_id: authUserId,
            content: DEFAULT_EDITOR_CONTENT,
            content_text: defaultContentText,
          })
          .select("id")
          .single();
        if (createdTaskError || !createdTask?.id) {
          redirect(
            createSubmissionUrl({
              error:
                formatDbError(
                  "forms.createSubmission.templateTask.tasks.insert",
                  createdTaskError
                ) || "Failed to create task from template",
            })
          );
        }

        if (assigneeIds.length) {
          const { error: parentAssigneesError } = await supabase.from("task_assignees").insert(
            assigneeIds.map((userId) => ({
              task_id: createdTask.id,
              user_id: userId,
            }))
          );
          if (parentAssigneesError) {
            redirect(createSubmissionUrl({ error: parentAssigneesError.message }));
          }
        }

        const { data: subtaskTemplatesRaw, error: subtaskTemplatesError } = await supabase
          .from("task_template_subtasks")
          .select("id,title,description,status,priority,position")
          .eq("task_template_id", templateId)
          .order("position", { ascending: true });
        if (subtaskTemplatesError && !isSupabaseMissingTableError(subtaskTemplatesError)) {
          redirect(createSubmissionUrl({ error: subtaskTemplatesError.message }));
        }

        const subtaskTemplates = (subtaskTemplatesError
          ? []
          : subtaskTemplatesRaw || []) as Array<{
          id: string;
          title: string;
          description: string | null;
          status: string;
          priority: string;
          position: number;
        }>;

        if (subtaskTemplates.length) {
          const subtaskTemplateIds = subtaskTemplates.map((subtask) => subtask.id);
          const { data: subtaskAssigneesRaw, error: subtaskAssigneesError } =
            subtaskTemplateIds.length
              ? await supabase
                  .from("task_template_subtask_assignees")
                  .select("task_template_subtask_id,user_id")
                  .in("task_template_subtask_id", subtaskTemplateIds)
              : {
                  data: [] as Array<{ task_template_subtask_id: string; user_id: string }>,
                  error: null,
                };
          if (subtaskAssigneesError && !isSupabaseMissingTableError(subtaskAssigneesError)) {
            redirect(createSubmissionUrl({ error: subtaskAssigneesError.message }));
          }
          const assigneeIdsBySubtaskTemplateId = (
            (subtaskAssigneesError ? [] : subtaskAssigneesRaw || []) as Array<{
              task_template_subtask_id: string;
              user_id: string;
            }>
          ).reduce<Record<string, string[]>>((acc, row) => {
            acc[row.task_template_subtask_id] ||= [];
            acc[row.task_template_subtask_id].push(row.user_id);
            return acc;
          }, {});

          const subtaskPlans = subtaskTemplates.map((subtask) => {
            const subtaskAssigneeIds = Array.from(
              new Set(assigneeIdsBySubtaskTemplateId[subtask.id] || [])
            );
            return {
              assigneeIds: subtaskAssigneeIds,
              payload: {
                parent_task_id: createdTask.id,
                title: subtask.title,
                description: subtask.description || null,
                status: normalizeTaskStatusOrDefault(subtask.status),
                priority: String(subtask.priority || "medium"),
                assignee_user_id: subtaskAssigneeIds[0] || primaryAssignee,
                created_by_user_id: authUserId,
                content: DEFAULT_EDITOR_CONTENT,
                content_text: defaultContentText,
              },
            };
          });

          const { data: createdSubtasksRaw, error: createdSubtasksError } = await supabase
            .from("tasks")
            .insert(subtaskPlans.map((plan) => plan.payload))
            .select("id");
          if (createdSubtasksError) {
            redirect(
              createSubmissionUrl({
                error: formatDbError(
                  "forms.createSubmission.templateSubtasks.tasks.insert",
                  createdSubtasksError
                ),
              })
            );
          }
          const createdSubtasks = (createdSubtasksRaw || []).filter((row) => Boolean(row.id));
          const subtaskAssigneeInserts = createdSubtasks.flatMap((subtaskRow, index) => {
            const explicitIds = subtaskPlans[index]?.assigneeIds || [];
            const effectiveIds = explicitIds.length ? explicitIds : assigneeIds;
            return effectiveIds.map((userId) => ({
              task_id: subtaskRow.id,
              user_id: userId,
            }));
          });
          if (subtaskAssigneeInserts.length) {
            const { error: subtaskAssigneesInsertError } = await supabase
              .from("task_assignees")
              .insert(subtaskAssigneeInserts);
            if (subtaskAssigneesInsertError) {
              redirect(createSubmissionUrl({ error: subtaskAssigneesInsertError.message }));
            }
          }
        }

        const { error: taskLinkError } = await supabase
          .from("form_submission_template_tasks")
          .insert({
            submission_id: insertedSubmission.id,
            task_template_id: templateId,
            task_id: createdTask.id,
          });
        if (taskLinkError && !isSupabaseMissingTableError(taskLinkError)) {
          redirect(createSubmissionUrl({ error: taskLinkError.message }));
        }
      }
    }

    revalidatePath("/forms");
    revalidatePath(detailPath);
    revalidatePath("/tasks");
    redirect(submissionsUrl("open", submissionSortKey, submissionSortDir, { success: "Submission created" }));
  }

  const submissionDetailBaseQuery = `return_to=${encodeURIComponent(
    buildDetailUrl("submissions", submissionScope, submissionSortKey, submissionSortDir)
  )}`;

  return (
    <div className="space-y-6">
      <header className="rounded-2xl border border-slate-200 bg-white p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <Link href={returnTo} className="text-sm font-medium text-slate-600 hover:text-slate-900">
              &larr; Back to forms
            </Link>
            <h1 className="mt-2 text-2xl font-semibold text-slate-900">{form.title}</h1>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-slate-600">
              <span
                className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-semibold ${formStatusBadgeClass(formStatus)}`}
              >
                {formatFormLabel(formStatus)}
              </span>
              <span>{`${openSubmissionCount} open submissions`}</span>
              <span>{`${formFields.length} field${formFields.length === 1 ? "" : "s"}`}</span>
            </div>
            {form.description ? (
              <p className="mt-1 text-sm text-slate-600">{form.description}</p>
            ) : null}
          </div>
          {canConfigureForm ? (
            <div className="flex flex-wrap items-center gap-2">
              <FormAccessPopover
                users={workspaceUserOptions}
                groups={assignmentGroupOptions}
                initialAssignments={formAccessAssignments}
                formAccessSchemaMissing={formAccessSchemaMissing}
                onSave={saveFormAccess}
              />
              <FormShareLinksPopover
                appBaseUrl={appBaseUrl}
                links={formShareLinks}
                schemaMissing={formShareLinksSchemaMissing}
                loadErrorMessage={formShareLinksLoadErrorMessage}
                onCreateLink={createFormShareLink}
                onToggleLink={toggleFormShareLink}
              />
            </div>
          ) : null}
        </div>
      </header>

      <nav className="flex flex-wrap gap-2 border-b border-slate-200 pb-4 text-sm">
        <Link
          href={tabUrls.submissions}
          className={`rounded-md px-3 py-1.5 font-medium ${
            activeTab === "submissions"
              ? "tab-active"
              : "border border-slate-200 text-slate-700 hover:bg-slate-100"
          }`}
        >
          Submissions
        </Link>
        {canConfigureForm ? (
          <Link
            href={tabUrls.configure}
            className={`rounded-md px-3 py-1.5 font-medium ${
              activeTab === "configure"
                ? "tab-active"
                : "border border-slate-200 text-slate-700 hover:bg-slate-100"
            }`}
          >
            Configure form
          </Link>
        ) : null}
        <Link
          href={tabUrls.create_submission}
          className={`rounded-md px-3 py-1.5 font-medium ${
            activeTab === "create_submission"
              ? "tab-active"
              : "border border-slate-200 text-slate-700 hover:bg-slate-100"
          }`}
        >
          Create submission
        </Link>
      </nav>

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

      {formPermissionErrorMessage ? (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900">
          {formPermissionErrorMessage}
        </p>
      ) : null}

      {activeTab === "configure" ? (
        canConfigureForm ? (
          <FormConfigureAutosave
            initialTitle={form.title}
            initialDescription={form.description || ""}
            initialStatus={formStatus}
            initialFields={formFields}
            initialTemplateIds={selectedTaskTemplateIds}
            initialManualTasks={manualTasks}
            taskTemplates={taskTemplates}
            taskTemplatesMissing={
              isSupabaseMissingTableError(templateLinksError) ||
              isSupabaseMissingTableError(taskTemplatesError)
            }
            onAutoSave={saveFormDraft}
          />
        ) : (
          <section className="rounded-lg border border-amber-200 bg-amber-50 p-6 text-sm text-amber-900">
            You can view this form, but only users with edit access can configure it.
          </section>
        )
      ) : null}

      {activeTab === "create_submission" ? (
        <section className="rounded-xl border border-slate-200 bg-white">
          <div className="border-b border-slate-200 px-6 py-4">
            <h2 className="text-lg font-semibold text-slate-900">Create submission</h2>
          </div>
          <form action={createSubmission} className="space-y-4 px-6 py-4">
            <FormSubmissionBuilder fields={formFields} />
            <button
              type="submit"
              className="rounded-md btn-primary px-4 py-2 text-sm font-semibold text-white"
            >
              Submit form
            </button>
          </form>
        </section>
      ) : null}

      {activeTab === "submissions" ? (
        <section className="rounded-xl border border-slate-200 bg-white">
        <div className="border-b border-slate-200 px-6 py-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-semibold text-slate-900">Submissions</h2>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <Link
                href={exportSubmissionsCsvUrl}
                className="rounded-md border border-slate-300 px-2.5 py-1.5 font-semibold text-slate-700 hover:border-slate-400 hover:text-slate-900"
              >
                Export CSV
              </Link>
              {(["completed", "open", "all"] as const).map((scope) => (
                <Link
                  key={scope}
                  href={buildDetailUrl("submissions", scope, submissionSortKey, submissionSortDir)}
                  className={`rounded-md px-2.5 py-1.5 font-semibold ${
                    submissionScope === scope
                      ? "tab-active"
                      : "border border-slate-200 text-slate-700 hover:bg-slate-100"
                  }`}
                >
                  {scope === "completed"
                    ? "Completed"
                    : scope === "open"
                      ? "Open"
                      : "All"}
                </Link>
              ))}
            </div>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-6 py-3">Submission</th>
                {questionColumns.map((column) => (
                  <th key={column.key} className="px-4 py-3 normal-case">
                    <span
                      className="block max-w-[11rem] truncate whitespace-nowrap text-[11px] font-semibold tracking-wide text-slate-600"
                      title={column.label}
                    >
                      {shortQuestionLabel(column.label)}
                    </span>
                  </th>
                ))}
                <th className="px-6 py-3">
                  <Link
                    href={buildDetailUrl(
                      "submissions",
                      submissionScope,
                      "status",
                      submissionSortKey === "status" && submissionSortDir === "asc"
                        ? "desc"
                        : "asc"
                    )}
                    className="inline-flex items-center gap-2 text-slate-500 hover:text-slate-900"
                  >
                    Status
                  </Link>
                </th>
                <th className="px-6 py-3">
                  <Link
                    href={buildDetailUrl(
                      "submissions",
                      submissionScope,
                      "submitted_by",
                      submissionSortKey === "submitted_by" && submissionSortDir === "asc"
                        ? "desc"
                        : "asc"
                    )}
                    className="inline-flex items-center gap-2 text-slate-500 hover:text-slate-900"
                  >
                    Submitted by
                  </Link>
                </th>
                <th className="px-6 py-3">
                  <Link
                    href={buildDetailUrl(
                      "submissions",
                      submissionScope,
                      "created_at",
                      submissionSortKey === "created_at" && submissionSortDir === "asc"
                        ? "desc"
                        : "asc"
                    )}
                    className="inline-flex items-center gap-2 text-slate-500 hover:text-slate-900"
                  >
                    Created
                  </Link>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {sortedSubmissions.length ? (
                sortedSubmissions.map((submission) => (
                  <tr key={submission.id}>
                    <td className="px-6 py-3 font-semibold text-slate-900">
                      <Link
                        href={`/forms/submissions/${submission.id}?${submissionDetailBaseQuery}`}
                        className="hover:underline"
                      >
                        {submission.id.slice(0, 8)}
                      </Link>
                    </td>
                    {questionColumns.map((column) => {
                      const displayValue = formatSubmissionValue(column, submission.values_json);
                      return (
                        <td key={`${submission.id}-${column.key}`} className="px-4 py-3 text-slate-700">
                          <span
                            className="block max-w-[14rem] truncate whitespace-nowrap"
                            title={displayValue}
                          >
                            {displayValue}
                          </span>
                        </td>
                      );
                    })}
                    <td className="px-6 py-3 text-slate-700">
                      {formatFormLabel(String(submission.status || "open"))}
                    </td>
                    <td className="px-6 py-3 text-slate-600">
                      {userMap.get(submission.submitted_by || "") || "Unknown user"}
                    </td>
                    <td className="px-6 py-3 text-slate-600">
                      {new Date(submission.created_at).toLocaleString()}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td className="px-6 py-6 text-sm text-slate-500" colSpan={1 + questionColumns.length + 3}>
                    No submissions found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
      ) : null}
    </div>
  );
}
