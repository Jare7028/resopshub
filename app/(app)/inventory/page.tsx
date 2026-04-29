import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentRequestUser } from "@/lib/supabase/currentUser";
import { withPerfTiming } from "@/lib/perf";
import {
  isSupabaseMissingColumnError,
  isSupabaseMissingFunctionError,
  isSupabaseMissingTableError,
} from "@/lib/supabaseErrors";
import InventoryTable from "./InventoryTable";
import AddColumnPopover from "./AddColumnPopover";
import AddRowButton from "./AddRowButton";
import CustomizeFieldsPopover from "./CustomizeFieldsPopover";
import CurrencyDisplaySelect from "./CurrencyDisplaySelect";
import type { FormulaSuggestion } from "./FormulaAutocompleteInput";
import {
  buildEmployeeInfoExchangeRateMap,
  columnIndexToLetter,
  convertEmployeeInfoCurrencyAmount,
  evaluateEmployeeFormula,
  formatEmployeeInfoCurrencyAmount,
  formatFormulaResult,
  normalizeEmployeeInfoCurrencyCode,
  normalizeEmployeeInfoDisplayCurrencyCode,
  normalizeEmployeeInfoFormulaCurrencyMode,
  normalizeEmployeeInfoColumnKind,
  parseEmployeeInfoCurrencyCodeFromOptions,
  parseEmployeeInfoCurrencyInput,
  parseEmployeeInfoDateToSerial,
  toEmployeeInfoColumnKey,
  type EmployeeInfoCurrencyCode,
  type EmployeeInfoDisplayCurrencyCode,
  type EmployeeInfoExchangeRateRow,
} from "@/lib/employeeInfo";

type EmployeeInfoRecordRow = {
  id: string;
  full_name: string;
  client_id: string | null;
  created_at: string;
};

const MAX_INVENTORY_RECORD_ROWS = 500;

type EmployeeInfoColumnRow = {
  id: string;
  key: string;
  label: string;
  column_kind: "text" | "dropdown" | "formula" | "number" | "date" | "currency";
  formula: string | null;
  formula_currency_mode: "display" | "fixed";
  formula_currency_code: "USD" | "GBP" | "MUR";
  options_json: unknown;
  position: number;
};

type EmployeeInfoValueRow = {
  record_id: string;
  column_id: string;
  text_value: string | null;
  option_value: string | null;
  money_currency_code: string | null;
};

type EmployeeInfoValuesByRecordId = Record<
  string,
  Record<string, { text_value: string | null; option_value: string | null; money_currency_code: string | null }>
>;

type EmployeeInfoActionResult = {
  ok: boolean;
  error?: string;
};
type InventoryDropdownSource = "custom" | "employee_names" | "clients";

function buildEmployeeInfoUrl(params?: {
  error?: string;
  success?: string;
  displayCurrency?: EmployeeInfoDisplayCurrencyCode;
}) {
  const sp = new URLSearchParams();
  if (params?.error) sp.set("error", params.error);
  if (params?.success) sp.set("success", params.success);
  if (params?.displayCurrency && params.displayCurrency !== "ORIGINAL") {
    sp.set("display_currency", params.displayCurrency);
  }
  const qs = sp.toString();
  return qs ? `/inventory?${qs}` : "/inventory";
}

function toOptionsJson(raw: string) {
  const options = raw
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  return Array.from(new Set(options));
}

