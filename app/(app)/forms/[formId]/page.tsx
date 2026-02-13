import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { DEFAULT_EDITOR_CONTENT } from "@/lib/editorContent";
import { extractPlainText } from "@/lib/tiptapText";
import FormFieldsBuilder from "../FormFieldsBuilder";
import FormActionsBuilder from "../FormActionsBuilder";
import FormSubmissionBuilder from "../FormSubmissionBuilder";
import {
  buildFieldKey,
  formStatusOptions,
  formatFormLabel,
  normalizeFormActionPriority,
  normalizeFormFieldType,
  normalizeFormStatus,
  renderTemplate,
  type FormAction,
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
  if (normalized === "all" || normalized === "open") return normalized;
  return "completed";
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

function parseFields(value: unknown): FormField[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item, index) => {
      if (!item || typeof item !== "object") return null;
      const row = item as Record<string, unknown>;
      const key = buildFieldKey(String(row.key || ""), `field_${index + 1}`);
      if (!key) return null;
      return {
        id: String(row.id || `field_${index + 1}`),
        key,
        label: String(row.label || key),
        type: normalizeFormFieldType(String(row.type || "text")),
        required: Boolean(row.required),
        options: Array.isArray(row.options)
          ? row.options.map((entry) => String(entry || "").trim()).filter(Boolean)
          : [],
        condition:
          row.condition && typeof row.condition === "object"
            ? {
                fieldKey: String((row.condition as Record<string, unknown>).fieldKey || "").trim(),
                equals: String((row.condition as Record<string, unknown>).equals || "").trim(),
              }
            : null,
      } satisfies FormField;
    })
    .filter(Boolean) as FormField[];
}

function parseFieldsJson(raw: string): FormField[] {
  try {
    return parseFields(JSON.parse(raw));
  } catch {
    return [];
  }
}

function parseActionsJson(raw: string): FormAction[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed
    .map((item, index) => {
      if (!item || typeof item !== "object") return null;
      const row = item as Record<string, unknown>;
      const label = String(row.label || "").trim();
      const taskTitleTemplate = String(row.taskTitleTemplate || "").trim();
      if (!label || !taskTitleTemplate) return null;
      return {
        id: String(row.id || `action_${index + 1}`),
        label,
        taskTitleTemplate,
        taskDescriptionTemplate: String(row.taskDescriptionTemplate || "").trim(),
        assigneeUserId: String(row.assigneeUserId || "").trim() || null,
        priority: normalizeFormActionPriority(String(row.priority || "medium")),
        enabled: row.enabled !== false,
      } satisfies FormAction;
    })
    .filter(Boolean) as FormAction[];
}

