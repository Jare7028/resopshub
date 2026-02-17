import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isSupabaseMissingTableError } from "@/lib/supabaseErrors";
import EmployeeInfoTable from "./EmployeeInfoTable";
import {
  evaluateEmployeeFormula,
  formatFormulaResult,
  normalizeEmployeeInfoColumnKind,
  toEmployeeInfoColumnKey,
} from "@/lib/employeeInfo";

type EmployeeInfoRecordRow = {
  id: string;
  full_name: string;
  client_id: string | null;
  created_at: string;
};

type EmployeeInfoColumnRow = {
  id: string;
  key: string;
  label: string;
  column_kind: "text" | "dropdown" | "formula";
  formula: string | null;
  options_json: unknown;
  position: number;
};

type EmployeeInfoValueRow = {
  record_id: string;
  column_id: string;
  text_value: string | null;
  option_value: string | null;
};

type UserRow = {
  id: string;
  full_name: string | null;
  email: string | null;
  role: string | null;
};

function buildEmployeeInfoUrl(params?: { error?: string; success?: string }) {
  const sp = new URLSearchParams();
  if (params?.error) sp.set("error", params.error);
  if (params?.success) sp.set("success", params.success);
  const qs = sp.toString();
  return qs ? `/employee-info?${qs}` : "/employee-info";
}

function toOptionsJson(raw: string) {
  const options = raw
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  return Array.from(new Set(options));
}

function buildValueMap(
  rows: EmployeeInfoValueRow[]
): Record<string, Record<string, { text_value: string | null; option_value: string | null }>> {
  return rows.reduce<
    Record<string, Record<string, { text_value: string | null; option_value: string | null }>>
  >((acc, row) => {
    if (!acc[row.record_id]) acc[row.record_id] = {};
    acc[row.record_id][row.column_id] = {
      text_value: row.text_value,
      option_value: row.option_value,
    };
    return acc;
  }, {});
}

function buildFormulaValueMap(args: {
  records: EmployeeInfoRecordRow[];
  columns: EmployeeInfoColumnRow[];
  valueMap: Record<string, Record<string, { text_value: string | null; option_value: string | null }>>;
  clientNameById: Record<string, string>;
}) {
  const { records, columns, valueMap, clientNameById } = args;

  const result: Record<string, Record<string, string>> = {};

  records.forEach((record) => {
    result[record.id] = {};
    const columnByDisplayIndex = columns;
    const valuesByColumnId = valueMap[record.id] || {};

    const resolveDisplayIndexValue = (displayIndex: number, visiting: Set<number>): unknown => {
      if (displayIndex === 0) return record.full_name;
      if (displayIndex === 1) return record.client_id ? clientNameById[record.client_id] || "" : "";

      const dynamicIndex = displayIndex - 2;
      if (dynamicIndex < 0 || dynamicIndex >= columnByDisplayIndex.length) return "";
      const column = columnByDisplayIndex[dynamicIndex];

      if (column.column_kind === "formula") {
        if (visiting.has(displayIndex)) return 0;
        visiting.add(displayIndex);
        const nested = evaluateEmployeeFormula(column.formula, (refIndex) =>
          resolveDisplayIndexValue(refIndex, new Set(visiting))
        );
        visiting.delete(displayIndex);
        return nested ?? 0;
      }

      const value = valuesByColumnId[column.id];
      if (!value) return "";
      return column.column_kind === "dropdown" ? value.option_value || "" : value.text_value || "";
    };

    columns.forEach((column, index) => {
      if (column.column_kind !== "formula") return;
      const displayIndex = index + 2;
      const evaluated = evaluateEmployeeFormula(column.formula, (refIndex) =>
        resolveDisplayIndexValue(refIndex, new Set([displayIndex]))
      );
      result[record.id][column.id] = formatFormulaResult(evaluated);
    });
  });

  return result;
}