function normalizeInventoryDropdownSource(value: FormDataEntryValue | null | undefined): InventoryDropdownSource {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  if (normalized === "employee_names") return "employee_names";
  if (normalized === "clients") return "clients";
  return "custom";
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

  addSuggestion("A", "Inventory Item");
  addSuggestion("B", "Client");
  addSuggestion("full_name", "Inventory Item");
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

function buildValueMap(rows: EmployeeInfoValueRow[]): EmployeeInfoValuesByRecordId {
  return rows.reduce<EmployeeInfoValuesByRecordId>((acc, row) => {
    if (!acc[row.record_id]) acc[row.record_id] = {};
    acc[row.record_id][row.column_id] = {
      text_value: row.text_value,
      option_value: row.option_value,
      money_currency_code: row.money_currency_code,
    };
    return acc;
  }, {});
}

function buildFormulaValueMap(args: {
  records: EmployeeInfoRecordRow[];
  columns: EmployeeInfoColumnRow[];
  valueMap: Record<
    string,
    Record<string, { text_value: string | null; option_value: string | null; money_currency_code: string | null }>
  >;
  clientNameById: Record<string, string>;
  exchangeRateRows: EmployeeInfoExchangeRateRow[];
  displayCurrency: EmployeeInfoDisplayCurrencyCode;
}) {
  const { records, columns, valueMap, clientNameById, exchangeRateRows, displayCurrency } = args;
  const monthStart = new Date().toISOString().slice(0, 7) + "-01";
  const exchangeRateMap = buildEmployeeInfoExchangeRateMap(exchangeRateRows, monthStart);

  const result: Record<string, Record<string, string>> = {};

  const resolveFormulaTargetCurrencyCode = (column: EmployeeInfoColumnRow) => {
    const formulaMode = normalizeEmployeeInfoFormulaCurrencyMode(column.formula_currency_mode);
    if (formulaMode === "fixed") {
      return normalizeEmployeeInfoCurrencyCode(column.formula_currency_code);
    }
    if (displayCurrency !== "ORIGINAL") {
      return normalizeEmployeeInfoCurrencyCode(displayCurrency);
    }
    return normalizeEmployeeInfoCurrencyCode(column.formula_currency_code);
  };

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

    const resolveDisplayIndexValue = (
      displayIndex: number,
      visiting: Set<number>,
      targetCurrencyCode: EmployeeInfoCurrencyCode,
      onMissingExchangeRate: () => void,
      onCurrencyOperand: () => void
    ): unknown => {
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
          (refIndex) =>
            resolveDisplayIndexValue(
              refIndex,
              new Set(visiting),
              targetCurrencyCode,
              onMissingExchangeRate,
              onCurrencyOperand
            ),
          (reference) =>
            resolveNamedReferenceValue(
              reference,
              new Set(visiting),
              targetCurrencyCode,
              onMissingExchangeRate,
              onCurrencyOperand
            )
        );
        visiting.delete(displayIndex);
        return nested ?? 0;
      }

      const value = valuesByColumnId[column.id];
      if (!value) {
        return column.column_kind === "date" ? 0 : "";
      }
      if (column.column_kind === "dropdown") return value.option_value || "";

      if (column.column_kind === "currency") {
        onCurrencyOperand();
        const sourceAmount = Number(value.text_value);
        if (!Number.isFinite(sourceAmount)) return 0;
        const sourceCurrencyCode = normalizeEmployeeInfoCurrencyCode(
          value.money_currency_code || parseEmployeeInfoCurrencyCodeFromOptions(column.options_json)
        );
        const convertedAmount = convertEmployeeInfoCurrencyAmount({
          amount: sourceAmount,
          fromCurrencyCode: sourceCurrencyCode,
          toCurrencyCode: targetCurrencyCode,
          exchangeRateMap,
        });
        if (convertedAmount === null) {
          onMissingExchangeRate();
          return 0;
        }
        return convertedAmount;
      }

      if (column.column_kind === "date") {
        return parseEmployeeInfoDateToSerial(value.text_value) ?? 0;
      }

      return value.text_value || "";
    };

    const resolveNamedReferenceValue = (
      reference: string,
      visiting: Set<number>,
      targetCurrencyCode: EmployeeInfoCurrencyCode,
      onMissingExchangeRate: () => void,
      onCurrencyOperand: () => void
    ) => {
      const displayIndex = namedReferenceToDisplayIndex[String(reference || "").trim().toLowerCase()];
      if (displayIndex === undefined) return undefined;
      return resolveDisplayIndexValue(
        displayIndex,
        visiting,
        targetCurrencyCode,
        onMissingExchangeRate,
        onCurrencyOperand
      );
    };

    columns.forEach((column, index) => {
      if (column.column_kind !== "formula") return;
      const displayIndex = index + 2;
      const formulaTargetCurrencyCode = resolveFormulaTargetCurrencyCode(column);
      let hasMissingExchangeRate = false;
      let hasCurrencyOperand = false;
      const markMissingExchangeRate = () => {
        hasMissingExchangeRate = true;
      };
      const markCurrencyOperand = () => {
        hasCurrencyOperand = true;
      };

      const evaluated = evaluateEmployeeFormula(
        column.formula,
        (refIndex) =>
          resolveDisplayIndexValue(
            refIndex,
            new Set([displayIndex]),
            formulaTargetCurrencyCode,
            markMissingExchangeRate,
            markCurrencyOperand
          ),
        (reference) =>
          resolveNamedReferenceValue(
            reference,
            new Set([displayIndex]),
            formulaTargetCurrencyCode,
            markMissingExchangeRate,
            markCurrencyOperand
          )
      );

      if (hasMissingExchangeRate) {
        result[record.id][column.id] = "#FX!";
        return;
      }

      if (typeof evaluated === "number" && Number.isFinite(evaluated) && hasCurrencyOperand) {
        result[record.id][column.id] = formatEmployeeInfoCurrencyAmount(
          evaluated,
          formulaTargetCurrencyCode
        );
        return;
      }

      result[record.id][column.id] = formatFormulaResult(evaluated);
    });
  });

  return result;
}

