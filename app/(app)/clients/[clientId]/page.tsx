import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import ClientTabs from "./_components/ClientTabs";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isSupabaseMissingTableError } from "@/lib/supabaseErrors";
import {
  normalizeCustomFieldKind,
  toCustomFieldKey,
  type CustomFieldOptionRow,
  type CustomFieldRow,
  type CustomFieldValueRow,
} from "@/lib/customFields";
import ConfirmDelete from "../../_components/ConfirmDelete";

export const dynamic = "force-dynamic";

const statusOptions = ["prospect", "active", "on_hold", "offboarded"] as const;
const visibilityOptions = ["internal", "client_shared"] as const;
const toClientCode = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)+/g, "");

type ClientNoteRow = {
  id: string;
  title?: string | null;
  content?: string | null;
  visibility?: string | null;
  created_at?: string | null;
  last_edited_at?: string | null;
  last_edited_by_user_id?: string | null;
  user_id?: string | null;
};

type EditorUserRow = {
  id: string;
  full_name?: string | null;
  email?: string | null;
};

function isMissingColumnError(error: unknown) {
  if (!error || typeof error !== "object") {
    return false;
  }
  const anyError = error as { code?: unknown; message?: unknown };
  const code = typeof anyError.code === "string" ? anyError.code : "";
  const message = typeof anyError.message === "string" ? anyError.message : "";
  return code === "42703" || message.includes("does not exist");
}

function truncate(value: string, max = 80) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text) {
    return "";
  }
  if (text.length <= max) {
    return text;
  }
  return `${text.slice(0, max - 1)}…`;
}

async function ensureUniqueClientCode(
  supabase: ReturnType<typeof createSupabaseServerClient>,
  base: string,
  excludeClientId: string
) {
  const safeBase = base || "client";
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const candidate = attempt === 0 ? safeBase : `${safeBase}-${attempt + 1}`;
    const { data } = await supabase
      .from("clients")
      .select("id")
      .eq("code", candidate)
      .neq("id", excludeClientId)
      .maybeSingle();
    if (!data) {
      return candidate;
    }
  }
  return `${safeBase}-${Date.now()}`;
}