export default async function EmployeeInfoPage(props: {
  searchParams?: Promise<{ error?: string; success?: string }>;
}) {
  const searchParams = await props.searchParams;
  const supabase = createSupabaseServerClient();
  const { data: authData } = await supabase.auth.getUser();
  const authUserId = authData.user?.id;
  const authEmail = authData.user?.email || "";
  if (!authUserId) {
    redirect("/login");
  }

  const { data: profile } = await supabase
    .from("users")
    .select("id,role")
    .eq("email", authEmail)
    .maybeSingle();
  const currentAppUserId = profile?.id || authUserId;
  const isAdmin = profile?.role === "admin";

  if (!isAdmin) {
    const { data: accessRow, error: accessError } = await supabase
      .from("employee_info_access_users")
      .select("user_id")
      .eq("user_id", currentAppUserId)
      .maybeSingle();
    if (isSupabaseMissingTableError(accessError)) {
      return (
        <div className="space-y-6">
          <section className="space-y-2">
            <h1 className="text-2xl font-semibold text-slate-900">Employee Info</h1>
            <p className="text-sm text-slate-600">
              Manage employee client placement and custom employee fields.
            </p>
          </section>
          <p className="rounded-md border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900">
            Employee Info is not set up yet. Run <code>sql/employee_info.sql</code> in Supabase
            SQL editor, then refresh this page.
          </p>
        </div>
      );
    }
    if (accessError || !accessRow) {
      redirect("/dashboard?error=You%20do%20not%20have%20access%20to%20Employee%20Info");
    }
  }

  const [{ data: clientsRaw }, { data: usersRaw }] = await Promise.all([
    supabase.from("clients").select("id,name").order("name", { ascending: true }),
    supabase.from("users").select("id,full_name,email,role").order("full_name", { ascending: true }),
  ]);
  const clients = (clientsRaw || []) as Array<{ id: string; name: string }>;
  const users = (usersRaw || []) as UserRow[];

  const [{ data: recordsRaw, error: recordsError }, { data: columnsRaw, error: columnsError }] =
    await Promise.all([
      supabase
        .from("employee_info_records")
        .select("id,full_name,client_id,created_at")
        .order("created_at", { ascending: false }),
      supabase
        .from("employee_info_columns")
        .select("id,key,label,column_kind,formula,options_json,position")
        .order("position", { ascending: true })
        .order("created_at", { ascending: true }),
    ]);

  if (isSupabaseMissingTableError(recordsError) || isSupabaseMissingTableError(columnsError)) {
    return (
      <div className="space-y-6">
        <section className="space-y-2">
          <h1 className="text-2xl font-semibold text-slate-900">Employee Info</h1>
          <p className="text-sm text-slate-600">
            Manage employee client placement and custom employee fields.
          </p>
        </section>
        <p className="rounded-md border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900">
          Employee Info is not set up yet. Run <code>sql/employee_info.sql</code> in Supabase SQL
          editor, then refresh this page.
        </p>
      </div>
    );
  }

  const records = (recordsRaw || []) as EmployeeInfoRecordRow[];
  const columns = (columnsRaw || []) as EmployeeInfoColumnRow[];

  const recordIds = records.map((row) => row.id).filter(Boolean);
  const { data: valuesRaw, error: valuesError } = recordIds.length
    ? await supabase
        .from("employee_info_values")
        .select("record_id,column_id,text_value,option_value")
        .in("record_id", recordIds)
    : { data: [] as EmployeeInfoValueRow[], error: null };

  const valueRows = (isSupabaseMissingTableError(valuesError) ? [] : valuesRaw || []) as EmployeeInfoValueRow[];
  const valuesByRecordId = buildValueMap(valueRows);

  const clientNameById = clients.reduce<Record<string, string>>((acc, client) => {
    acc[client.id] = client.name;
    return acc;
  }, {});
  const formulaValueByRecordIdAndColumnId = buildFormulaValueMap({
    records,
    columns,
    valueMap: valuesByRecordId,
    clientNameById,
  });

  const { data: allowedUsersRaw } = isAdmin
    ? await supabase.from("employee_info_access_users").select("user_id")
    : { data: [] as Array<{ user_id: string }> };
  const allowedUserIds = new Set((allowedUsersRaw || []).map((row) => row.user_id));

  async function createRecord(formData: FormData) {
    "use server";
    const supabase = createSupabaseServerClient();
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user?.id) {
      redirect("/login");
    }

    const fullName = String(formData.get("full_name") || "").trim();
    const clientId = String(formData.get("client_id") || "").trim();
    if (!fullName) {
      redirect(buildEmployeeInfoUrl({ error: "Full name is required" }));
    }

    const { data: currentUser } = await supabase
      .from("users")
      .select("id")
      .eq("email", auth.user.email || "")
      .maybeSingle();

    const { error } = await supabase.from("employee_info_records").insert({
      full_name: fullName,
      client_id: clientId || null,
      created_by_user_id: currentUser?.id || auth.user.id,
    });
    if (error) {
      redirect(buildEmployeeInfoUrl({ error: error.message }));
    }

    revalidatePath("/employee-info");
    redirect(buildEmployeeInfoUrl({ success: "Employee record added" }));
  }

  async function updateCell(formData: FormData) {
    "use server";
    const supabase = createSupabaseServerClient();
    const recordId = String(formData.get("record_id") || "").trim();
    const baseField = String(formData.get("base_field") || "").trim();
    const columnId = String(formData.get("column_id") || "").trim();
    const columnKind = normalizeEmployeeInfoColumnKind(String(formData.get("column_kind") || ""));
    const value = String(formData.get("value") || "").trim();

    if (!recordId) return { ok: false, error: "Missing record id" };

    if (baseField === "full_name") {
      if (!value) return { ok: false, error: "Full name is required" };
      const { error } = await supabase
        .from("employee_info_records")
        .update({ full_name: value, updated_at: new Date().toISOString() })
        .eq("id", recordId);
      if (error) return { ok: false, error: error.message };
      revalidatePath("/employee-info");
      return { ok: true };
    }

    if (baseField === "client_id") {
      const { error } = await supabase
        .from("employee_info_records")
        .update({ client_id: value || null, updated_at: new Date().toISOString() })
        .eq("id", recordId);
      if (error) return { ok: false, error: error.message };
      revalidatePath("/employee-info");
      return { ok: true };
    }

    if (!columnId) return { ok: false, error: "Missing column id" };
    if (columnKind === "formula") return { ok: true };

    const normalizedValue = columnKind === "dropdown" ? value : value;
    if (!normalizedValue) {
      const { error } = await supabase
        .from("employee_info_values")
        .delete()
        .eq("record_id", recordId)
        .eq("column_id", columnId);
      if (error) return { ok: false, error: error.message };
      revalidatePath("/employee-info");
      return { ok: true };
    }

    const payload =
      columnKind === "dropdown"
        ? {
            record_id: recordId,
            column_id: columnId,
            option_value: normalizedValue,
            text_value: null,
            updated_at: new Date().toISOString(),
          }
        : {
            record_id: recordId,
            column_id: columnId,
            text_value: normalizedValue,
            option_value: null,
            updated_at: new Date().toISOString(),
          };

    const { error } = await supabase
      .from("employee_info_values")
      .upsert(payload, { onConflict: "record_id,column_id" });
    if (error) return { ok: false, error: error.message };

    revalidatePath("/employee-info");
    return { ok: true };
  }

  async function createColumn(formData: FormData) {
    "use server";
    const supabase = createSupabaseServerClient();
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user?.id) {
      redirect("/login");
    }
    const { data: currentUser } = await supabase
      .from("users")
      .select("id,role")
      .eq("email", auth.user.email || "")
      .maybeSingle();
    if (currentUser?.role !== "admin") {
      redirect(buildEmployeeInfoUrl({ error: "Only admins can add columns" }));
    }

    const label = String(formData.get("label") || "").trim();
    const kind = normalizeEmployeeInfoColumnKind(String(formData.get("column_kind") || ""));
    const optionsRaw = String(formData.get("dropdown_options") || "").trim();
    const formula = String(formData.get("formula") || "").trim();

    if (!label) {
      redirect(buildEmployeeInfoUrl({ error: "Column label is required" }));
    }
    if (kind === "dropdown" && !optionsRaw) {
      redirect(buildEmployeeInfoUrl({ error: "Dropdown options are required" }));
    }
    if (kind === "formula" && !formula) {
      redirect(buildEmployeeInfoUrl({ error: "Formula is required" }));
    }

    const { data: lastColumnRaw } = await supabase
      .from("employee_info_columns")
      .select("position")
      .order("position", { ascending: false })
      .limit(1);
    const nextPosition = Number((lastColumnRaw || [])[0]?.position || 0) + 1;

    const baseKey = toEmployeeInfoColumnKey(label);
    let candidateKey = baseKey;
    for (let i = 2; i < 100; i += 1) {
      const { data: existing } = await supabase
        .from("employee_info_columns")
        .select("id")
        .eq("key", candidateKey)
        .maybeSingle();
      if (!existing) break;
      candidateKey = `${baseKey}_${i}`;
    }

    const payload = {
      key: candidateKey,
      label,
      column_kind: kind,
      formula: kind === "formula" ? formula : null,
      options_json: kind === "dropdown" ? toOptionsJson(optionsRaw) : [],
      position: nextPosition,
      created_by_user_id: currentUser.id,
    };

    const { error } = await supabase.from("employee_info_columns").insert(payload);
    if (error) {
      redirect(buildEmployeeInfoUrl({ error: error.message }));
    }

    revalidatePath("/employee-info");
    redirect(buildEmployeeInfoUrl({ success: "Column added" }));
  }

  async function updateAccessUsers(formData: FormData) {
    "use server";
    const supabase = createSupabaseServerClient();
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user?.id) {
      redirect("/login");
    }
    const { data: currentUser } = await supabase
      .from("users")
      .select("id,role")
      .eq("email", auth.user.email || "")
      .maybeSingle();
    if (currentUser?.role !== "admin") {
      redirect(buildEmployeeInfoUrl({ error: "Only admins can update access users" }));
    }

    const selectedUserIds = Array.from(
      new Set(
        formData
          .getAll("allowed_user_ids")
          .map((value) => String(value).trim())
          .filter(Boolean)
      )
    );

    const { error: deleteError } = await supabase.from("employee_info_access_users").delete().neq(
      "user_id",
      "00000000-0000-0000-0000-000000000000"
    );
    if (deleteError) {
      redirect(buildEmployeeInfoUrl({ error: deleteError.message }));
    }

    if (selectedUserIds.length) {
      const inserts = selectedUserIds.map((userId) => ({
        user_id: userId,
        added_by_user_id: currentUser.id,
      }));
      const { error: insertError } = await supabase.from("employee_info_access_users").insert(inserts);
      if (insertError) {
        redirect(buildEmployeeInfoUrl({ error: insertError.message }));
      }
    }

    revalidatePath("/employee-info");
    redirect(buildEmployeeInfoUrl({ success: "Access users updated" }));
  }

  return (
    <div className="space-y-8">
      <section className="space-y-2">
        <h1 className="text-2xl font-semibold text-slate-900">Employee Info</h1>
        <p className="text-sm text-slate-600">
          Track employee placement by client and maintain custom employee fields.
        </p>
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

      <section className="rounded-lg border border-slate-200 bg-white p-4 md:p-6">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
          Add Employee
        </h2>
        <form action={createRecord} className="mt-3 grid gap-3 md:grid-cols-3">
          <input
            name="full_name"
            placeholder="Full name"
            className="h-11 rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-700"
            required
          />
          <select
            name="client_id"
            defaultValue=""
            className="h-11 rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-700"
          >
            <option value="">Client (N/A)</option>
            {clients.map((client) => (
              <option key={client.id} value={client.id}>
                {client.name}
              </option>
            ))}
          </select>
          <button
            type="submit"
            className="h-11 rounded-md btn-primary px-4 text-sm font-semibold text-white"
          >
            Add employee
          </button>
        </form>
      </section>

      {isAdmin ? (
        <section className="rounded-lg border border-slate-200 bg-white p-4 md:p-6">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
            Add Column
          </h2>
          <p className="mt-1 text-xs text-slate-500">
            Formula columns support spreadsheet-style letters (A=Full Name, B=Client, C onward are
            your custom columns). Example: <code>=(C * D)</code>.
          </p>
          <form action={createColumn} className="mt-3 grid gap-3 md:grid-cols-4">
            <input
              name="label"
              placeholder="Column label"
              className="h-11 rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-700"
              required
            />
            <select
              name="column_kind"
              defaultValue="text"
              className="h-11 rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-700"
            >
              <option value="text">Text</option>
              <option value="dropdown">Dropdown</option>
              <option value="formula">Formula</option>
            </select>
            <input
              name="dropdown_options"
              placeholder="Dropdown options (comma separated)"
              className="h-11 rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-700"
            />
            <input
              name="formula"
              placeholder="Formula (e.g. =(C * D))"
              className="h-11 rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-700"
            />
            <div className="md:col-span-4">
              <button
                type="submit"
                className="h-11 rounded-md border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-100"
              >
                Add column
              </button>
            </div>
          </form>
        </section>
      ) : null}

      {isAdmin ? (
        <section className="rounded-lg border border-slate-200 bg-white p-4 md:p-6">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
            Access Users
          </h2>
          <p className="mt-1 text-xs text-slate-500">
            Non-admin users must be selected here to access Employee Info.
          </p>
          <form action={updateAccessUsers} className="mt-3 space-y-2">
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {users
                .filter((user) => user.role !== "admin")
                .map((user) => (
                  <label
                    key={user.id}
                    className="flex min-h-11 items-center gap-2 rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-700"
                  >
                    <input
                      type="checkbox"
                      name="allowed_user_ids"
                      value={user.id}
                      defaultChecked={allowedUserIds.has(user.id)}
                    />
                    <span>{user.full_name || user.email || "Unnamed user"}</span>
                  </label>
                ))}
            </div>
            <button
              type="submit"
              className="h-11 rounded-md border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-100"
            >
              Save access users
            </button>
          </form>
        </section>
      ) : null}

      <section className="rounded-lg border border-slate-200 bg-white">
        <EmployeeInfoTable
          records={records}
          clients={clients}
          columns={columns}
          valuesByRecordId={valuesByRecordId}
          formulaValueByRecordIdAndColumnId={formulaValueByRecordIdAndColumnId}
          onUpdateCell={updateCell}
        />
      </section>
    </div>
  );
}