function buildCurrencyDisplayValueMap(args: {
  records: EmployeeInfoRecordRow[];
  columns: EmployeeInfoColumnRow[];
  valueMap: Record<
    string,
    Record<string, { text_value: string | null; option_value: string | null; money_currency_code: string | null }>
  >;
  exchangeRateRows: EmployeeInfoExchangeRateRow[];
  displayCurrency: EmployeeInfoDisplayCurrencyCode;
}) {
  const { records, columns, valueMap, exchangeRateRows, displayCurrency } = args;
  if (displayCurrency === "ORIGINAL") return {};

  const monthStart = new Date().toISOString().slice(0, 7) + "-01";
  const exchangeRateMap = buildEmployeeInfoExchangeRateMap(exchangeRateRows, monthStart);
  const result: Record<string, Record<string, string>> = {};
  const targetCurrencyCode = normalizeEmployeeInfoCurrencyCode(displayCurrency);

  records.forEach((record) => {
    const valuesByColumnId = valueMap[record.id] || {};
    result[record.id] = {};

    columns.forEach((column) => {
      if (column.column_kind !== "currency") return;
      const value = valuesByColumnId[column.id];
      if (!value?.text_value) return;

      const sourceCurrencyCode = normalizeEmployeeInfoCurrencyCode(
        value.money_currency_code || parseEmployeeInfoCurrencyCodeFromOptions(column.options_json)
      );
      const convertedAmount = convertEmployeeInfoCurrencyAmount({
        amount: value.text_value,
        fromCurrencyCode: sourceCurrencyCode,
        toCurrencyCode: targetCurrencyCode,
        exchangeRateMap,
      });
      if (convertedAmount === null) {
        result[record.id][column.id] = "#FX!";
        return;
      }
      result[record.id][column.id] = formatEmployeeInfoCurrencyAmount(
        convertedAmount,
        targetCurrencyCode
      );
    });
  });

  return result;
}