export default async function ClientOverviewPage(props: {
  params: Promise<{ clientId: string }>;
  searchParams?: Promise<{ error?: string; success?: string; add_field?: string }>;
}) {
  const params = await props.params;
  const searchParams = await props.searchParams;
  const clientId = params.clientId;
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
  const isAdmin = currentUser?.role === "admin";

  const { data: client } = await supabase
    .from("clients")
    .select(
      "id,name,code,status,industry,account_owner,website,notes,created_at,start_date,contract_renewal_date,hq_address"
    )
    .eq("id", params.clientId)
    .single();

  if (!client) {
    notFound();
  }

  const { data: customFieldsRaw, error: customFieldsError } = await supabase
    .from("custom_fields")
    .select("id,entity_type,entity_id,key,label,field_kind,position")
    .eq("entity_type", "client")
    .eq("entity_id", clientId)
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
        .eq("entity_type", "client")
        .eq("entity_id", clientId)
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

  let supportsNotePages = true;
  let clientNotes: ClientNoteRow[] | null = null;
  let clientNotesError: unknown = null;

  const { data: notePageRows, error: notePageError } = await supabase
    .from("notes")
    .select(
      "id,title,content,created_at,last_edited_at,last_edited_by_user_id,user_id,visibility"
    )
    .eq("client_id", clientId)
    .order("last_edited_at", { ascending: false })
    .order("created_at", { ascending: false });

  if (notePageError && isMissingColumnError(notePageError)) {
    supportsNotePages = false;
    const { data: legacyRows, error: legacyError } = await supabase
      .from("notes")
      .select("id,content,created_at,user_id")
      .eq("client_id", clientId)
      .order("created_at", { ascending: false });

    clientNotes = legacyRows as ClientNoteRow[] | null;
    clientNotesError = legacyError;
  } else {
    clientNotes = notePageRows as ClientNoteRow[] | null;
    clientNotesError = notePageError;
  }

  const lastEditorIds = supportsNotePages
    ? Array.from(
        new Set(
          (clientNotes || [])
            .map((note) => note.last_edited_by_user_id || note.user_id)
            .filter(Boolean)
        )
      )
    : [];

  const { data: editorUsers } =
    supportsNotePages && lastEditorIds.length
      ? await supabase
          .from("users")
          .select("id,full_name,email")
          .in("id", lastEditorIds)
      : { data: [] as EditorUserRow[] };

  const editorMap = new Map<string, string>(
    ((editorUsers || []) as EditorUserRow[]).map((user) => [
      user.id,
      user.full_name || user.email || "Unknown user",
    ])
  );

  const { data: users } = isAdmin
    ? await supabase
        .from("users")
        .select("id,full_name,email")
        .order("full_name", { ascending: true })
    : { data: [] as { id: string; full_name: string | null; email: string | null }[] };

  const { data: ownerUsers } = await supabase
    .from("users")
    .select("id,full_name,email")
    .order("full_name", { ascending: true });
  const accountOwnerOptions = (ownerUsers || [])
    .map((user) => user.full_name || user.email || "")
    .filter(Boolean);
  const hasLegacyAccountOwner =
    Boolean(client.account_owner) && !accountOwnerOptions.includes(client.account_owner);

  const { data: clientUsers } = isAdmin
    ? await supabase
        .from("client_users")
        .select("user_id")
        .eq("client_id", clientId)
    : { data: [] as { user_id: string }[] };

  const assignedClientUserIds = new Set(
    (clientUsers || []).map((row) => row.user_id).filter(Boolean)
  );

  async function updateClientMembers(formData: FormData) {
    "use server";
    const supabase = createSupabaseServerClient();
    const { data: authData } = await supabase.auth.getUser();
    const authEmail = authData.user?.email;
    if (!authEmail) {
      redirect("/login");
    }

    const { data: editor } = await supabase
      .from("users")
      .select("role")
      .eq("email", authEmail)
      .maybeSingle();

    if (editor?.role !== "admin") {
      redirect(`/clients/${clientId}?error=Not%20allowed`);
    }

    const selectedIds = formData
      .getAll("assigned_user_ids")
      .map((value) => String(value).trim())
      .filter(Boolean);

    await supabase.from("client_users").delete().eq("client_id", clientId);

    if (selectedIds.length) {
      const inserts = selectedIds.map((userId) => ({
        client_id: clientId,
        user_id: userId,
      }));
      const { error } = await supabase.from("client_users").insert(inserts);
      if (error) {
        redirect(`/clients/${clientId}?error=${encodeURIComponent(error.message)}`);
      }
    }

    revalidatePath(`/clients/${clientId}`);
    redirect(`/clients/${clientId}?success=Client%20members%20updated`);
  }

  async function updateClient(formData: FormData) {
    "use server";
    const supabase = createSupabaseServerClient();
    const name = String(formData.get("name") || "").trim();
    const status = String(formData.get("status") || "active");
    const industry = String(formData.get("industry") || "").trim();
    const accountOwner = String(formData.get("account_owner") || "").trim();
    const website = String(formData.get("website") || "").trim();
    const startDate = String(formData.get("start_date") || "");
    const contractRenewalDate = String(formData.get("contract_renewal_date") || "");
    const hqAddress = String(formData.get("hq_address") || "").trim();
    const notes = String(formData.get("notes") || "").trim();

    if (!name) {
      redirect(`/clients/${clientId}?error=${encodeURIComponent("Name is required")}`);
    }

    const { data: currentClient, error: currentClientError } = await supabase
      .from("clients")
      .select("code")
      .eq("id", clientId)
      .single();
    if (currentClientError) {
      redirect(`/clients/${clientId}?error=${encodeURIComponent(currentClientError.message)}`);
    }

    const currentCode = String(currentClient?.code || "").trim();
    const safeCode = currentCode || (await ensureUniqueClientCode(supabase, toClientCode(name), clientId));

    const { error } = await supabase
      .from("clients")
      .update({
        name,
        code: safeCode,
        status,
        industry: industry || null,
        account_owner: accountOwner || null,
        website: website || null,
        start_date: startDate || null,
        contract_renewal_date: contractRenewalDate || null,
        hq_address: hqAddress || null,
        notes: notes || null,
      })
      .eq("id", clientId);

    if (error) {
      redirect(`/clients/${clientId}?error=${encodeURIComponent(error.message)}`);
    }

    const clears: string[] = [];
    const upserts: Array<{
      entity_type: "client";
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
          redirect(`/clients/${clientId}?error=${encodeURIComponent(`Invalid value for ${field.label}`)}`);
        }
      }

      upserts.push({
        entity_type: "client",
        entity_id: clientId,
        field_id: field.id,
        text_value: field.field_kind === "text" ? value : null,
        option_value: field.field_kind === "dropdown" ? value : null,
      });
    }

    if (clears.length) {
      const { error: clearError } = await supabase
        .from("custom_field_values")
        .delete()
        .eq("entity_type", "client")
        .eq("entity_id", clientId)
        .in("field_id", clears);
      if (clearError && !isSupabaseMissingTableError(clearError)) {
        redirect(`/clients/${clientId}?error=${encodeURIComponent(clearError.message)}`);
      }
    }

    if (upserts.length) {
      const { error: upsertError } = await supabase.from("custom_field_values").upsert(
        upserts,
        { onConflict: "entity_type,entity_id,field_id" }
      );
      if (upsertError && !isSupabaseMissingTableError(upsertError)) {
        redirect(`/clients/${clientId}?error=${encodeURIComponent(upsertError.message)}`);
      }
    }

    revalidatePath(`/clients/${clientId}`);
    revalidatePath(`/clients/${clientId}/notes`);
    redirect(`/clients/${clientId}?success=Saved`);
  }

  async function createClientCustomField(formData: FormData) {
    "use server";
    const supabase = createSupabaseServerClient();
    const label = String(formData.get("label") || "").trim();
    const fieldKind = normalizeCustomFieldKind(
      String(formData.get("field_kind") || "").trim().toLowerCase()
    );
    const optionsCsv = String(formData.get("options_csv") || "").trim();

    if (!label) {
      redirect(`/clients/${clientId}?error=Custom%20field%20label%20is%20required`);
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
      .eq("entity_type", "client")
      .eq("entity_id", clientId)
      .order("position", { ascending: false })
      .limit(1)
      .maybeSingle();
    const nextPosition = (lastField?.position || 0) + 1;

    const { data: createdField, error } = await supabase
      .from("custom_fields")
      .insert({
        entity_type: "client",
        entity_id: clientId,
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
      redirect(`/clients/${clientId}?error=${encodeURIComponent(`${error.message}${hint}`)}`);
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
          redirect(`/clients/${clientId}?error=${encodeURIComponent(optionsError.message)}`);
        }
      }
    }

    revalidatePath(`/clients/${clientId}`);
    redirect(`/clients/${clientId}?success=Custom%20field%20added`);
  }

  async function deleteClientCustomField(formData: FormData) {
    "use server";
    const supabase = createSupabaseServerClient();
    const id = String(formData.get("id") || "").trim();
    if (!id) {
      redirect(`/clients/${clientId}?error=Missing%20custom%20field%20id`);
    }
    const { error } = await supabase
      .from("custom_fields")
      .delete()
      .eq("id", id)
      .eq("entity_type", "client")
      .eq("entity_id", clientId);
    if (error) {
      redirect(`/clients/${clientId}?error=${encodeURIComponent(error.message)}`);
    }
    revalidatePath(`/clients/${clientId}`);
    redirect(`/clients/${clientId}?success=Custom%20field%20deleted`);
  }

  async function deleteNote(formData: FormData) {
    "use server";
    const supabase = createSupabaseServerClient();
    const noteId = String(formData.get("note_id") || "");

    if (!noteId) {
      return;
    }

    const { error } = await supabase
      .from("notes")
      .delete()
      .eq("id", noteId)
      .eq("client_id", clientId);

    if (error) {
      redirect(`/clients/${clientId}?error=${encodeURIComponent(error.message)}`);
    }

    revalidatePath(`/clients/${clientId}`);
    redirect(`/clients/${clientId}?success=Note%20deleted`);
  }

  async function createNoteLegacy(formData: FormData) {
    "use server";
    const supabase = createSupabaseServerClient();
    const content = String(formData.get("content") || "").trim();
    const visibility = String(formData.get("visibility") || "internal");

    if (!content) {
      redirect(`/clients/${clientId}?error=Note%20content%20is%20required`);
    }

    const { data: authData } = await supabase.auth.getUser();
    const authUser = authData.user;

    if (!authUser) {
      redirect(`/clients/${clientId}?error=You%20must%20be%20signed%20in%20to%20add%20notes`);
    }

    const { error } = await supabase.from("notes").insert({
      client_id: clientId,
      project_id: null,
      content,
      visibility,
      user_id: authUser.id,
    });

    if (error) {
      redirect(`/clients/${clientId}?error=${encodeURIComponent(error.message)}`);
    }

    revalidatePath(`/clients/${clientId}`);
    redirect(`/clients/${clientId}?success=Note%20saved`);
  }

  return (
    <div className="space-y-8">
      <section className="space-y-2">
        <p className="text-sm font-semibold uppercase tracking-wide text-slate-500">
          Client
        </p>
        <h1 className="text-3xl font-semibold text-slate-900">{client.name}</h1>
      </section>

      <ClientTabs clientId={clientId} active="overview" />

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

      {isAdmin ? (
        <details className="rounded-lg border border-slate-200 bg-white">
          <summary className="cursor-pointer select-none px-6 py-4 text-lg font-semibold text-slate-900">
            Client members
          </summary>
          <div className="border-t border-slate-200 px-6 pb-6">
            <p className="mt-4 text-sm text-slate-600">
              Only assigned members can view and edit this client.
            </p>
            {users?.length ? (
              <form action={updateClientMembers} className="mt-4 space-y-4">
                <div className="grid gap-2 sm:grid-cols-2">
                  {users.map((user) => (
                    <label
                      key={user.id}
                      className="flex items-center gap-2 text-sm text-slate-700"
                    >
                      <input
                        type="checkbox"
                        name="assigned_user_ids"
                        value={user.id}
                        defaultChecked={assignedClientUserIds.has(user.id)}
                      />
                      <span>{user.full_name || user.email}</span>
                    </label>
                  ))}
                </div>
                <button
                  type="submit"
                  className="rounded-md btn-primary px-4 py-2 text-sm font-semibold text-white "
                >
                  Save members
                </button>
              </form>
            ) : (
              <p className="mt-4 text-sm text-slate-500">No users found.</p>
            )}
          </div>
        </details>
      ) : null}

      <section className="rounded-lg border border-slate-200 bg-white p-6">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-slate-900">Client details</h2>
          <Link
            href={`/clients/${clientId}?add_field=1`}
            className="rounded-md border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100"
          >
            Add field
          </Link>
        </div>
        <form action={updateClient} className="mt-4 grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <label className="text-sm font-medium text-slate-700" htmlFor="name">
              Name
            </label>
            <input
              id="name"
              name="name"
              defaultValue={client.name}
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
              defaultValue={client.status || "active"}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            >
              {statusOptions.map((option) => (
                <option key={option} value={option}>
                  {option.replace("_", " ")}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-slate-700" htmlFor="industry">
              Industry
            </label>
            <input
              id="industry"
              name="industry"
              defaultValue={client.industry || ""}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-slate-700" htmlFor="website">
              Website
            </label>
            <input
              id="website"
              name="website"
              defaultValue={client.website || ""}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-slate-700" htmlFor="account_owner">
              Account owner
            </label>
            <select
              id="account_owner"
              name="account_owner"
              defaultValue={client.account_owner || ""}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            >
              <option value="">Unassigned</option>
              {hasLegacyAccountOwner ? (
                <option value={client.account_owner || ""}>
                  {client.account_owner}
                </option>
              ) : null}
              {accountOwnerOptions.map((label) => (
                <option key={label} value={label}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-slate-700" htmlFor="start_date">
              Start date
            </label>
            <input
              id="start_date"
              name="start_date"
              type="date"
              defaultValue={client.start_date || ""}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
          <div className="space-y-2">
            <label
              className="text-sm font-medium text-slate-700"
              htmlFor="contract_renewal_date"
            >
              Contract renewal date
            </label>
            <input
              id="contract_renewal_date"
              name="contract_renewal_date"
              type="date"
              defaultValue={client.contract_renewal_date || ""}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
          <div className="space-y-2 md:col-span-2">
            <label className="text-sm font-medium text-slate-700" htmlFor="hq_address">
              HQ address
            </label>
            <textarea
              id="hq_address"
              name="hq_address"
              defaultValue={client.hq_address || ""}
              rows={3}
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
                    <form action={deleteClientCustomField}>
                      <input type="hidden" name="id" value={field.id} />
                      <button
                        type="submit"
                        className="rounded-md border border-red-200 bg-red-50 px-2 py-1 text-[10px] font-semibold text-red-700 hover:bg-red-100"
                      >
                        Delete
                      </button>
                    </form>
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
                  <form action={deleteClientCustomField}>
                    <input type="hidden" name="id" value={field.id} />
                    <button
                      type="submit"
                      className="rounded-md border border-red-200 bg-red-50 px-2 py-1 text-[10px] font-semibold text-red-700 hover:bg-red-100"
                    >
                      Delete
                    </button>
                  </form>
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
                <h3 className="text-base font-semibold text-slate-900">Add field to client</h3>
                <Link
                  href={`/clients/${clientId}`}
                  className="rounded-md border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                >
                  Close
                </Link>
              </div>
              <form action={createClientCustomField} className="grid gap-3">
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
                    href={`/clients/${clientId}`}
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

        <div className="mt-8 border-t border-slate-200 pt-6">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-base font-semibold text-slate-900">Notes</h3>
            <Link
              href={`/clients/${clientId}/notes`}
              className="text-sm font-semibold text-slate-700 hover:text-slate-900 hover:underline"
            >
              View all notes
            </Link>
          </div>

          {clientNotesError && !isMissingColumnError(clientNotesError) ? (
            <p className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              Unable to load notes. Check Supabase RLS policies for the notes table.
            </p>
          ) : null}

          {supportsNotePages ? (
            <div className="mt-4 space-y-2">
              {clientNotes?.length ? (
                clientNotes.slice(0, 6).map((note) => {
                  const lastEditedAt = note.last_edited_at || note.created_at;
                  const editedById = note.last_edited_by_user_id || note.user_id || "";
                  const editedByLabel = editedById ? editorMap.get(editedById) : "";

                  return (
                    <Link
                      key={note.id}
                      href={`/clients/${clientId}/notes/${note.id}`}
                      className="block rounded-md border border-slate-200 px-3 py-2 hover:bg-slate-50"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-semibold text-slate-900">
                          {note.title || "Untitled"}
                        </span>
                        <span className="text-xs text-slate-500">
                          {lastEditedAt
                            ? new Date(lastEditedAt).toLocaleString("en-US")
                            : "-"}
                          {editedByLabel ? ` • ${editedByLabel}` : ""}
                        </span>
                      </div>
                      {note.content ? (
                        <p className="mt-1 text-xs text-slate-500">
                          {truncate(note.content, 120)}
                        </p>
                      ) : null}
                    </Link>
                  );
                })
              ) : (
                <p className="text-sm text-slate-600 mt-3">No notes yet.</p>
              )}

              <div className="pt-2">
                <Link
                  href={`/clients/${clientId}/notes`}
                  className="inline-flex rounded-md btn-primary px-4 py-2 text-sm font-semibold text-white"
                >
                  New note
                </Link>
              </div>
            </div>
          ) : (
            <>
              <h4 className="mt-4 text-sm font-semibold text-slate-900">
                Published notes
              </h4>
              <form action={createNoteLegacy} className="mt-3 grid gap-3">
                <textarea
                  name="content"
                  rows={3}
                  placeholder="Write a note..."
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                  required
                />
                <div className="flex flex-wrap items-center gap-3">
                  <select
                    name="visibility"
                    className="w-48 rounded-md border border-slate-300 px-3 py-2 text-sm"
                    defaultValue="internal"
                  >
                    {visibilityOptions.map((visibility) => (
                      <option key={visibility} value={visibility}>
                        {visibility.replace("_", " ")}
                      </option>
                    ))}
                  </select>
                  <button
                    type="submit"
                    className="rounded-md btn-primary px-4 py-2 text-sm font-semibold text-white "
                  >
                    Publish note
                  </button>
                </div>
              </form>
              <div className="mt-4 overflow-x-auto">
                <table className="min-w-full text-left text-sm">
                  <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                    <tr>
                      <th className="px-4 py-2">Note</th>
                      <th className="px-4 py-2">Date added</th>
                      <th className="px-4 py-2">User added</th>
                      <th className="px-4 py-2">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {clientNotes?.length ? (
                      clientNotes.map((note) => (
                        <tr key={note.id} className="border-t border-slate-200">
                          <td className="px-4 py-3 text-slate-700">
                            {note.content}
                          </td>
                          <td className="px-4 py-3 text-slate-500">
                            {note.created_at
                              ? new Date(note.created_at).toLocaleDateString("en-US")
                              : ""}
                          </td>
                          <td className="px-4 py-3 text-slate-500">
                            {note.user_id ? "Team member" : "Unknown user"}
                          </td>
                          <td className="px-4 py-3">
                            <form action={deleteNote}>
                              <input type="hidden" name="note_id" value={note.id} />
                              <ConfirmDelete
                                name={truncate(note.content || "", 40) || "this"}
                                itemType="Note"
                              />
                            </form>
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td className="px-4 py-6 text-slate-500" colSpan={4}>
                          No notes yet.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </section>
    </div>
  );
}





