import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isSupabaseMissingTableError } from "@/lib/supabaseErrors";
import { parseCsvParam, setCsvParam } from "@/lib/queryParams";
import FormCreateAutosave from "./FormCreateAutosave";
import FormsTable from "./FormsTable";
import FormsTabs, {
  normalizeFormsTabKey,
  type FormsTabKey,
} from "./_components/FormsTabs";
import {
  buildFieldKey,
  ensureUniqueFormFieldKeys,
  formStatusOptions,
  normalizeFormAccessLevel,
  normalizeFormFieldMetadata,
  normalizeFormFieldVisibility,
  normalizeFormFieldType,
  normalizeFormStatus,
  type FormAccessAssignment,
  type FormField,
  type FormStatus,
} from "./types";

type SortKey = "title" | "status" | "open_submissions" | "updated_at";
type SortDir = "asc" | "desc";

function normalizeSortKey(value: string | undefined): SortKey {
  if (value === "title" || value === "status" || value === "open_submissions") {
    return value;
  }
  return "updated_at";
}

function normalizeSortDir(value: string | undefined, sortKey: SortKey): SortDir {
  if (value === "asc" || value === "desc") {
    return value;
  }
  return sortKey === "title" || sortKey === "status" ? "asc" : "desc";
}

function sanitizeSearch(value: string) {
  return value
    .replace(/[^a-zA-Z0-9\s\-_]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseFieldsJson(raw: string): FormField[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const fields = parsed
    .map((item, index) => {
      if (!item || typeof item !== "object") return null;
      const row = item as Record<string, unknown>;
      const label = String(row.label || "").trim();
      const key = buildFieldKey(String(row.key || ""), `field_${index + 1}`);
      if (!label && !key) return null;
      const options = Array.isArray(row.options)
        ? row.options.map((v) => String(v || "").trim()).filter(Boolean)
        : [];
      const visibility = normalizeFormFieldVisibility(row);
      const metadata = normalizeFormFieldMetadata(row);
      return {
        id: String(row.id || `field_${index + 1}`),
        key,
        label: label || key,
        type: normalizeFormFieldType(String(row.type || "text")),
        required: Boolean(row.required),
        options,
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

type ManualTask = {
  title: string;
  description: string;
};

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

function parseManualTasksJson(raw: string): ManualTask[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const row = item as Record<string, unknown>;
      const title = String(row.title || "").trim();
      const description = String(row.description || "").trim();
      if (!title) return null;
      return { title, description };
    })
    .filter(Boolean) as ManualTask[];
}

export default async function FormsPage(props: {
  searchParams?: Promise<{
    error?: string;
    success?: string;
    tab?: string;
    q?: string;
    status?: string | string[];
    sort?: string;
    dir?: string;
  }>;
}) {
  const searchParams = await props.searchParams;
  const supabase = createSupabaseServerClient();
  const { data: authData } = await supabase.auth.getUser();
  const authEmail = authData.user?.email;
  if (!authEmail) {
    redirect("/login");
  }

  const { data: currentUser } = await supabase
    .from("users")
    .select("id")
    .eq("email", authEmail)
    .maybeSingle();

  if (!currentUser?.id) {
    redirect("/tasks?error=Missing%20user%20profile");
  }

  const sortKey = normalizeSortKey((searchParams?.sort || "").trim());
  const sortDir = normalizeSortDir((searchParams?.dir || "").trim(), sortKey);
  const activeTab = normalizeFormsTabKey(searchParams?.tab);
  const selectedStatuses = parseCsvParam(searchParams?.status).filter((status) =>
    formStatusOptions.includes(status as FormStatus)
  );
  const query = sanitizeSearch((searchParams?.q || "").trim());

  const params = new URLSearchParams();
  setCsvParam(params, "status", selectedStatuses);
  if (query) params.set("q", query);
  params.set("sort", sortKey);
  params.set("dir", sortDir);
  if (activeTab !== "list") {
    params.set("tab", activeTab);
  }
  const returnTo = params.toString() ? `/forms?${params}` : "/forms";
  const buildFormsUrl = (
    tab: FormsTabKey,
    extra?: { error?: string; success?: string }
  ) => {
    const sp = new URLSearchParams(params);
    if (tab !== "list") {
      sp.set("tab", tab);
    } else {
      sp.delete("tab");
    }
    if (extra?.error) {
      sp.set("error", extra.error);
    } else {
      sp.delete("error");
    }
    if (extra?.success) {
      sp.set("success", extra.success);
    } else {
      sp.delete("success");
    }
    const qs = sp.toString();
    return qs ? `/forms?${qs}` : "/forms";
  };
  const formsTabUrls: Record<FormsTabKey, string> = {
    list: buildFormsUrl("list"),
    create: buildFormsUrl("create"),
  };

  let formsQuery = supabase.from("forms").select("id,title,description,status,created_at,updated_at");

  if (sortKey === "title" || sortKey === "status") {
    formsQuery = formsQuery.order(sortKey, { ascending: sortDir === "asc" });
  } else if (sortKey === "updated_at") {
    formsQuery = formsQuery.order("updated_at", { ascending: sortDir === "asc" });
  } else {
    // Keep a deterministic default order when open submission count sort is selected.
    formsQuery = formsQuery.order("updated_at", { ascending: false });
  }

  if (selectedStatuses.length) {
    formsQuery = formsQuery.in("status", selectedStatuses);
  }
  if (query) {
    formsQuery = formsQuery.or(`title.ilike.%${query}%,description.ilike.%${query}%`);
  }

  const formsResult = await formsQuery;
  const formsError =
    formsResult.error && isSupabaseMissingTableError(formsResult.error)
      ? null
      : formsResult.error;
  const forms =
    formsResult.error && isSupabaseMissingTableError(formsResult.error)
      ? []
      : ((formsResult.data || []) as Array<{
          id: string;
          title: string;
          description: string | null;
          status: string | null;
          created_at: string;
          updated_at: string;
        }>);

  const formIds = forms.map((form) => form.id);
  const submissionCounts = new Map<string, number>();
  if (formIds.length) {
    const { data: submissions } = await supabase
      .from("form_submissions")
      .select("form_id")
      .in("form_id", formIds)
      .not("status", "in", "(completed,rejected)");
    (submissions || []).forEach((row) => {
      if (!row.form_id) return;
      submissionCounts.set(row.form_id, (submissionCounts.get(row.form_id) || 0) + 1);
    });
  }

  const tableRows = forms.map((form) => ({
    id: form.id,
    title: form.title,
    description: form.description,
    status: normalizeFormStatus(form.status),
    created_at: form.created_at,
    updated_at: form.updated_at,
    openSubmissions: submissionCounts.get(form.id) || 0,
  }));
  if (sortKey === "open_submissions") {
    tableRows.sort((a, b) => {
      const result = a.openSubmissions - b.openSubmissions;
      return sortDir === "asc" ? result : -result;
    });
  }

  const { data: taskTemplatesRaw, error: taskTemplatesError } = await supabase
    .from("task_templates")
    .select("id,name,title")
    .order("name", { ascending: true });
  const taskTemplates = (taskTemplatesError ? [] : taskTemplatesRaw || []) as Array<{
    id: string;
    name: string;
    title: string;
  }>;

  const { data: usersRaw, error: usersError } = await supabase
    .from("users")
    .select("id,full_name,email")
    .order("full_name", { ascending: true });
  const userOptions = (usersError ? [] : usersRaw || [])
    .map((row) => ({
      id: String((row as { id?: string }).id || "").trim(),
      label:
        String((row as { full_name?: string | null }).full_name || "").trim() ||
        String((row as { email?: string | null }).email || "").trim(),
      secondaryLabel: String((row as { email?: string | null }).email || "").trim(),
    }))
    .filter((row) => row.id && row.label);

  const { error: formAccessSchemaError } = await supabase
    .from("form_user_permissions")
    .select("form_id")
    .limit(1);
  const formAccessSchemaMissing = isSupabaseMissingTableError(formAccessSchemaError);

  async function upsertFormDraft(formData: FormData) {
    "use server";
    const supabase = createSupabaseServerClient();
    const formId = String(formData.get("form_id") || "").trim();
    const title = String(formData.get("title") || "").trim();
    const description = String(formData.get("description") || "").trim();
    const status = normalizeFormStatus(String(formData.get("status") || "draft"));
    const fields = parseFieldsJson(String(formData.get("fields_json") || "[]"));
    const selectedTaskTemplateIds = parseTaskTemplateIdsJson(
      String(formData.get("task_template_ids_json") || "[]")
    );
    const manualTasks = parseManualTasksJson(
      String(formData.get("manual_tasks_json") || "[]")
    );
    const formAccessAssignments = parseFormAccessAssignmentsJson(
      String(formData.get("form_access_json") || "[]")
    );

    if (!title) {
      return { ok: false, error: "Form title is required" };
    }

    if (!fields.length) {
      return { ok: false, error: "Add at least one field" };
    }

    const { data: authData } = await supabase.auth.getUser();
    const authEmail = authData.user?.email;
    if (!authEmail) {
      return { ok: false, error: "Please log in again" };
    }

    const { data: currentUser } = await supabase
      .from("users")
      .select("id")
      .eq("email", authEmail)
      .maybeSingle();
    if (!currentUser?.id) {
      return { ok: false, error: "Missing user profile" };
    }

    let targetFormId = formId;
    if (targetFormId) {
      const { error: formUpdateError } = await supabase
        .from("forms")
        .update({
          title,
          description: description || null,
          status,
          fields,
        })
        .eq("id", targetFormId);
      if (formUpdateError) {
        return { ok: false, error: formUpdateError.message };
      }
    } else {
      const { data: insertedForm, error: formInsertError } = await supabase
        .from("forms")
        .insert({
          title,
          description: description || null,
          status,
          fields,
          created_by: currentUser.id,
        })
        .select("id")
        .single();
      if (formInsertError || !insertedForm?.id) {
        return {
          ok: false,
          error: formInsertError?.message || "Failed to create form",
        };
      }
      targetFormId = insertedForm.id;
    }

    const { error: clearTemplateLinksError } = await supabase
      .from("form_submission_task_templates")
      .delete()
      .eq("form_id", targetFormId);
    if (
      clearTemplateLinksError &&
      !isSupabaseMissingTableError(clearTemplateLinksError)
    ) {
      return { ok: false, error: clearTemplateLinksError.message };
    }

    if (selectedTaskTemplateIds.length) {
      const { error: linkError } = await supabase.from("form_submission_task_templates").insert(
        selectedTaskTemplateIds.map((taskTemplateId, index) => ({
          form_id: targetFormId,
          task_template_id: taskTemplateId,
          enabled: true,
          position: index,
        }))
      );
      if (linkError && !isSupabaseMissingTableError(linkError)) {
        return { ok: false, error: linkError.message };
      }
    }

    const { error: clearManualActionsError } = await supabase
      .from("form_submission_actions")
      .delete()
      .eq("form_id", targetFormId);
    if (clearManualActionsError && !isSupabaseMissingTableError(clearManualActionsError)) {
      return { ok: false, error: clearManualActionsError.message };
    }

    if (manualTasks.length) {
      const { error: actionError } = await supabase.from("form_submission_actions").insert(
        manualTasks.map((task, index) => ({
          form_id: targetFormId,
          label: task.title,
          task_title_template: task.title,
          task_description_template: task.description || null,
          assignee_user_id: null,
          priority: "medium",
          enabled: true,
          position: index,
        }))
      );
      if (actionError && !isSupabaseMissingTableError(actionError)) {
        return { ok: false, error: actionError.message };
      }
    }

    const { error: clearAccessError } = await supabase
      .from("form_user_permissions")
      .delete()
      .eq("form_id", targetFormId);
    if (clearAccessError && !isSupabaseMissingTableError(clearAccessError)) {
      return { ok: false, error: clearAccessError.message };
    }

    if (formAccessAssignments.length) {
      const { error: accessInsertError } = await supabase
        .from("form_user_permissions")
        .upsert(
          formAccessAssignments.map((assignment) => ({
            form_id: targetFormId,
            user_id: assignment.user_id,
            access_level: assignment.access_level,
          })),
          { onConflict: "form_id,user_id" }
        );
      if (accessInsertError && !isSupabaseMissingTableError(accessInsertError)) {
        return { ok: false, error: accessInsertError.message };
      }
    }

    revalidatePath("/forms");
    revalidatePath(`/forms/${targetFormId}`);
    return { ok: true, formId: targetFormId };
  }

  return (
    <div className="space-y-8">
      <section className="space-y-2">
        <h1 className="text-2xl font-semibold text-slate-900">Forms</h1>
        <p className="text-sm text-slate-600">
          Build reusable forms with conditional fields and automatic follow-up task creation.
        </p>
      </section>

      {(searchParams?.error || searchParams?.success || formsError) && (
        <div className="space-y-2">
          {formsError ? (
            <p className="rounded-md border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
              {formsError.message}
            </p>
          ) : null}
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

      {isSupabaseMissingTableError(formsResult.error) ? (
        <section className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Forms are not set up yet. Run `sql/forms.sql` in Supabase SQL Editor, then refresh.
        </section>
      ) : null}

      <FormsTabs active={activeTab} urls={formsTabUrls} />

      {activeTab === "create" ? (
        <FormCreateAutosave
          taskTemplates={taskTemplates}
          userOptions={userOptions}
          taskTemplatesMissing={isSupabaseMissingTableError(taskTemplatesError)}
          formAccessSchemaMissing={formAccessSchemaMissing}
          returnTo={returnTo}
          onAutoSave={upsertFormDraft}
        />
      ) : null}

      {activeTab === "list" ? (
        <FormsTable
          rows={tableRows}
          sortKey={sortKey}
          sortDir={sortDir}
          initialFilters={{ q: query, status: selectedStatuses }}
          statusOptions={formStatusOptions}
          fixedParams={{ tab: "list" }}
        />
      ) : null}
    </div>
  );
}
