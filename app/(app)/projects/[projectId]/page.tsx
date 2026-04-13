import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import ProjectTabs from "./_components/ProjectTabs";
import ConfirmDelete from "../../_components/ConfirmDelete";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  isSupabaseMissingColumnError,
  isSupabaseMissingTableError,
} from "@/lib/supabaseErrors";
import {
  normalizeCustomFieldKind,
  toCustomFieldKey,
  type CustomFieldOptionRow,
  type CustomFieldRow,
  type CustomFieldValueRow,
} from "@/lib/customFields";
import { buildStatusOptions, type StatusOptionRow } from "@/lib/statusOptions";

function formatProjectStatusLabel(value: string) {
  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export default async function ProjectOverviewPage(props: {
  params: Promise<{ projectId: string }>;
  searchParams?: Promise<{ error?: string; success?: string; add_field?: string }>;
}) {
  const params = await props.params;
  const searchParams = await props.searchParams;
  const showAddFieldModal = searchParams?.add_field === "1";
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
  const currentUserId = currentUser?.id;
  const isAdmin = currentUser?.role === "admin";
  const { data: project } = await supabase
    .from("projects")
    .select(
      "id,name,code,status,description,start_date,end_date,budget,client_id,created_by_user_id,clients(name)"
    )
    .eq("id", params.projectId)
    .single();

  if (!project) {
    notFound();
  }

  let projectStatusRows: StatusOptionRow[] = [];
  const projectStatusResponse = await supabase
    .from("status_options")
    .select("entity_type,value,position,is_visible,counts_as_completed,color_hex")
    .eq("entity_type", "project")
    .order("position", { ascending: true })
    .order("value", { ascending: true });

  if (!projectStatusResponse.error) {
    projectStatusRows = (projectStatusResponse.data || []) as StatusOptionRow[];
  } else if (isSupabaseMissingColumnError(projectStatusResponse.error)) {
    const legacyProjectStatusResponse = await supabase
      .from("status_options")
      .select("entity_type,value,position")
      .eq("entity_type", "project")
      .order("position", { ascending: true })
      .order("value", { ascending: true });
    projectStatusRows = (legacyProjectStatusResponse.data || []) as StatusOptionRow[];
  } else if (!isSupabaseMissingTableError(projectStatusResponse.error)) {
    console.error("[projects.overview.status_options]", projectStatusResponse.error.message);
  }

  const projectStatusOptions = buildStatusOptions(
    "project",
    projectStatusRows,
    project.status ? [project.status] : []
  );
  const projectStatusSet = new Set(projectStatusOptions);
  const currentProjectStatus = project.status || projectStatusOptions[0] || "planned";

  const { data: customFieldsRaw, error: customFieldsError } = await supabase
    .from("custom_fields")
    .select("id,entity_type,entity_id,key,label,field_kind,position")
    .eq("entity_type", "project")
    .eq("entity_id", project.id)
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
        .eq("entity_type", "project")
        .eq("entity_id", project.id)
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

  const projectId = project.id;
  const projectCode = project.code || "";
  const canDeleteProject =
    isAdmin || (currentUserId && project.created_by_user_id === currentUserId);

  if (!isAdmin && currentUserId) {
    const { data: assignment } = await supabase
      .from("project_users")
      .select("user_id")
      .eq("project_id", projectId)
      .eq("user_id", currentUserId)
      .maybeSingle();
    const { data: watching } = await supabase
      .from("project_watchers")
      .select("user_id")
      .eq("project_id", projectId)
      .eq("user_id", currentUserId)
      .maybeSingle();
    if (!assignment && !watching) {
      redirect("/projects?error=Not%20assigned%20to%20that%20project");
    }
  } else if (!isAdmin && !currentUserId) {
    redirect("/projects?error=User%20profile%20missing");
  }

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

  async function updateProject(formData: FormData) {
    "use server";
    const supabase = createSupabaseServerClient();
    const name = String(formData.get("name") || "").trim();
    const code = String(formData.get("code") || projectCode).trim();
    const status = String(formData.get("status") || currentProjectStatus).trim();
    const description = String(formData.get("description") || "").trim();
    const startDate = String(formData.get("start_date") || "");
    const endDate = String(formData.get("end_date") || "");
    const budget = String(formData.get("budget") || "").trim();

    if (!name) {
      redirect(`/projects/${projectId}?error=Name%20is%20required`);
    }
    if (!projectStatusSet.has(status)) {
      redirect(`/projects/${projectId}?error=Invalid%20project%20status`);
    }

    const { error } = await supabase
      .from("projects")
      .update({
        name,
        code,
        status,
        description: description || null,
        start_date: startDate || null,
        end_date: endDate || null,
        budget: budget ? Number(budget) : null,
      })
      .eq("id", projectId);

    if (error) {
      redirect(`/projects/${projectId}?error=${encodeURIComponent(error.message)}`);
    }

    const clears: string[] = [];
    const upserts: Array<{
      entity_type: "project";
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
          redirect(`/projects/${projectId}?error=${encodeURIComponent(`Invalid value for ${field.label}`)}`);
        }
      }

      upserts.push({
        entity_type: "project",
        entity_id: projectId,
        field_id: field.id,
        text_value: field.field_kind === "text" ? value : null,
        option_value: field.field_kind === "dropdown" ? value : null,
      });
    }

    if (clears.length) {
      const { error: clearError } = await supabase
        .from("custom_field_values")
        .delete()
        .eq("entity_type", "project")
        .eq("entity_id", projectId)
        .in("field_id", clears);
      if (clearError && !isSupabaseMissingTableError(clearError)) {
        redirect(`/projects/${projectId}?error=${encodeURIComponent(clearError.message)}`);
      }
    }

    if (upserts.length) {
      const { error: upsertError } = await supabase.from("custom_field_values").upsert(
        upserts,
        { onConflict: "entity_type,entity_id,field_id" }
      );
      if (upsertError && !isSupabaseMissingTableError(upsertError)) {
        redirect(`/projects/${projectId}?error=${encodeURIComponent(upsertError.message)}`);
      }
    }

    revalidatePath(`/projects/${projectId}`);
    redirect(`/projects/${projectId}?success=Saved`);
  }

  async function createProjectCustomField(formData: FormData) {
    "use server";
    const supabase = createSupabaseServerClient();
    const label = String(formData.get("label") || "").trim();
    const fieldKind = normalizeCustomFieldKind(
      String(formData.get("field_kind") || "").trim().toLowerCase()
    );
    const optionsCsv = String(formData.get("options_csv") || "").trim();

    if (!label) {
      redirect(`/projects/${projectId}?error=Custom%20field%20label%20is%20required`);
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
      .eq("entity_type", "project")
      .eq("entity_id", projectId)
      .order("position", { ascending: false })
      .limit(1)
      .maybeSingle();
    const nextPosition = (lastField?.position || 0) + 1;

    const { data: createdField, error } = await supabase
      .from("custom_fields")
      .insert({
        entity_type: "project",
        entity_id: projectId,
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
      redirect(`/projects/${projectId}?error=${encodeURIComponent(`${error.message}${hint}`)}`);
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
          redirect(`/projects/${projectId}?error=${encodeURIComponent(optionsError.message)}`);
        }
      }
    }

    revalidatePath(`/projects/${projectId}`);
    redirect(`/projects/${projectId}?success=Custom%20field%20added`);
  }

  async function deleteProjectCustomField(formData: FormData) {
    "use server";
    const supabase = createSupabaseServerClient();
    const id = String(formData.get("id") || "").trim();
    if (!id) {
      redirect(`/projects/${projectId}?error=Missing%20custom%20field%20id`);
    }
    const { error } = await supabase
      .from("custom_fields")
      .delete()
      .eq("id", id)
      .eq("entity_type", "project")
      .eq("entity_id", projectId);
    if (error) {
      redirect(`/projects/${projectId}?error=${encodeURIComponent(error.message)}`);
    }
    revalidatePath(`/projects/${projectId}`);
    redirect(`/projects/${projectId}?success=Custom%20field%20deleted`);
  }

  return (
    <div className="space-y-8">
      <section className="space-y-2">
        <p className="text-sm font-semibold uppercase tracking-wide text-slate-500">
          Project
        </p>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <h1 className="text-3xl font-semibold text-slate-900">{project.name}</h1>
          {canDeleteProject ? (
            <form method="post" action={`/projects/${projectId}/delete`}>
              <ConfirmDelete
                name={project.name}
                itemType="Project"
                triggerLabel="Delete project"
                confirmLabel="Permanently delete"
              />
            </form>
          ) : null}
        </div>
        <p className="text-sm text-slate-600">
          Client: {getRelationName(project.clients, "--")}
        </p>
      </section>

      <ProjectTabs projectId={projectId} active="overview" />

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

      <section className="rounded-lg border border-slate-200 bg-white p-6">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-slate-900">Project details</h2>
          <Link
            href={`/projects/${projectId}?add_field=1`}
            className="rounded-md border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100"
          >
            Add field
          </Link>
        </div>
        <form action={updateProject} className="mt-4 grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <label className="text-sm font-medium text-slate-700" htmlFor="name">
              Name
            </label>
            <input
              id="name"
              name="name"
              defaultValue={project.name}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              required
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-slate-700" htmlFor="status">
              Status
            </label>
            <select
              id="status"
              name="status"
              defaultValue={currentProjectStatus}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            >
              {projectStatusOptions.map((status) => (
                <option key={status} value={status}>
                  {formatProjectStatusLabel(status)}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-slate-700" htmlFor="budget">
              Budget
            </label>
            <input
              id="budget"
              name="budget"
              type="number"
              step="0.01"
              defaultValue={project.budget ?? ""}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-slate-700" htmlFor="start_date">
              Start date
            </label>
            <input
              id="start_date"
              name="start_date"
              type="date"
              defaultValue={project.start_date || ""}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-slate-700" htmlFor="end_date">
              End date
            </label>
            <input
              id="end_date"
              name="end_date"
              type="date"
              defaultValue={project.end_date || ""}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
          {customFields.map((field) => {
            const value = customFieldValueByFieldId.get(field.id) || "";
            const inputId = `custom-field-${field.id}`;
            if (field.field_kind === "dropdown") {
              return (
                <div key={field.id} className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <label className="text-sm font-medium text-slate-700" htmlFor={inputId}>
                      {field.label}
                    </label>
                    <button
                      type="submit"
                      formAction={deleteProjectCustomField}
                      name="id"
                      value={field.id}
                      className="rounded-md border border-red-200 bg-red-50 px-2 py-1 text-[10px] font-semibold text-red-700 hover:bg-red-100"
                    >
                      Delete
                    </button>
                  </div>
                  <select
                    id={inputId}
                    name={`cf_${field.id}`}
                    defaultValue={value}
                    className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
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
            return (
              <div key={field.id} className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <label className="text-sm font-medium text-slate-700" htmlFor={inputId}>
                    {field.label}
                  </label>
                  <button
                    type="submit"
                    formAction={deleteProjectCustomField}
                    name="id"
                    value={field.id}
                    className="rounded-md border border-red-200 bg-red-50 px-2 py-1 text-[10px] font-semibold text-red-700 hover:bg-red-100"
                  >
                    Delete
                  </button>
                </div>
                <input
                  id={inputId}
                  name={`cf_${field.id}`}
                  defaultValue={value}
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
            );
          })}
          <div className="space-y-2 md:col-span-2">
            <label className="text-sm font-medium text-slate-700" htmlFor="description">
              Description
            </label>
            <textarea
              id="description"
              name="description"
              rows={4}
              defaultValue={project.description || ""}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
          <div className="md:col-span-2">
            <button
              type="submit"
              className="rounded-md btn-primary px-4 py-2 text-sm font-semibold text-white "
            >
              Save changes
            </button>
          </div>
        </form>
        {showAddFieldModal ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 px-4">
            <div className="w-full max-w-xl rounded-xl border border-slate-200 bg-white p-5 shadow-xl">
              <div className="mb-4 flex items-center justify-between gap-3">
                <h3 className="text-base font-semibold text-slate-900">Add field to project</h3>
                <Link
                  href={`/projects/${projectId}`}
                  className="rounded-md border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                >
                  Close
                </Link>
              </div>
              <form action={createProjectCustomField} className="grid gap-3">
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
                </select>
                <input
                  name="options_csv"
                  placeholder="Dropdown options (comma-separated)"
                  className="rounded-md border border-slate-300 px-3 py-2 text-sm"
                />
                <div className="flex items-center justify-end gap-2 pt-1">
                  <Link
                    href={`/projects/${projectId}`}
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
      </section>

    </div>
  );
}