export default async function EmployeeInfoPage(props: {
  searchParams?: Promise<{
    error?: string;
    success?: string;
    display_currency?: string;
  }>;
}) {
  const searchParams = await props.searchParams;
  const displayCurrency = normalizeEmployeeInfoDisplayCurrencyCode(searchParams?.display_currency);
  const exportNonce = Date.now().toString();
  const supabase = createSupabaseServerClient();
  const authUser = await getCurrentRequestUser(supabase, "inventory.auth");
  const authUserId = authUser?.id;
  if (!authUserId) {
    redirect("/login");
  }
  const authEmail = authUser.email || "";

  const { data: profile } = await withPerfTiming("inventory.profile", () => {
    const query = supabase.from("users").select("id,role");
    return authEmail
      ? query.eq("email", authEmail).maybeSingle()
      : query.eq("id", authUserId).maybeSingle();
  });
  const currentAppUserId = profile?.id || authUserId;
  const isAdmin = profile?.role === "admin";
  let canAccessEmployeeInfo = isAdmin;
  let canManageColumns = isAdmin;

  const [canAccessResult, canManageColumnsResult] = await Promise.all([
    supabase.rpc("can_access_inventory"),
    supabase.rpc("can_manage_inventory_columns"),
  ]);

  if (!isSupabaseMissingFunctionError(canAccessResult.error) && !canAccessResult.error) {
    canAccessEmployeeInfo = Boolean(canAccessResult.data);
  }
  if (
    !isSupabaseMissingFunctionError(canManageColumnsResult.error) &&
    !canManageColumnsResult.error
  ) {
    canManageColumns = Boolean(canManageColumnsResult.data);
  }

  if (!canAccessEmployeeInfo) {
    redirect("/dashboard?error=You%20do%20not%20have%20access%20to%20Inventory");
  }

  const [
    { data: clientsRaw, error: clientsError },
    employeeNameOptionsResult,
    recordsResult,
    columnsResult,
  ] = await Promise.all([
    supabase.from("clients").select("id,name").order("name", { ascending: true }),
    supabase
      .from("employee_info_records")
      .select("full_name")
      .order("full_name", { ascending: true }),
    supabase
      .from("inventory_records")
      .select("id,full_name,client_id,created_at")
      .order("created_at", { ascending: false })
      .limit(MAX_INVENTORY_RECORD_ROWS),
    supabase
      .from("inventory_columns")
      .select(
        "id,key,label,column_kind,formula,formula_currency_mode,formula_currency_code,options_json,position"
      )
      .order("position", { ascending: true })
      .order("created_at", { ascending: true }),
  ]);
  if (clientsError) {
    redirect(buildEmployeeInfoUrl({ error: clientsError.message }));
  }
  const clients = (clientsRaw || []) as Array<{ id: string; name: string }>;
  const employeeNameOptions =
    employeeNameOptionsResult.error && isSupabaseMissingTableError(employeeNameOptionsResult.error)
      ? []
      : (employeeNameOptionsResult.data || [])
          .map((row) => String((row as { full_name: string | null }).full_name || "").trim())
          .filter(Boolean);

  const recordsRaw = recordsResult.data;
  const recordsError = recordsResult.error;
  let columnsRaw = columnsResult.data;
  let columnsError = columnsResult.error;

  if (isSupabaseMissingColumnError(columnsError)) {
    const fallbackColumns = await supabase
      .from("inventory_columns")
      .select("id,key,label,column_kind,formula,options_json,position")
      .order("position", { ascending: true })
      .order("created_at", { ascending: true });
    columnsError = fallbackColumns.error;
    columnsRaw = (fallbackColumns.data || []).map((column) => ({
      ...column,
      formula_currency_mode: "display",
      formula_currency_code: "USD",
    }));
  }

  if (isSupabaseMissingTableError(recordsError) || isSupabaseMissingTableError(columnsError)) {
    return (
      <div className="space-y-6">
        <section className="space-y-2">
          <h1 className="text-2xl font-semibold text-slate-900">Inventory</h1>
          <p className="text-sm text-slate-600">
            Track employee hardware and inventory with customizable fields.
          </p>
        </section>
        <p className="rounded-md border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900">
          Inventory is not set up yet. Run <code>sql/inventory.sql</code> in Supabase SQL
          editor, then refresh this page.
        </p>
      </div>
    );
  }

  const records = (recordsRaw || []) as EmployeeInfoRecordRow[];
  const columns = (columnsRaw || []) as EmployeeInfoColumnRow[];
  const formulaSuggestions = buildFormulaSuggestions(columns);
  const hasFormulaColumns = columns.some((column) => column.column_kind === "formula");
  const hasCurrencyColumns = columns.some((column) => column.column_kind === "currency");

  const recordIds = records.map((row) => row.id).filter(Boolean);
  let valuesRaw: EmployeeInfoValueRow[] = [];
  let valuesError: { message?: string; code?: string } | null = null;
  if (recordIds.length) {
    const valuesResult = await supabase
      .from("inventory_values")
      .select("record_id,column_id,text_value,option_value,money_currency_code")
      .in("record_id", recordIds);
    valuesRaw = (valuesResult.data || []) as EmployeeInfoValueRow[];
    valuesError = valuesResult.error;

    if (isSupabaseMissingColumnError(valuesError)) {
      const fallbackValuesResult = await supabase
        .from("inventory_values")
        .select("record_id,column_id,text_value,option_value")
        .in("record_id", recordIds);
      valuesError = fallbackValuesResult.error;
      valuesRaw = ((fallbackValuesResult.data || []) as Array<
        Omit<EmployeeInfoValueRow, "money_currency_code">
      >).map((row) => ({
        ...row,
        money_currency_code: null,
      }));
    }
  }

  const valueRows = (isSupabaseMissingTableError(valuesError) ? [] : valuesRaw || []) as EmployeeInfoValueRow[];
  const valuesByRecordId = buildValueMap(valueRows);
  const visibleRecords = records;
  const shouldLoadExchangeRates =
    visibleRecords.length > 0 &&
    (hasFormulaColumns || (displayCurrency !== "ORIGINAL" && hasCurrencyColumns));
  let exchangeRateRows: EmployeeInfoExchangeRateRow[] = [];
  if (shouldLoadExchangeRates) {
    const { data: exchangeRateRowsRaw, error: exchangeRateError } = await supabase
      .from("employee_info_exchange_rates")
      .select("base_currency_code,quote_currency_code,rate,effective_month_start")
      .order("effective_month_start", { ascending: false });
    exchangeRateRows = (
      isSupabaseMissingTableError(exchangeRateError) ? [] : exchangeRateRowsRaw || []
    ) as EmployeeInfoExchangeRateRow[];
  }

  const clientNameById = clients.reduce<Record<string, string>>((acc, client) => {
    acc[client.id] = client.name;
    return acc;
  }, {});
  const formulaValueByRecordIdAndColumnId =
    hasFormulaColumns && visibleRecords.length
      ? buildFormulaValueMap({
          records: visibleRecords,
          columns,
          valueMap: valuesByRecordId,
          clientNameById,
          exchangeRateRows,
          displayCurrency,
        })
      : {};
  const currencyDisplayValueByRecordIdAndColumnId =
    displayCurrency !== "ORIGINAL" && hasCurrencyColumns && visibleRecords.length
      ? buildCurrencyDisplayValueMap({
          records: visibleRecords,
          columns,
          valueMap: valuesByRecordId,
          exchangeRateRows,
          displayCurrency,
        })
      : {};

  async function createRecord(formData: FormData): Promise<EmployeeInfoActionResult> {
    "use server";
    const supabase = createSupabaseServerClient();
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user?.id) {
      redirect("/login");
    }

    const fullName = String(formData.get("full_name") || "").trim();
    if (!fullName) {
      return { ok: false, error: "Inventory item is required" };
    }

    const { data: currentUser } = await supabase
      .from("users")
      .select("id,role")
      .eq("email", auth.user.email || "")
      .maybeSingle();
    const actorUserId = currentUser?.id || auth.user.id;
    const { error } = await supabase.from("inventory_records").insert({
      full_name: fullName,
      client_id: null,
      created_by_user_id: actorUserId,
    });
    if (error) {
      return { ok: false, error: error.message };
    }

    revalidatePath("/inventory");
    return { ok: true };
  }

  async function deleteRecord(formData: FormData): Promise<EmployeeInfoActionResult> {
    "use server";
    const supabase = createSupabaseServerClient();
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user?.id) {
      redirect("/login");
    }

    const recordId = String(formData.get("record_id") || "").trim();
    if (!recordId) {
      return { ok: false, error: "Record id is required" };
    }

    const { error } = await supabase.from("inventory_records").delete().eq("id", recordId);
    if (error) {
      return { ok: false, error: error.message };
    }

    revalidatePath("/inventory");
    return { ok: true };
  }

  async function updateCell(formData: FormData): Promise<EmployeeInfoActionResult> {
    "use server";
    const supabase = createSupabaseServerClient();
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user?.id) {
      redirect("/login");
    }
    const recordId = String(formData.get("record_id") || "").trim();
    const baseField = String(formData.get("base_field") || "").trim();
    const columnId = String(formData.get("column_id") || "").trim();
    const columnKind = normalizeEmployeeInfoColumnKind(String(formData.get("column_kind") || ""));
    const value = String(formData.get("value") || "").trim();
    const submittedCurrencyCode = normalizeEmployeeInfoCurrencyCode(
      String(formData.get("currency_code") || "")
    );

    if (!recordId) return { ok: false, error: "Missing record id" };

    const { data: recordRow, error: recordError } = await supabase
      .from("inventory_records")
      .select("id,client_id")
      .eq("id", recordId)
      .maybeSingle();
    if (recordError) return { ok: false, error: recordError.message };
    if (!recordRow) return { ok: false, error: "Employee record not found" };

    if (baseField === "full_name") {
      if (!value) return { ok: false, error: "Inventory item is required" };
      const { error } = await supabase
        .from("inventory_records")
        .update({ full_name: value, updated_at: new Date().toISOString() })
        .eq("id", recordId);
      if (error) return { ok: false, error: error.message };
      revalidatePath("/inventory");
      return { ok: true };
    }

    if (baseField === "client_id") {
      const { error } = await supabase
        .from("inventory_records")
        .update({ client_id: value || null, updated_at: new Date().toISOString() })
        .eq("id", recordId);
      if (error) return { ok: false, error: error.message };
      revalidatePath("/inventory");
      return { ok: true };
    }

    if (!columnId) return { ok: false, error: "Missing column id" };
    if (columnKind === "formula") return { ok: true };

    const parsedCurrencyInput =
      columnKind === "currency"
        ? parseEmployeeInfoCurrencyInput(value, submittedCurrencyCode)
        : null;
    const normalizedValue =
      columnKind === "number"
        ? normalizeNumberCellValue(value)
        : columnKind === "currency"
        ? parsedCurrencyInput?.amountText || null
        : columnKind === "date"
        ? normalizeDateCellValue(value)
        : value;
    const normalizedMoneyCurrencyCode =
      columnKind === "currency"
        ? normalizeEmployeeInfoCurrencyCode(parsedCurrencyInput?.currencyCode || submittedCurrencyCode)
        : null;

    if (!normalizedValue) {
      const { error } = await supabase
        .from("inventory_values")
        .delete()
        .eq("record_id", recordId)
        .eq("column_id", columnId);
      if (error) return { ok: false, error: error.message };
      revalidatePath("/inventory");
      return { ok: true };
    }

    const payload =
      columnKind === "dropdown"
        ? {
            record_id: recordId,
            column_id: columnId,
            option_value: normalizedValue,
            text_value: null,
            money_currency_code: null,
            updated_at: new Date().toISOString(),
          }
        : {
            record_id: recordId,
            column_id: columnId,
            text_value: normalizedValue,
            option_value: null,
            money_currency_code: normalizedMoneyCurrencyCode,
            updated_at: new Date().toISOString(),
          };

    const { error } = await supabase
      .from("inventory_values")
      .upsert(payload, { onConflict: "record_id,column_id" });
    if (error) return { ok: false, error: error.message };

    revalidatePath("/inventory");
    return { ok: true };
  }

  async function createColumn(formData: FormData): Promise<EmployeeInfoActionResult> {
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
    let canManageColumns = currentUser?.role === "admin";
    const canManageColumnsResult = await supabase.rpc("can_manage_inventory_columns");
    if (!isSupabaseMissingFunctionError(canManageColumnsResult.error)) {
      if (canManageColumnsResult.error) {
        return { ok: false, error: canManageColumnsResult.error.message };
      }
      canManageColumns = Boolean(canManageColumnsResult.data);
    }
    if (!canManageColumns) {
      return { ok: false, error: "Only admins can add columns" };
    }

    const label = String(formData.get("label") || "").trim();
    const kind = normalizeEmployeeInfoColumnKind(String(formData.get("column_kind") || ""));
    const optionsRaw = String(formData.get("dropdown_options") || "").trim();
    const dropdownSource = normalizeInventoryDropdownSource(formData.get("dropdown_source"));
    const formula = String(formData.get("formula") || "").trim();
    const currencyCode = normalizeEmployeeInfoCurrencyCode(
      String(formData.get("currency_code") || "")
    );
    const formulaCurrencyMode = normalizeEmployeeInfoFormulaCurrencyMode(
      String(formData.get("formula_currency_mode") || "")
    );
    const formulaCurrencyCode = normalizeEmployeeInfoCurrencyCode(
      String(formData.get("formula_currency_code") || "")
    );

    if (!label) {
      return { ok: false, error: "Column label is required" };
    }
    if (kind === "dropdown" && dropdownSource === "custom" && !optionsRaw) {
      return { ok: false, error: "Dropdown options are required" };
    }
    if (kind === "formula" && !formula) {
      return { ok: false, error: "Formula is required" };
    }

    const dropdownOptionsJson =
      dropdownSource === "employee_names"
        ? { source: "employee_names" }
        : dropdownSource === "clients"
        ? { source: "clients" }
        : toOptionsJson(optionsRaw);

    const { data: lastColumnRaw } = await supabase
      .from("inventory_columns")
      .select("position")
      .order("position", { ascending: false })
      .limit(1);
    const nextPosition = Number((lastColumnRaw || [])[0]?.position || 0) + 1;

    const baseKey = toEmployeeInfoColumnKey(label);
    let candidateKey = baseKey;
    for (let i = 2; i < 100; i += 1) {
      const { data: existing } = await supabase
        .from("inventory_columns")
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
      formula_currency_mode: kind === "formula" ? formulaCurrencyMode : "display",
      formula_currency_code: kind === "formula" ? formulaCurrencyCode : "USD",
      options_json:
        kind === "dropdown"
          ? dropdownOptionsJson
          : kind === "currency"
          ? { currency_code: currencyCode }
          : [],
      position: nextPosition,
      created_by_user_id: currentUser?.id || auth.user.id,
    };

    const { error } = await supabase.from("inventory_columns").insert(payload);
    if (error) {
      return { ok: false, error: error.message };
    }

    revalidatePath("/inventory");
    return { ok: true };
  }

  async function updateColumn(formData: FormData): Promise<EmployeeInfoActionResult> {
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
    let canManageColumns = currentUser?.role === "admin";
    const canManageColumnsResult = await supabase.rpc("can_manage_inventory_columns");
    if (!isSupabaseMissingFunctionError(canManageColumnsResult.error)) {
      if (canManageColumnsResult.error) {
        return { ok: false, error: canManageColumnsResult.error.message };
      }
      canManageColumns = Boolean(canManageColumnsResult.data);
    }
    if (!canManageColumns) {
      return { ok: false, error: "Only admins can edit columns" };
    }

    const columnId = String(formData.get("column_id") || "").trim();
    const label = String(formData.get("label") || "").trim();
    const kind = normalizeEmployeeInfoColumnKind(String(formData.get("column_kind") || ""));
    const optionsRaw = String(formData.get("dropdown_options") || "").trim();
    const dropdownSource = normalizeInventoryDropdownSource(formData.get("dropdown_source"));
    const formula = String(formData.get("formula") || "").trim();
    const currencyCode = normalizeEmployeeInfoCurrencyCode(
      String(formData.get("currency_code") || "")
    );
    const formulaCurrencyMode = normalizeEmployeeInfoFormulaCurrencyMode(
      String(formData.get("formula_currency_mode") || "")
    );
    const formulaCurrencyCode = normalizeEmployeeInfoCurrencyCode(
      String(formData.get("formula_currency_code") || "")
    );

    if (!columnId) {
      return { ok: false, error: "Column id is required" };
    }
    if (!label) {
      return { ok: false, error: "Column label is required" };
    }
    if (kind === "dropdown" && dropdownSource === "custom" && !optionsRaw) {
      return { ok: false, error: "Dropdown options are required" };
    }
    if (kind === "formula" && !formula) {
      return { ok: false, error: "Formula is required" };
    }

    const dropdownOptionsJson =
      dropdownSource === "employee_names"
        ? { source: "employee_names" }
        : dropdownSource === "clients"
        ? { source: "clients" }
        : toOptionsJson(optionsRaw);

    const { data: existingColumn, error: existingColumnError } = await supabase
      .from("inventory_columns")
      .select("id,column_kind")
      .eq("id", columnId)
      .maybeSingle();
    if (existingColumnError) {
      return { ok: false, error: existingColumnError.message };
    }
    if (!existingColumn) {
      return { ok: false, error: "Column not found" };
    }

    const { error: updateColumnError } = await supabase
      .from("inventory_columns")
      .update({
        label,
        column_kind: kind,
        formula: kind === "formula" ? formula : null,
        formula_currency_mode: kind === "formula" ? formulaCurrencyMode : "display",
        formula_currency_code: kind === "formula" ? formulaCurrencyCode : "USD",
        options_json:
          kind === "dropdown"
            ? dropdownOptionsJson
            : kind === "currency"
            ? { currency_code: currencyCode }
            : [],
        updated_at: new Date().toISOString(),
      })
      .eq("id", columnId);
    if (updateColumnError) {
      return { ok: false, error: updateColumnError.message };
    }

    if (existingColumn.column_kind !== kind) {
      const { data: existingValueRows, error: existingValuesError } = await supabase
        .from("inventory_values")
        .select("record_id,text_value,option_value,money_currency_code")
        .eq("column_id", columnId);
      if (existingValuesError) {
        return { ok: false, error: existingValuesError.message };
      }

      const valueRows = existingValueRows || [];
      if (kind === "formula") {
        const { error: deleteValuesError } = await supabase
          .from("inventory_values")
          .delete()
          .eq("column_id", columnId);
        if (deleteValuesError) {
          return { ok: false, error: deleteValuesError.message };
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
                    money_currency_code: null,
                    updated_at: now,
                  };
                })
                .filter((row): row is {
                  record_id: string;
                  column_id: string;
                  option_value: string;
                  text_value: null;
                  money_currency_code: null;
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
                    money_currency_code: null,
                    updated_at: now,
                  };
                })
                .filter((row): row is {
                  record_id: string;
                  column_id: string;
                  text_value: string;
                  option_value: null;
                  money_currency_code: null;
                  updated_at: string;
                } => Boolean(row))
            : kind === "currency"
            ? valueRows
                .map((row) => {
                  const parsedCurrencyInput = parseEmployeeInfoCurrencyInput(
                    String(row.text_value || row.option_value || ""),
                    normalizeEmployeeInfoCurrencyCode(row.money_currency_code || currencyCode)
                  );
                  if (!parsedCurrencyInput.amountText) return null;
                  return {
                    record_id: row.record_id,
                    column_id: columnId,
                    text_value: parsedCurrencyInput.amountText,
                    option_value: null,
                    money_currency_code: normalizeEmployeeInfoCurrencyCode(
                      parsedCurrencyInput.currencyCode || currencyCode
                    ),
                    updated_at: now,
                  };
                })
                .filter((row): row is {
                  record_id: string;
                  column_id: string;
                  text_value: string;
                  option_value: null;
                  money_currency_code: EmployeeInfoCurrencyCode;
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
                    money_currency_code: null,
                    updated_at: now,
                  };
                })
                .filter((row): row is {
                  record_id: string;
                  column_id: string;
                  text_value: string;
                  option_value: null;
                  money_currency_code: null;
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
                    money_currency_code: null,
                    updated_at: now,
                  };
                })
                .filter((row): row is {
                  record_id: string;
                  column_id: string;
                  text_value: string;
                  option_value: null;
                  money_currency_code: null;
                  updated_at: string;
                } => Boolean(row));

        const recordIdsWithValues = new Set(payload.map((row) => row.record_id));
        const recordIdsToDelete = valueRows
          .map((row) => row.record_id)
          .filter((recordId) => !recordIdsWithValues.has(recordId));

        if (recordIdsToDelete.length) {
          const { error: deleteValuesError } = await supabase
            .from("inventory_values")
            .delete()
            .eq("column_id", columnId)
            .in("record_id", recordIdsToDelete);
          if (deleteValuesError) {
            return { ok: false, error: deleteValuesError.message };
          }
        }

        if (payload.length) {
          const { error: upsertValuesError } = await supabase
            .from("inventory_values")
            .upsert(payload, { onConflict: "record_id,column_id" });
          if (upsertValuesError) {
            return { ok: false, error: upsertValuesError.message };
          }
        }
      }
    }

    revalidatePath("/inventory");
    return { ok: true };
  }

  async function deleteColumn(formData: FormData): Promise<EmployeeInfoActionResult> {
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
    let canManageColumns = currentUser?.role === "admin";
    const canManageColumnsResult = await supabase.rpc("can_manage_inventory_columns");
    if (!isSupabaseMissingFunctionError(canManageColumnsResult.error)) {
      if (canManageColumnsResult.error) {
        return { ok: false, error: canManageColumnsResult.error.message };
      }
      canManageColumns = Boolean(canManageColumnsResult.data);
    }
    if (!canManageColumns) {
      return { ok: false, error: "Only admins can delete columns" };
    }

    const columnId = String(formData.get("column_id") || "").trim();
    if (!columnId) {
      return { ok: false, error: "Column id is required" };
    }

    const { error } = await supabase.from("inventory_columns").delete().eq("id", columnId);
    if (error) {
      return { ok: false, error: error.message };
    }

    revalidatePath("/inventory");
    return { ok: true };
  }

  async function moveColumn(formData: FormData): Promise<EmployeeInfoActionResult> {
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
    let canManageColumns = currentUser?.role === "admin";
    const canManageColumnsResult = await supabase.rpc("can_manage_inventory_columns");
    if (!isSupabaseMissingFunctionError(canManageColumnsResult.error)) {
      if (canManageColumnsResult.error) {
        return { ok: false, error: canManageColumnsResult.error.message };
      }
      canManageColumns = Boolean(canManageColumnsResult.data);
    }
    if (!canManageColumns) {
      return { ok: false, error: "Only admins can reorder columns" };
    }

    const columnId = String(formData.get("column_id") || "").trim();
    const direction = String(formData.get("direction") || "")
      .trim()
      .toLowerCase();
    if (!columnId) {
      return { ok: false, error: "Column id is required" };
    }
    if (direction !== "left" && direction !== "right") {
      return { ok: false, error: "Invalid direction" };
    }

    const { data: orderedColumnsRaw, error: orderedColumnsError } = await supabase
      .from("inventory_columns")
      .select("id")
      .order("position", { ascending: true })
      .order("created_at", { ascending: true });
    if (orderedColumnsError) {
      return { ok: false, error: orderedColumnsError.message };
    }

    const orderedColumns = orderedColumnsRaw || [];
    if (orderedColumns.length < 2) {
      return { ok: true };
    }

    const currentIndex = orderedColumns.findIndex((column) => column.id === columnId);
    if (currentIndex < 0) {
      return { ok: false, error: "Column not found" };
    }

    const targetIndex = direction === "left" ? currentIndex - 1 : currentIndex + 1;
    if (targetIndex < 0 || targetIndex >= orderedColumns.length) {
      return { ok: true };
    }

    const reorderedColumns = [...orderedColumns];
    const temp = reorderedColumns[currentIndex];
    reorderedColumns[currentIndex] = reorderedColumns[targetIndex];
    reorderedColumns[targetIndex] = temp;

    const now = new Date().toISOString();
    const updateResults = await Promise.all(
      reorderedColumns.map((column, index) =>
        supabase
          .from("inventory_columns")
          .update({
            position: index + 1,
            updated_at: now,
          })
          .eq("id", column.id)
      )
    );
    const failedUpdate = updateResults.find((result) => result.error);
    if (failedUpdate?.error) {
      return { ok: false, error: failedUpdate.error.message };
    }

    revalidatePath("/inventory");
    return { ok: true };
  }

  const inventoryTableKey = `${records.length}:${columns.length}`;

  return (
    <div className="space-y-8">
      <section className="space-y-2">
        <h1 className="text-2xl font-semibold text-slate-900">Inventory</h1>
        <p className="text-sm text-slate-600">
          Track employee hardware and inventory with customizable fields.
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

      <section className="rounded-lg border border-slate-200 bg-white">
        <div className="flex items-center justify-between gap-2 border-b border-slate-200 px-4 py-3">
          <div className="flex items-center gap-2">
            <CustomizeFieldsPopover columns={columns} />
            <CurrencyDisplaySelect value={displayCurrency} />
            <AddRowButton />
            {canManageColumns ? (
              <AddColumnPopover
                formulaSuggestions={formulaSuggestions}
                onCreateColumn={createColumn}
              />
            ) : null}
          </div>
          <div className="flex items-center gap-2">
            <a
              href={
                displayCurrency === "ORIGINAL"
                  ? `/inventory/export?ts=${exportNonce}`
                  : `/inventory/export?display_currency=${displayCurrency}&ts=${exportNonce}`
              }
              className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-700 hover:bg-slate-100"
              aria-label="Export inventory to Excel"
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
          </div>
        </div>
        <InventoryTable
          key={inventoryTableKey}
          records={visibleRecords}
          clients={clients}
          employeeNameOptions={employeeNameOptions}
          columns={columns}
          valuesByRecordId={valuesByRecordId}
          formulaValueByRecordIdAndColumnId={formulaValueByRecordIdAndColumnId}
          currencyDisplayValueByRecordIdAndColumnId={currencyDisplayValueByRecordIdAndColumnId}
          displayCurrency={displayCurrency}
          currentUserId={currentAppUserId}
          isAdmin={canManageColumns}
          formulaSuggestions={formulaSuggestions}
          onCreateRecord={createRecord}
          onDeleteRecord={deleteRecord}
          onUpdateCell={updateCell}
          onUpdateColumn={updateColumn}
          onDeleteColumn={deleteColumn}
          onMoveColumn={moveColumn}
        />
      </section>
    </div>
  );
}


