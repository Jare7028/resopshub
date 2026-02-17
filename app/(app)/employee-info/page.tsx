import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isSupabaseMissingTableError } from "@/lib/supabaseErrors";
import EmployeeInfoTable from "./EmployeeInfoTable";
import AddColumnPopover from "./AddColumnPopover";
import type { FormulaSuggestion } from "./FormulaAutocompleteInput";
import {
  columnIndexToLetter,
  evaluateEmployeeFormula,
  formatFormulaResult,
  normalizeEmployeeInfoCurrencyCode,
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
  column_kind: "text" | "dropdown" | "formula" | "number" | "date" | "currency";
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

function normalizeNumberCellValue(rawValue: string) {
  const normalized = String(rawValue || "")
    .trim()
    .replace(/,/g, "");
  if (!normalized) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? String(parsed) : null;
}

function normalizeDateCellValue(rawValue: string) {
  const normalized = String(rawValue || "").trim();
  if (!normalized) return null;
  const match = normalized.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  const isValid =
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day;
  return isValid ? normalized : null;
}

function normalizeCurrencyCellValue(rawValue: string) {
  return normalizeNumberCellValue(rawValue);
}

function buildFormulaSuggestions(columns: EmployeeInfoColumnRow[]) {
  const suggestions: FormulaSuggestion[] = [];
  const seen = new Set<string>();

  const addSuggestion = (token: string, label: string) => {
    const cleaned = String(token || "").trim();
    if (!cleaned) return;
    const signature = cleaned.toLowerCase();
    if (seen.has(signature)) return;
    seen.add(signature);
    suggestions.push({ token: cleaned, label });
  };

  addSuggestion("A", "Full Name");
  addSuggestion("B", "Client");
  addSuggestion("full_name", "Full Name");
  addSuggestion("client", "Client");
  addSuggestion("IF(", "Conditional: IF(condition, value_if_true, value_if_false)");
  addSuggestion("OR(", "Logical OR across multiple conditions");
  addSuggestion("AND(", "Logical AND across multiple conditions");
  addSuggestion("NOT(", "Logical NOT for a condition");
  addSuggestion("SUM(", "Sum values or ranges");
  addSuggestion("ROUND(", "Round a number to a set number of digits");
  addSuggestion("MIN(", "Smallest value");
  addSuggestion("MAX(", "Largest value");
  addSuggestion("AVERAGE(", "Average value");

  columns.forEach((column, index) => {
    const displayIndex = index + 2;
    const letter = columnIndexToLetter(displayIndex);
    addSuggestion(letter, `${column.label} (${letter})`);
    addSuggestion(column.key, `${column.label} (${column.key})`);
    addSuggestion(toEmployeeInfoColumnKey(column.label), `${column.label} (label key)`);
  });

  return suggestions;
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
    const namedReferenceToDisplayIndex: Record<string, number> = {};

    const registerReference = (token: string, displayIndex: number) => {
      const cleaned = String(token || "").trim().toLowerCase();
      if (!cleaned) return;
      if (namedReferenceToDisplayIndex[cleaned] !== undefined) return;
      namedReferenceToDisplayIndex[cleaned] = displayIndex;
    };

    registerReference("A", 0);
    registerReference("full_name", 0);
    registerReference("fullname", 0);
    registerReference("B", 1);
    registerReference("client", 1);

    columns.forEach((column, index) => {
      const displayIndex = index + 2;
      registerReference(column.key, displayIndex);
      registerReference(toEmployeeInfoColumnKey(column.label), displayIndex);
      registerReference(columnIndexToLetter(displayIndex), displayIndex);
    });

    const resolveDisplayIndexValue = (displayIndex: number, visiting: Set<number>): unknown => {
      if (displayIndex === 0) return record.full_name;
      if (displayIndex === 1) return record.client_id ? clientNameById[record.client_id] || "" : "";

      const dynamicIndex = displayIndex - 2;
      if (dynamicIndex < 0 || dynamicIndex >= columnByDisplayIndex.length) return "";
      const column = columnByDisplayIndex[dynamicIndex];

      if (column.column_kind === "formula") {
        if (visiting.has(displayIndex)) return 0;
        visiting.add(displayIndex);
        const nested = evaluateEmployeeFormula(
          column.formula,
          (refIndex) => resolveDisplayIndexValue(refIndex, new Set(visiting)),
          (reference) => resolveNamedReferenceValue(reference, new Set(visiting))
        );
        visiting.delete(displayIndex);
        return nested ?? 0;
      }

      const value = valuesByColumnId[column.id];
      if (!value) return "";
      return column.column_kind === "dropdown" ? value.option_value || "" : value.text_value || "";
    };

    const resolveNamedReferenceValue = (reference: string, visiting: Set<number>) => {
      const displayIndex = namedReferenceToDisplayIndex[String(reference || "").trim().toLowerCase()];
      if (displayIndex === undefined) return undefined;
      return resolveDisplayIndexValue(displayIndex, visiting);
    };

    columns.forEach((column, index) => {
      if (column.column_kind !== "formula") return;
      const displayIndex = index + 2;
      const evaluated = evaluateEmployeeFormula(
        column.formula,
        (refIndex) => resolveDisplayIndexValue(refIndex, new Set([displayIndex])),
        (reference) => resolveNamedReferenceValue(reference, new Set([displayIndex]))
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
  const formulaSuggestions = buildFormulaSuggestions(columns);

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

    const normalizedValue =
      columnKind === "number"
        ? normalizeNumberCellValue(value)
        : columnKind === "currency"
        ? normalizeCurrencyCellValue(value)
        : columnKind === "date"
        ? normalizeDateCellValue(value)
        : value;
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
    const currencyCode = normalizeEmployeeInfoCurrencyCode(
      String(formData.get("currency_code") || "")
    );

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
      options_json:
        kind === "dropdown"
          ? toOptionsJson(optionsRaw)
          : kind === "currency"
          ? { currency_code: currencyCode }
          : [],
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

  async function updateColumn(formData: FormData) {
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
      redirect(buildEmployeeInfoUrl({ error: "Only admins can edit columns" }));
    }

    const columnId = String(formData.get("column_id") || "").trim();
    const label = String(formData.get("label") || "").trim();
    const kind = normalizeEmployeeInfoColumnKind(String(formData.get("column_kind") || ""));
    const optionsRaw = String(formData.get("dropdown_options") || "").trim();
    const formula = String(formData.get("formula") || "").trim();
    const currencyCode = normalizeEmployeeInfoCurrencyCode(
      String(formData.get("currency_code") || "")
    );

    if (!columnId) {
      redirect(buildEmployeeInfoUrl({ error: "Column id is required" }));
    }
    if (!label) {
      redirect(buildEmployeeInfoUrl({ error: "Column label is required" }));
    }
    if (kind === "dropdown" && !optionsRaw) {
      redirect(buildEmployeeInfoUrl({ error: "Dropdown options are required" }));
    }
    if (kind === "formula" && !formula) {
      redirect(buildEmployeeInfoUrl({ error: "Formula is required" }));
    }

    const { data: existingColumn, error: existingColumnError } = await supabase
      .from("employee_info_columns")
      .select("id,column_kind")
      .eq("id", columnId)
      .maybeSingle();
    if (existingColumnError) {
      redirect(buildEmployeeInfoUrl({ error: existingColumnError.message }));
    }
    if (!existingColumn) {
      redirect(buildEmployeeInfoUrl({ error: "Column not found" }));
    }

    const { error: updateColumnError } = await supabase
      .from("employee_info_columns")
      .update({
        label,
        column_kind: kind,
        formula: kind === "formula" ? formula : null,
        options_json:
          kind === "dropdown"
            ? toOptionsJson(optionsRaw)
            : kind === "currency"
            ? { currency_code: currencyCode }
            : [],
        updated_at: new Date().toISOString(),
      })
      .eq("id", columnId);
    if (updateColumnError) {
      redirect(buildEmployeeInfoUrl({ error: updateColumnError.message }));
    }

    if (existingColumn.column_kind !== kind) {
      const { data: existingValueRows, error: existingValuesError } = await supabase
        .from("employee_info_values")
        .select("record_id,text_value,option_value")
        .eq("column_id", columnId);
      if (existingValuesError) {
        redirect(buildEmployeeInfoUrl({ error: existingValuesError.message }));
      }

      const valueRows = existingValueRows || [];
      if (kind === "formula") {
        const { error: deleteValuesError } = await supabase
          .from("employee_info_values")
          .delete()
          .eq("column_id", columnId);
        if (deleteValuesError) {
          redirect(buildEmployeeInfoUrl({ error: deleteValuesError.message }));
        }
      } else {
        const now = new Date().toISOString();
        const payload =
          kind === "dropdown"
            ? valueRows
                .map((row) => {
                  const normalizedValue = String(row.option_value || row.text_value || "").trim();
                  if (!normalizedValue) return null;
                  return {
                    record_id: row.record_id,
                    column_id: columnId,
                    option_value: normalizedValue,
                    text_value: null,
                    updated_at: now,
                  };
                })
                .filter((row): row is {
                  record_id: string;
                  column_id: string;
                  option_value: string;
                  text_value: null;
                  updated_at: string;
                } => Boolean(row))
            : kind === "number"
            ? valueRows
                .map((row) => {
                  const normalizedValue = normalizeNumberCellValue(
                    String(row.text_value || row.option_value || "")
                  );
                  if (!normalizedValue) return null;
                  return {
                    record_id: row.record_id,
                    column_id: columnId,
                    text_value: normalizedValue,
                    option_value: null,
                    updated_at: now,
                  };
                })
                .filter((row): row is {
                  record_id: string;
                  column_id: string;
                  text_value: string;
                  option_value: null;
                  updated_at: string;
                } => Boolean(row))
            : kind === "currency"
            ? valueRows
                .map((row) => {
                  const normalizedValue = normalizeCurrencyCellValue(
                    String(row.text_value || row.option_value || "")
                  );
                  if (!normalizedValue) return null;
                  return {
                    record_id: row.record_id,
                    column_id: columnId,
                    text_value: normalizedValue,
                    option_value: null,
                    updated_at: now,
                  };
                })
                .filter((row): row is {
                  record_id: string;
                  column_id: string;
                  text_value: string;
                  option_value: null;
                  updated_at: string;
                } => Boolean(row))
            : kind === "date"
            ? valueRows
                .map((row) => {
                  const normalizedValue = normalizeDateCellValue(
                    String(row.text_value || row.option_value || "")
                  );
                  if (!normalizedValue) return null;
                  return {
                    record_id: row.record_id,
                    column_id: columnId,
                    text_value: normalizedValue,
                    option_value: null,
                    updated_at: now,
                  };
                })
                .filter((row): row is {
                  record_id: string;
                  column_id: string;
                  text_value: string;
                  option_value: null;
                  updated_at: string;
                } => Boolean(row))
            : valueRows
                .map((row) => {
                  const normalizedValue = String(row.text_value || row.option_value || "").trim();
                  if (!normalizedValue) return null;
                  return {
                    record_id: row.record_id,
                    column_id: columnId,
                    text_value: normalizedValue,
                    option_value: null,
                    updated_at: now,
                  };
                })
                .filter((row): row is {
                  record_id: string;
                  column_id: string;
                  text_value: string;
                  option_value: null;
                  updated_at: string;
                } => Boolean(row));

        const recordIdsWithValues = new Set(payload.map((row) => row.record_id));
        const recordIdsToDelete = valueRows
          .map((row) => row.record_id)
          .filter((recordId) => !recordIdsWithValues.has(recordId));

        if (recordIdsToDelete.length) {
          const { error: deleteValuesError } = await supabase
            .from("employee_info_values")
            .delete()
            .eq("column_id", columnId)
            .in("record_id", recordIdsToDelete);
          if (deleteValuesError) {
            redirect(buildEmployeeInfoUrl({ error: deleteValuesError.message }));
          }
        }

        if (payload.length) {
          const { error: upsertValuesError } = await supabase
            .from("employee_info_values")
            .upsert(payload, { onConflict: "record_id,column_id" });
          if (upsertValuesError) {
            redirect(buildEmployeeInfoUrl({ error: upsertValuesError.message }));
          }
        }
      }
    }

    revalidatePath("/employee-info");
    redirect(buildEmployeeInfoUrl({ success: "Column updated" }));
  }

  async function deleteColumn(formData: FormData) {
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
      redirect(buildEmployeeInfoUrl({ error: "Only admins can delete columns" }));
    }

    const columnId = String(formData.get("column_id") || "").trim();
    if (!columnId) {
      redirect(buildEmployeeInfoUrl({ error: "Column id is required" }));
    }

    const { error } = await supabase.from("employee_info_columns").delete().eq("id", columnId);
    if (error) {
      redirect(buildEmployeeInfoUrl({ error: error.message }));
    }

    revalidatePath("/employee-info");
    redirect(buildEmployeeInfoUrl({ success: "Column deleted" }));
  }

  async function moveColumn(formData: FormData) {
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
      redirect(buildEmployeeInfoUrl({ error: "Only admins can reorder columns" }));
    }

    const columnId = String(formData.get("column_id") || "").trim();
    const direction = String(formData.get("direction") || "")
      .trim()
      .toLowerCase();
    if (!columnId) {
      redirect(buildEmployeeInfoUrl({ error: "Column id is required" }));
    }
    if (direction !== "left" && direction !== "right") {
      redirect(buildEmployeeInfoUrl({ error: "Invalid direction" }));
    }

    const { data: orderedColumnsRaw, error: orderedColumnsError } = await supabase
      .from("employee_info_columns")
      .select("id")
      .order("position", { ascending: true })
      .order("created_at", { ascending: true });
    if (orderedColumnsError) {
      redirect(buildEmployeeInfoUrl({ error: orderedColumnsError.message }));
    }

    const orderedColumns = orderedColumnsRaw || [];
    if (orderedColumns.length < 2) {
      redirect("/employee-info");
    }

    const currentIndex = orderedColumns.findIndex((column) => column.id === columnId);
    if (currentIndex < 0) {
      redirect(buildEmployeeInfoUrl({ error: "Column not found" }));
    }

    const targetIndex = direction === "left" ? currentIndex - 1 : currentIndex + 1;
    if (targetIndex < 0 || targetIndex >= orderedColumns.length) {
      redirect("/employee-info");
    }

    const reorderedColumns = [...orderedColumns];
    const temp = reorderedColumns[currentIndex];
    reorderedColumns[currentIndex] = reorderedColumns[targetIndex];
    reorderedColumns[targetIndex] = temp;

    const now = new Date().toISOString();
    const updateResults = await Promise.all(
      reorderedColumns.map((column, index) =>
        supabase
          .from("employee_info_columns")
          .update({
            position: index + 1,
            updated_at: now,
          })
          .eq("id", column.id)
      )
    );
    const failedUpdate = updateResults.find((result) => result.error);
    if (failedUpdate?.error) {
      redirect(buildEmployeeInfoUrl({ error: failedUpdate.error.message }));
    }

    revalidatePath("/employee-info");
    redirect("/employee-info");
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

      {isAdmin ? (
        <section className="rounded-lg border border-slate-200 bg-white p-4 md:p-6">
          <details className="group">
            <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
              <span
                aria-hidden="true"
                className="inline-block text-[10px] transition-transform group-open:rotate-90"
              >
                &gt;
              </span>
              <span>Assign Users</span>
            </summary>
            <p className="mt-2 text-xs text-slate-500">
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
          </details>
        </section>
      ) : null}

      <section className="rounded-lg border border-slate-200 bg-white">
        {isAdmin ? (
          <div className="flex items-center justify-end gap-2 border-b border-slate-200 px-4 py-3">
            <a
              href="/employee-info/export"
              className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-700 hover:bg-slate-100"
              aria-label="Export employee info to Excel"
              title="Export to Excel"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="h-4 w-4"
                aria-hidden="true"
              >
                <path d="M12 3v12" />
                <path d="m7 10 5 5 5-5" />
                <path d="M5 21h14" />
              </svg>
            </a>
            <AddColumnPopover
              formulaSuggestions={formulaSuggestions}
              onCreateColumn={createColumn}
            />
          </div>
        ) : null}
        <EmployeeInfoTable
          records={records}
          clients={clients}
          columns={columns}
          valuesByRecordId={valuesByRecordId}
          formulaValueByRecordIdAndColumnId={formulaValueByRecordIdAndColumnId}
          isAdmin={isAdmin}
          formulaSuggestions={formulaSuggestions}
          onCreateRecord={createRecord}
          onUpdateCell={updateCell}
          onUpdateColumn={updateColumn}
          onDeleteColumn={deleteColumn}
          onMoveColumn={moveColumn}
        />
      </section>
    </div>
  );
}