function fieldShouldBeIncluded(field: FormField, values: Record<string, string>) {
  if (!field.condition?.fieldKey) return true;
  const expected = String(field.condition.equals || "").trim().toLowerCase();
  const actual = String(values[field.condition.fieldKey] || "").trim().toLowerCase();
  return actual === expected;
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
    .select("id")
    .eq("email", authEmail)
    .maybeSingle();
  if (!currentUser?.id) {
    redirect("/tasks?error=Missing%20user%20profile");
  }

  const { data: form, error: formError } = await supabase
    .from("forms")
    .select("id,title,description,status,fields,created_at,updated_at")
    .eq("id", formId)
    .maybeSingle();
  if (formError) {
    notFound();
  }
  if (!form) {
    notFound();
  }

  const formFields = parseFields(form.fields);

  const [{ data: actionsRaw }, { data: submissionsRaw }, { data: users }] = await Promise.all([
    supabase
      .from("form_submission_actions")
      .select(
        "id,label,task_title_template,task_description_template,assignee_user_id,priority,enabled,position"
      )
      .eq("form_id", formId)
      .order("position", { ascending: true })
      .order("created_at", { ascending: true }),
    supabase
      .from("form_submissions")
      .select("id,status,values_json,submitted_by,created_at,updated_at")
      .eq("form_id", formId)
      .order("created_at", { ascending: false }),
    supabase.from("users").select("id,full_name,email").order("full_name", { ascending: true }),
  ]);

  const actions = ((actionsRaw || []) as Array<{
    id: string;
    label: string;
    task_title_template: string;
    task_description_template: string | null;
    assignee_user_id: string | null;
    priority: string | null;
    enabled: boolean | null;
    position: number | null;
  }>).map((row) => ({
    id: row.id,
    label: row.label,
    taskTitleTemplate: row.task_title_template,
    taskDescriptionTemplate: row.task_description_template || "",
    assigneeUserId: row.assignee_user_id,
    priority: normalizeFormActionPriority(row.priority),
    enabled: row.enabled !== false,
  })) as FormAction[];

  const submissions = (submissionsRaw || []) as Array<{
    id: string;
    status: string | null;
    values_json: Record<string, unknown> | null;
    submitted_by: string | null;
    created_at: string;
    updated_at: string;
  }>;

  const userMap = new Map<string, string>();
  (users || []).forEach((user) => {
    userMap.set(user.id, user.full_name || user.email || "Unknown user");
  });

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

  async function saveForm(formData: FormData) {
    "use server";
    const supabase = createSupabaseServerClient();
    const title = String(formData.get("title") || "").trim();
    const description = String(formData.get("description") || "").trim();
    const status = normalizeFormStatus(String(formData.get("status") || "draft"));
    const fields = parseFieldsJson(String(formData.get("fields_json") || "[]"));
    const actions = parseActionsJson(String(formData.get("actions_json") || "[]"));
    const configureUrl = (extra?: { error?: string; success?: string }) => {
      const sp = new URLSearchParams();
      sp.set("return_to", returnTo);
      sp.set("tab", "configure");
      if (extra?.error) sp.set("error", extra.error);
      if (extra?.success) sp.set("success", extra.success);
      return `${detailPath}?${sp.toString()}`;
    };
    if (!title) {
      redirect(configureUrl({ error: "Form title is required" }));
    }
    if (!fields.length) {
      redirect(configureUrl({ error: "Add at least one field" }));
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
      redirect(configureUrl({ error: updateError.message }));
    }

    const { error: deleteError } = await supabase
      .from("form_submission_actions")
      .delete()
      .eq("form_id", formId);

    if (deleteError) {
      redirect(configureUrl({ error: deleteError.message }));
    }

    if (actions.length) {
      const { error: actionError } = await supabase
        .from("form_submission_actions")
        .insert(
          actions.map((action, index) => ({
            form_id: formId,
            label: action.label,
            task_title_template: action.taskTitleTemplate,
            task_description_template: action.taskDescriptionTemplate || null,
            assignee_user_id: action.assigneeUserId,
            priority: action.priority,
            enabled: action.enabled,
            position: index,
          }))
        );

      if (actionError) {
        redirect(configureUrl({ error: actionError.message }));
      }
    }

    revalidatePath("/forms");
    revalidatePath(detailPath);
    redirect(configureUrl({ success: "Form updated" }));
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
    fields.forEach((field) => {
      const key = `field_${field.key}`;
      if (field.type === "checkbox") {
        rawValues[field.key] = formData.get(key) ? "true" : "false";
      } else {
        rawValues[field.key] = String(formData.get(key) || "").trim();
      }
    });

    const visibleFields = fields.filter((field) => fieldShouldBeIncluded(field, rawValues));
    const values: Record<string, string> = {};
    for (const field of visibleFields) {
      const value = rawValues[field.key] || "";
      if (field.required && !value) {
        redirect(createSubmissionUrl({ error: `Required field missing: ${field.label}` }));
      }
      values[field.key] = value;
    }

    const { data: insertedSubmission, error: submissionInsertError } = await supabase
      .from("form_submissions")
      .insert({
        form_id: formId,
        status: "open",
        values_json: values,
        submitted_by: currentUser.id,
      })
      .select("id")
      .single();

    if (submissionInsertError || !insertedSubmission?.id) {
      redirect(createSubmissionUrl({ error: submissionInsertError?.message || "Failed to create submission" }));
    }

    const { data: actions } = await supabase
      .from("form_submission_actions")
      .select(
        "id,label,task_title_template,task_description_template,assignee_user_id,priority,enabled"
      )
      .eq("form_id", formId)
      .eq("enabled", true)
      .order("position", { ascending: true })
      .order("created_at", { ascending: true });

    const defaultContentText = extractPlainText(DEFAULT_EDITOR_CONTENT);
    for (const action of (actions || []) as Array<{
      id: string;
      task_title_template: string;
      task_description_template: string | null;
      assignee_user_id: string | null;
      priority: string | null;
    }>) {
      const taskTitle = renderTemplate(action.task_title_template || "", values).trim();
      if (!taskTitle) continue;
      const taskDescription = renderTemplate(
        action.task_description_template || "",
        values
      ).trim();

      const { data: insertedTask, error: taskError } = await supabase
        .from("tasks")
        .insert({
          title: taskTitle,
          description: taskDescription || null,
          status: "to_do",
          priority: normalizeFormActionPriority(action.priority),
          assignee_user_id: action.assignee_user_id,
          content: DEFAULT_EDITOR_CONTENT,
          content_text: defaultContentText,
        })
        .select("id")
        .single();

      if (taskError || !insertedTask?.id) {
        continue;
      }

      if (action.assignee_user_id) {
        await supabase.from("task_assignees").upsert(
          {
            task_id: insertedTask.id,
            user_id: action.assignee_user_id,
          },
          { onConflict: "task_id,user_id" }
        );
      }

      await supabase.from("form_submission_action_tasks").insert({
        submission_id: insertedSubmission.id,
        action_id: action.id,
        task_id: insertedTask.id,
      });
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
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Form</p>
          <h1 className="text-2xl font-semibold text-slate-900">{form.title}</h1>
          <p className="mt-1 text-sm text-slate-600">
            {submissions.filter((submission) => {
              const status = String(submission.status || "open");
              return status !== "completed" && status !== "rejected";
            }).length}{" "}
            open submissions
          </p>
        </div>
        <Link
          href={returnTo}
          className="rounded-md border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:border-slate-400 hover:text-slate-900"
        >
          Back to forms
        </Link>
      </div>

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

      {activeTab === "configure" ? (
        <section className="rounded-lg border border-slate-200 bg-white">
          <div className="border-b border-slate-200 px-6 py-4">
            <h2 className="text-lg font-semibold text-slate-900">Form configuration</h2>
          </div>
          <form action={saveForm} className="space-y-4 px-6 py-4">
            <div className="grid gap-4 md:grid-cols-3">
              <label className="md:col-span-2 text-xs font-semibold uppercase tracking-wide text-slate-600">
                Form title
                <input
                  name="title"
                  required
                  defaultValue={form.title}
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
                />
              </label>
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                Status
                <select
                  name="status"
                  defaultValue={normalizeFormStatus(form.status)}
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
                >
                  {formStatusOptions.map((status) => (
                    <option key={status} value={status}>
                      {formatFormLabel(status)}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label className="block text-xs font-semibold uppercase tracking-wide text-slate-600">
              Description
              <textarea
                name="description"
                rows={3}
                defaultValue={form.description || ""}
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
              />
            </label>
            <FormFieldsBuilder initialFields={formFields} />
            <FormActionsBuilder initialActions={actions} users={users || []} />
            <button
              type="submit"
              className="rounded-md btn-primary px-4 py-2 text-sm font-semibold text-white"
            >
              Save form
            </button>
          </form>
        </section>
      ) : null}

      {activeTab === "create_submission" ? (
        <section className="rounded-lg border border-slate-200 bg-white">
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
        <section className="rounded-lg border border-slate-200 bg-white">
        <div className="border-b border-slate-200 px-6 py-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-semibold text-slate-900">Submissions</h2>
            <div className="flex flex-wrap items-center gap-2 text-xs">
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
                  <td className="px-6 py-6 text-sm text-slate-500" colSpan={4}>
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
