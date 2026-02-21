import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { withPerfTiming } from "@/lib/perf";
import {
  isSupabaseMissingColumnError,
  isSupabaseMissingFunctionError,
  isSupabaseMissingTableError,
} from "@/lib/supabaseErrors";
import EmployeeInfoTable from "./EmployeeInfoTable";
import AddColumnPopover from "./AddColumnPopover";
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
import {
  isEmployeeInfoRecordVisible,
  normalizeEmployeeInfoRoleToken,
  parseEmployeeInfoRoleValuesInput,
  type EmployeeInfoVisibilityRule,
  toEmployeeInfoVisibilityRule,
  type EmployeeInfoVisibilityRuleRow,
} from "@/lib/employeeInfoVisibilityRules";

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

type UserRow = {
  id: string;
  full_name: string | null;
  email: string | null;
  role: string | null;
};

type EmployeeInfoActionResult = {
  ok: boolean;
  error?: string;
};

type EmployeeInfoRoleValueLookup = Record<string, string>;
type ClientUserMembershipRow = { user_id: string; client_id: string };

const DEFAULT_EMPLOYEE_INFO_ROLE_VALUE = "Customer Service Representative";
const DEFAULT_EMPLOYEE_INFO_ROLE_VALUES = [DEFAULT_EMPLOYEE_INFO_ROLE_VALUE];

function buildEmployeeInfoUrl(params?: {
  error?: string;
  success?: string;
  displayCurrency?: EmployeeInfoDisplayCurrencyCode;
  visibilityUserId?: string | null;
}) {
  const sp = new URLSearchParams();
  if (params?.error) sp.set("error", params.error);
  if (params?.success) sp.set("success", params.success);
  if (params?.displayCurrency && params.displayCurrency !== "ORIGINAL") {
    sp.set("display_currency", params.displayCurrency);
  }
  if (params?.visibilityUserId) {
    sp.set("visibility_user_id", params.visibilityUserId);
  }
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

function normalizeUuidList(values: string[]) {
  return Array.from(
    new Set(
      values
        .map((value) => String(value || "").trim())
        .filter((value) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value))
    )
  );
}

function buildRoleValueLookup(args: {
  records: EmployeeInfoRecordRow[];
  valuesByRecordId: EmployeeInfoValuesByRecordId;
  roleColumnId: string | null;
}) {
  const { records, valuesByRecordId, roleColumnId } = args;
  if (!roleColumnId) return {} as EmployeeInfoRoleValueLookup;

  return records.reduce<EmployeeInfoRoleValueLookup>((acc, record) => {
    const roleCell = valuesByRecordId[record.id]?.[roleColumnId];
    acc[record.id] = roleCell?.option_value || roleCell?.text_value || "";
    return acc;
  }, {});
}

function filterRecordsByVisibilityRule(args: {
  records: EmployeeInfoRecordRow[];
  valuesByRecordId: EmployeeInfoValuesByRecordId;
  rule: EmployeeInfoVisibilityRule;
}) {
  const { records, valuesByRecordId, rule } = args;
  if (!rule.enabled) return records;

  const roleValueByRecordId = buildRoleValueLookup({
    records,
    valuesByRecordId,
    roleColumnId: rule.roleColumnId,
  });

  return records.filter((record) =>
    isEmployeeInfoRecordVisible({
      rule,
      clientId: record.client_id,
      roleValue: roleValueByRecordId[record.id] || "",
    })
  );
}

function resolveDefaultRoleColumnId(columns: EmployeeInfoColumnRow[]) {
  const candidateKeys = new Set(["role", "employee_role", "job_role"]);
  for (const column of columns) {
    if (column.column_kind === "formula") continue;
    const normalizedKey = toEmployeeInfoColumnKey(column.key || "");
    const normalizedLabel = toEmployeeInfoColumnKey(column.label || "");
    if (candidateKeys.has(normalizedKey) || candidateKeys.has(normalizedLabel)) {
      return column.id;
    }
  }
  return null as string | null;
}

function resolveEffectiveVisibilityRule(args: {
  isAdmin: boolean;
  ruleRow: EmployeeInfoVisibilityRuleRow | null;
  assignedClientIds: string[];
  defaultRoleColumnId: string | null;
}) {
  const { isAdmin, ruleRow, assignedClientIds, defaultRoleColumnId } = args;
  const explicitRule = toEmployeeInfoVisibilityRule(ruleRow);
  if (explicitRule.enabled || isAdmin) {
    return explicitRule;
  }
  if (ruleRow) {
    return explicitRule;
  }
  return {
    enabled: true,
    allowedClientIds: Array.from(new Set(assignedClientIds)),
    roleColumnId: defaultRoleColumnId,
    allowedRoleTokens: DEFAULT_EMPLOYEE_INFO_ROLE_VALUES.map((value) =>
      normalizeEmployeeInfoRoleToken(value)
    ).filter(Boolean),
  } satisfies EmployeeInfoVisibilityRule;
}

function buildRoleValueSuggestions(args: {
  records: EmployeeInfoRecordRow[];
  valuesByRecordId: EmployeeInfoValuesByRecordId;
  roleColumnId: string | null;
}) {
  const { records, valuesByRecordId, roleColumnId } = args;
  if (!roleColumnId) return [] as string[];

  return Array.from(
    new Set(
      records
        .map((record) => {
          const value = valuesByRecordId[record.id]?.[roleColumnId];
          return String(value?.option_value || value?.text_value || "").trim();
        })
        .filter(Boolean)
    )
  );
}

async function readVisibilityRuleForUser(args: {
  supabase: ReturnType<typeof createSupabaseServerClient>;
  userId: string;
}) {
  const { supabase, userId } = args;
  const result = await supabase
    .from("employee_info_visibility_rules")
    .select("user_id,enabled,allowed_client_ids,role_column_id,allowed_role_values")
    .eq("user_id", userId)
    .maybeSingle();

  if (isSupabaseMissingTableError(result.error)) {
    return { tableMissing: true, ruleRow: null as EmployeeInfoVisibilityRuleRow | null, error: null };
  }
  if (result.error) {
    return {
      tableMissing: false,
      ruleRow: null as EmployeeInfoVisibilityRuleRow | null,
      error: result.error.message,
    };
  }

  return {
    tableMissing: false,
    ruleRow: (result.data || null) as EmployeeInfoVisibilityRuleRow | null,
    error: null,
  };
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
    visibility_user_id?: string;
  }>;
}) {
  const searchParams = await props.searchParams;
  const displayCurrency = normalizeEmployeeInfoDisplayCurrencyCode(searchParams?.display_currency);
  const exportNonce = Date.now().toString();
  const supabase = createSupabaseServerClient();
  const { data: authData } = await withPerfTiming("employee_info.auth", () =>
    supabase.auth.getUser()
  );
  const authUserId = authData.user?.id;
  const authEmail = authData.user?.email || "";
  if (!authUserId) {
    redirect("/login");
  }

  const { data: profile } = await withPerfTiming("employee_info.profile", () =>
    supabase.from("users").select("id,role").eq("email", authEmail).maybeSingle()
  );
  const currentAppUserId = profile?.id || authUserId;
  const isAdmin = profile?.role === "admin";
  let canAccessEmployeeInfo = isAdmin;
  let canManageColumns = isAdmin;

  const [canAccessResult, canManageColumnsResult] = await Promise.all([
    supabase.rpc("can_access_employee_info"),
    supabase.rpc("can_manage_employee_info_columns"),
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
  const canManageVisibilityRules = isAdmin;

  if (!canAccessEmployeeInfo) {
    redirect("/dashboard?error=You%20do%20not%20have%20access%20to%20Employee%20Info");
  }

  const usersPromise = canManageVisibilityRules
    ? supabase.from("users").select("id,full_name,email,role").order("full_name", { ascending: true })
    : Promise.resolve({ data: [] as UserRow[], error: null });
  const viewerClientMembershipPromise = supabase
    .from("client_users")
    .select("client_id")
    .eq("user_id", currentAppUserId);
  const userClientMembershipsPromise = canManageVisibilityRules
    ? supabase.from("client_users").select("user_id,client_id")
    : Promise.resolve({ data: [] as ClientUserMembershipRow[], error: null });
  const [
    { data: clientsRaw, error: clientsError },
    usersResult,
    viewerVisibilityRuleResult,
    viewerClientMembershipResult,
    userClientMembershipsResult,
  ] = await Promise.all([
      supabase.from("clients").select("id,name").order("name", { ascending: true }),
      usersPromise,
      readVisibilityRuleForUser({ supabase, userId: currentAppUserId }),
      viewerClientMembershipPromise,
      userClientMembershipsPromise,
    ]);
  if (clientsError) {
    redirect(buildEmployeeInfoUrl({ error: clientsError.message }));
  }
  if (usersResult.error) {
    redirect(buildEmployeeInfoUrl({ error: usersResult.error.message }));
  }
  if (viewerClientMembershipResult.error && !isSupabaseMissingTableError(viewerClientMembershipResult.error)) {
    redirect(buildEmployeeInfoUrl({ error: viewerClientMembershipResult.error.message }));
  }
  if (
    userClientMembershipsResult.error &&
    !isSupabaseMissingTableError(userClientMembershipsResult.error)
  ) {
    redirect(buildEmployeeInfoUrl({ error: userClientMembershipsResult.error.message }));
  }
  if (viewerVisibilityRuleResult.error) {
    redirect(buildEmployeeInfoUrl({ error: viewerVisibilityRuleResult.error }));
  }
  const clients = (clientsRaw || []) as Array<{ id: string; name: string }>;
  const users = (usersResult.data || []) as UserRow[];
  const viewerAssignedClientIds = Array.from(
    new Set(
      (viewerClientMembershipResult.data || [])
        .map((row) => String((row as { client_id: string | null }).client_id || "").trim())
        .filter(Boolean)
    )
  );
  const assignedClientIdsByUserId = ((userClientMembershipsResult.data || []) as ClientUserMembershipRow[]).reduce(
    (acc, row) => {
      const userId = String(row.user_id || "").trim();
      const clientId = String(row.client_id || "").trim();
      if (!userId || !clientId) return acc;
      if (!acc.has(userId)) acc.set(userId, new Set<string>());
      acc.get(userId)?.add(clientId);
      return acc;
    },
    new Map<string, Set<string>>()
  );
  const viewerVisibilityRuleRow = viewerVisibilityRuleResult.ruleRow;
  const viewerVisibilityTableMissing = viewerVisibilityRuleResult.tableMissing;
  const viewerCustomRule = toEmployeeInfoVisibilityRule(viewerVisibilityRuleRow);

  let recordsQuery = supabase
    .from("employee_info_records")
    .select("id,full_name,client_id,created_at")
    .order("created_at", { ascending: false });
  const shouldApplyDefaultClientScope = !isAdmin && !viewerVisibilityRuleRow;
  if (viewerCustomRule.enabled && viewerCustomRule.allowedClientIds.length) {
    recordsQuery = recordsQuery.in("client_id", viewerCustomRule.allowedClientIds);
  } else if (shouldApplyDefaultClientScope && viewerAssignedClientIds.length) {
    recordsQuery = recordsQuery.in("client_id", viewerAssignedClientIds);
  }
  const [recordsResult, columnsResult] = await Promise.all([
    recordsQuery,
    supabase
      .from("employee_info_columns")
      .select(
        "id,key,label,column_kind,formula,formula_currency_mode,formula_currency_code,options_json,position"
      )
      .order("position", { ascending: true })
      .order("created_at", { ascending: true }),
  ]);
  const recordsRaw = recordsResult.data;
  const recordsError = recordsResult.error;
  let columnsRaw = columnsResult.data;
  let columnsError = columnsResult.error;

  if (isSupabaseMissingColumnError(columnsError)) {
    const fallbackColumns = await supabase
      .from("employee_info_columns")
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

  const records =
    shouldApplyDefaultClientScope && viewerAssignedClientIds.length === 0
      ? ([] as EmployeeInfoRecordRow[])
      : ((recordsRaw || []) as EmployeeInfoRecordRow[]);
  const columns = (columnsRaw || []) as EmployeeInfoColumnRow[];
  const defaultRoleColumnId = resolveDefaultRoleColumnId(columns);
  const viewerVisibilityRule = resolveEffectiveVisibilityRule({
    isAdmin,
    ruleRow: viewerVisibilityRuleRow,
    assignedClientIds: viewerAssignedClientIds,
    defaultRoleColumnId,
  });
  const formulaSuggestions = buildFormulaSuggestions(columns);
  const hasFormulaColumns = columns.some((column) => column.column_kind === "formula");
  const hasCurrencyColumns = columns.some((column) => column.column_kind === "currency");

  const visibilityRulesPromise =
    canManageVisibilityRules && !viewerVisibilityTableMissing
      ? supabase
          .from("employee_info_visibility_rules")
          .select("user_id,enabled,allowed_client_ids,role_column_id,allowed_role_values")
      : Promise.resolve({
          data: [] as EmployeeInfoVisibilityRuleRow[],
          error: null as { message?: string } | null,
        });
  let recordsForValues = records;
  const shouldPrefilterByRole =
    viewerVisibilityRule.enabled &&
    Boolean(viewerVisibilityRule.roleColumnId) &&
    viewerVisibilityRule.allowedRoleTokens.length > 0 &&
    recordsForValues.length > 0;

  if (shouldPrefilterByRole) {
    const roleColumnId = viewerVisibilityRule.roleColumnId as string;
    const rolePrefilterRecordIds = recordsForValues.map((row) => row.id).filter(Boolean);
    const roleValuesResult = await supabase
      .from("employee_info_values")
      .select("record_id,text_value,option_value")
      .in("record_id", rolePrefilterRecordIds)
      .eq("column_id", roleColumnId);

    if (roleValuesResult.error && !isSupabaseMissingTableError(roleValuesResult.error)) {
      redirect(buildEmployeeInfoUrl({ error: roleValuesResult.error.message }));
    }

    const roleValueByRecordId = new Map<string, string>();
    ((roleValuesResult.data || []) as Array<{
      record_id: string;
      text_value: string | null;
      option_value: string | null;
    }>).forEach((row) => {
      const roleValue = String(row.option_value || row.text_value || "").trim();
      if (!row.record_id) return;
      roleValueByRecordId.set(row.record_id, roleValue);
    });

    recordsForValues = recordsForValues.filter((record) =>
      isEmployeeInfoRecordVisible({
        rule: viewerVisibilityRule,
        clientId: record.client_id,
        roleValue: roleValueByRecordId.get(record.id) || "",
      })
    );
  }

  const recordIds = recordsForValues.map((row) => row.id).filter(Boolean);
  let valuesRaw: EmployeeInfoValueRow[] = [];
  let valuesError: { message?: string; code?: string } | null = null;
  if (recordIds.length) {
    const valuesResult = await supabase
      .from("employee_info_values")
      .select("record_id,column_id,text_value,option_value,money_currency_code")
      .in("record_id", recordIds);
    valuesRaw = (valuesResult.data || []) as EmployeeInfoValueRow[];
    valuesError = valuesResult.error;

    if (isSupabaseMissingColumnError(valuesError)) {
      const fallbackValuesResult = await supabase
        .from("employee_info_values")
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
  const visibleRecords = filterRecordsByVisibilityRule({
    records: recordsForValues,
    valuesByRecordId,
    rule: viewerVisibilityRule,
  });
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

  let visibilityRuleRowsByUserId = new Map<string, EmployeeInfoVisibilityRuleRow>();
  let visibilityRulesLoadError: string | null = null;
  const visibilityRulesResult = await visibilityRulesPromise;
  if (canManageVisibilityRules && !viewerVisibilityTableMissing) {
    if (visibilityRulesResult.error) {
      visibilityRulesLoadError = visibilityRulesResult.error.message || "Failed to load visibility rules";
    } else {
      visibilityRuleRowsByUserId = new Map(
        ((visibilityRulesResult.data || []) as EmployeeInfoVisibilityRuleRow[]).map((row) => [
          row.user_id,
          row,
        ])
      );
    }
  }

  async function createRecord(formData: FormData): Promise<EmployeeInfoActionResult> {
    "use server";
    const supabase = createSupabaseServerClient();
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user?.id) {
      redirect("/login");
    }

    const fullName = String(formData.get("full_name") || "").trim();
    const clientId = String(formData.get("client_id") || "").trim();
    if (!fullName) {
      return { ok: false, error: "Full name is required" };
    }

    const { data: currentUser } = await supabase
      .from("users")
      .select("id,role")
      .eq("email", auth.user.email || "")
      .maybeSingle();
    const actorUserId = currentUser?.id || auth.user.id;
    const actorIsAdmin = currentUser?.role === "admin";
    const visibilityRuleResult = await readVisibilityRuleForUser({
      supabase,
      userId: actorUserId,
    });
    if (visibilityRuleResult.error) {
      return { ok: false, error: visibilityRuleResult.error };
    }
    const assignedClientsResult = await supabase
      .from("client_users")
      .select("client_id")
      .eq("user_id", actorUserId);
    if (assignedClientsResult.error && !isSupabaseMissingTableError(assignedClientsResult.error)) {
      return { ok: false, error: assignedClientsResult.error.message };
    }
    const actorAssignedClientIds = Array.from(
      new Set(
        (assignedClientsResult.data || [])
          .map((row) => String((row as { client_id: string | null }).client_id || "").trim())
          .filter(Boolean)
      )
    );
    const visibilityRule = resolveEffectiveVisibilityRule({
      isAdmin: actorIsAdmin,
      ruleRow: visibilityRuleResult.ruleRow,
      assignedClientIds: actorAssignedClientIds,
      defaultRoleColumnId,
    });
    const isUsingDefaultRule = !actorIsAdmin && !visibilityRuleResult.ruleRow;
    if (isUsingDefaultRule && actorAssignedClientIds.length === 0) {
      return {
        ok: false,
        error:
          "You are not assigned to any clients, so you cannot create employee records until a client assignment is added.",
      };
    }
    if (
      visibilityRule.enabled &&
      visibilityRule.allowedClientIds.length &&
      (!clientId || !visibilityRule.allowedClientIds.includes(clientId))
    ) {
      return {
        ok: false,
        error: "You can only create employee records for clients included in your visibility scope.",
      };
    }

    const { error } = await supabase.from("employee_info_records").insert({
      full_name: fullName,
      client_id: clientId || null,
      created_by_user_id: actorUserId,
    });
    if (error) {
      return { ok: false, error: error.message };
    }

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

    const { data: currentUser } = await supabase
      .from("users")
      .select("id,role")
      .eq("email", auth.user.email || "")
      .maybeSingle();
    const actorUserId = currentUser?.id || auth.user.id;
    const actorIsAdmin = currentUser?.role === "admin";
    const visibilityRuleResult = await readVisibilityRuleForUser({
      supabase,
      userId: actorUserId,
    });
    if (visibilityRuleResult.error) return { ok: false, error: visibilityRuleResult.error };
    const assignedClientsResult = await supabase
      .from("client_users")
      .select("client_id")
      .eq("user_id", actorUserId);
    if (assignedClientsResult.error && !isSupabaseMissingTableError(assignedClientsResult.error)) {
      return { ok: false, error: assignedClientsResult.error.message };
    }
    const actorAssignedClientIds = Array.from(
      new Set(
        (assignedClientsResult.data || [])
          .map((row) => String((row as { client_id: string | null }).client_id || "").trim())
          .filter(Boolean)
      )
    );
    const visibilityRule = resolveEffectiveVisibilityRule({
      isAdmin: actorIsAdmin,
      ruleRow: visibilityRuleResult.ruleRow,
      assignedClientIds: actorAssignedClientIds,
      defaultRoleColumnId,
    });
    const isUsingDefaultRule = !actorIsAdmin && !visibilityRuleResult.ruleRow;
    if (isUsingDefaultRule && actorAssignedClientIds.length === 0) {
      return {
        ok: false,
        error:
          "You are not assigned to any clients, so you cannot edit employee records until a client assignment is added.",
      };
    }

    const { data: recordRow, error: recordError } = await supabase
      .from("employee_info_records")
      .select("id,client_id")
      .eq("id", recordId)
      .maybeSingle();
    if (recordError) return { ok: false, error: recordError.message };
    if (!recordRow) return { ok: false, error: "Employee record not found" };

    let cachedRoleValue: string | null = null;
    const resolveCurrentRoleValue = async () => {
      if (
        !visibilityRule.enabled ||
        !visibilityRule.roleColumnId ||
        !visibilityRule.allowedRoleTokens.length
      ) {
        return "";
      }
      if (cachedRoleValue !== null) return cachedRoleValue;
      const { data: roleValueRow, error: roleValueError } = await supabase
        .from("employee_info_values")
        .select("text_value,option_value")
        .eq("record_id", recordId)
        .eq("column_id", visibilityRule.roleColumnId)
        .maybeSingle();
      if (roleValueError) {
        return "";
      }
      cachedRoleValue = roleValueRow?.option_value || roleValueRow?.text_value || "";
      return cachedRoleValue;
    };

    if (baseField === "full_name") {
      if (!value) return { ok: false, error: "Full name is required" };
      const allowed = isEmployeeInfoRecordVisible({
        rule: visibilityRule,
        clientId: recordRow.client_id || null,
        roleValue: await resolveCurrentRoleValue(),
      });
      if (!allowed) {
        return {
          ok: false,
          error: "You do not have permission to edit this employee record based on visibility rules.",
        };
      }
      const { error } = await supabase
        .from("employee_info_records")
        .update({ full_name: value, updated_at: new Date().toISOString() })
        .eq("id", recordId);
      if (error) return { ok: false, error: error.message };
      return { ok: true };
    }

    if (baseField === "client_id") {
      const allowed = isEmployeeInfoRecordVisible({
        rule: visibilityRule,
        clientId: value || null,
        roleValue: await resolveCurrentRoleValue(),
      });
      if (!allowed) {
        return {
          ok: false,
          error:
            "You do not have permission to move this employee to the selected client based on visibility rules.",
        };
      }
      const { error } = await supabase
        .from("employee_info_records")
        .update({ client_id: value || null, updated_at: new Date().toISOString() })
        .eq("id", recordId);
      if (error) return { ok: false, error: error.message };
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

    const effectiveRoleValue =
      visibilityRule.enabled &&
      visibilityRule.roleColumnId &&
      visibilityRule.allowedRoleTokens.length &&
      columnId === visibilityRule.roleColumnId
        ? normalizedValue || ""
        : await resolveCurrentRoleValue();
    const allowed = isEmployeeInfoRecordVisible({
      rule: visibilityRule,
      clientId: recordRow.client_id || null,
      roleValue: effectiveRoleValue,
    });
    if (!allowed) {
      return {
        ok: false,
        error: "You do not have permission to edit this employee record based on visibility rules.",
      };
    }

    if (!normalizedValue) {
      const { error } = await supabase
        .from("employee_info_values")
        .delete()
        .eq("record_id", recordId)
        .eq("column_id", columnId);
      if (error) return { ok: false, error: error.message };
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
      .from("employee_info_values")
      .upsert(payload, { onConflict: "record_id,column_id" });
    if (error) return { ok: false, error: error.message };

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
    const canManageColumnsResult = await supabase.rpc("can_manage_employee_info_columns");
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
    if (kind === "dropdown" && !optionsRaw) {
      return { ok: false, error: "Dropdown options are required" };
    }
    if (kind === "formula" && !formula) {
      return { ok: false, error: "Formula is required" };
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
      formula_currency_mode: kind === "formula" ? formulaCurrencyMode : "display",
      formula_currency_code: kind === "formula" ? formulaCurrencyCode : "USD",
      options_json:
        kind === "dropdown"
          ? toOptionsJson(optionsRaw)
          : kind === "currency"
          ? { currency_code: currencyCode }
          : [],
      position: nextPosition,
      created_by_user_id: currentUser?.id || auth.user.id,
    };

    const { error } = await supabase.from("employee_info_columns").insert(payload);
    if (error) {
      return { ok: false, error: error.message };
    }

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
    const canManageColumnsResult = await supabase.rpc("can_manage_employee_info_columns");
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
    if (kind === "dropdown" && !optionsRaw) {
      return { ok: false, error: "Dropdown options are required" };
    }
    if (kind === "formula" && !formula) {
      return { ok: false, error: "Formula is required" };
    }

    const { data: existingColumn, error: existingColumnError } = await supabase
      .from("employee_info_columns")
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
      .from("employee_info_columns")
      .update({
        label,
        column_kind: kind,
        formula: kind === "formula" ? formula : null,
        formula_currency_mode: kind === "formula" ? formulaCurrencyMode : "display",
        formula_currency_code: kind === "formula" ? formulaCurrencyCode : "USD",
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
      return { ok: false, error: updateColumnError.message };
    }

    if (existingColumn.column_kind !== kind) {
      const { data: existingValueRows, error: existingValuesError } = await supabase
        .from("employee_info_values")
        .select("record_id,text_value,option_value,money_currency_code")
        .eq("column_id", columnId);
      if (existingValuesError) {
        return { ok: false, error: existingValuesError.message };
      }

      const valueRows = existingValueRows || [];
      if (kind === "formula") {
        const { error: deleteValuesError } = await supabase
          .from("employee_info_values")
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
            .from("employee_info_values")
            .delete()
            .eq("column_id", columnId)
            .in("record_id", recordIdsToDelete);
          if (deleteValuesError) {
            return { ok: false, error: deleteValuesError.message };
          }
        }

        if (payload.length) {
          const { error: upsertValuesError } = await supabase
            .from("employee_info_values")
            .upsert(payload, { onConflict: "record_id,column_id" });
          if (upsertValuesError) {
            return { ok: false, error: upsertValuesError.message };
          }
        }
      }
    }

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
    const canManageColumnsResult = await supabase.rpc("can_manage_employee_info_columns");
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

    const { error } = await supabase.from("employee_info_columns").delete().eq("id", columnId);
    if (error) {
      return { ok: false, error: error.message };
    }

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
    const canManageColumnsResult = await supabase.rpc("can_manage_employee_info_columns");
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
      .from("employee_info_columns")
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
      return { ok: false, error: failedUpdate.error.message };
    }

    return { ok: true };
  }

  async function updateVisibilityRule(formData: FormData) {
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
    let canManageVisibilityRules = currentUser?.role === "admin";
    const isAdminResult = await supabase.rpc("is_admin");
    if (!isSupabaseMissingFunctionError(isAdminResult.error)) {
      if (isAdminResult.error) {
        redirect(buildEmployeeInfoUrl({ error: isAdminResult.error.message }));
      }
      canManageVisibilityRules = Boolean(isAdminResult.data);
    }
    if (!canManageVisibilityRules) {
      redirect(buildEmployeeInfoUrl({ error: "Only admins can update visibility rules" }));
    }

    const targetUserId = String(formData.get("user_id") || "").trim();
    if (!targetUserId) {
      redirect(buildEmployeeInfoUrl({ error: "User is required for visibility rule updates" }));
    }

    const enabled = String(formData.get("enabled") || "") === "on";
    const allowedClientIds = normalizeUuidList(
      formData.getAll("allowed_client_ids").map((value) => String(value || ""))
    );
    const roleColumnId = String(formData.get("role_column_id") || "").trim() || null;
    const allowedRoleValues = parseEmployeeInfoRoleValuesInput(
      String(formData.get("allowed_role_values") || "")
    );

    if (!enabled) {
      const { error: clearError } = await supabase
        .from("employee_info_visibility_rules")
        .delete()
        .eq("user_id", targetUserId);
      if (clearError) {
        if (isSupabaseMissingTableError(clearError)) {
          redirect(
            buildEmployeeInfoUrl({
              error:
                "Visibility rules table is missing. Run sql/employee_info_visibility_rules.sql first.",
              visibilityUserId: targetUserId,
            })
          );
        }
        redirect(buildEmployeeInfoUrl({ error: clearError.message, visibilityUserId: targetUserId }));
      }

      revalidatePath("/employee-info");
      redirect(buildEmployeeInfoUrl({ success: "Visibility rule cleared", visibilityUserId: targetUserId }));
    }

    if (!roleColumnId && allowedRoleValues.length) {
      redirect(
        buildEmployeeInfoUrl({
          error: "Select a role column before setting allowed role values.",
          visibilityUserId: targetUserId,
        })
      );
    }

    if (roleColumnId) {
      const { data: roleColumn, error: roleColumnError } = await supabase
        .from("employee_info_columns")
        .select("id,column_kind")
        .eq("id", roleColumnId)
        .maybeSingle();
      if (roleColumnError) {
        redirect(buildEmployeeInfoUrl({ error: roleColumnError.message, visibilityUserId: targetUserId }));
      }
      if (!roleColumn) {
        redirect(
          buildEmployeeInfoUrl({ error: "Selected role column does not exist", visibilityUserId: targetUserId })
        );
      }
      if (roleColumn.column_kind === "formula") {
        redirect(
          buildEmployeeInfoUrl({
            error: "Formula columns cannot be used for role filtering",
            visibilityUserId: targetUserId,
          })
        );
      }
    }

    const { error: upsertError } = await supabase.from("employee_info_visibility_rules").upsert(
      {
        user_id: targetUserId,
        enabled: true,
        allowed_client_ids: allowedClientIds,
        role_column_id: roleColumnId,
        allowed_role_values: allowedRoleValues,
        created_by_user_id: currentUser?.id || auth.user.id,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" }
    );
    if (upsertError) {
      if (isSupabaseMissingTableError(upsertError)) {
        redirect(
          buildEmployeeInfoUrl({
            error:
              "Visibility rules table is missing. Run sql/employee_info_visibility_rules.sql first.",
            visibilityUserId: targetUserId,
          })
        );
      }
      redirect(buildEmployeeInfoUrl({ error: upsertError.message, visibilityUserId: targetUserId }));
    }

    revalidatePath("/employee-info");
    redirect(buildEmployeeInfoUrl({ success: "Visibility rule updated", visibilityUserId: targetUserId }));
  }

  async function clearVisibilityRule(formData: FormData) {
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
    let canManageVisibilityRules = currentUser?.role === "admin";
    const isAdminResult = await supabase.rpc("is_admin");
    if (!isSupabaseMissingFunctionError(isAdminResult.error)) {
      if (isAdminResult.error) {
        redirect(buildEmployeeInfoUrl({ error: isAdminResult.error.message }));
      }
      canManageVisibilityRules = Boolean(isAdminResult.data);
    }
    if (!canManageVisibilityRules) {
      redirect(buildEmployeeInfoUrl({ error: "Only admins can clear visibility rules" }));
    }

    const targetUserId = String(formData.get("user_id") || "").trim();
    if (!targetUserId) {
      redirect(buildEmployeeInfoUrl({ error: "User is required for visibility rule clear" }));
    }

    const { error: clearError } = await supabase
      .from("employee_info_visibility_rules")
      .delete()
      .eq("user_id", targetUserId);
    if (clearError) {
      if (isSupabaseMissingTableError(clearError)) {
        redirect(
          buildEmployeeInfoUrl({
            error:
              "Visibility rules table is missing. Run sql/employee_info_visibility_rules.sql first.",
            visibilityUserId: targetUserId,
          })
        );
      }
      redirect(buildEmployeeInfoUrl({ error: clearError.message, visibilityUserId: targetUserId }));
    }

    revalidatePath("/employee-info");
    redirect(buildEmployeeInfoUrl({ success: "Visibility rule cleared", visibilityUserId: targetUserId }));
  }

  const viewerAllowedClientNames = viewerVisibilityRule.allowedClientIds
    .map((clientId) => clientNameById[clientId] || "")
    .filter(Boolean);
  const viewerRoleColumnLabel =
    columns.find((column) => column.id === viewerVisibilityRule.roleColumnId)?.label || "";
  const viewerAllowedRoleValues =
    viewerVisibilityRuleRow && Array.isArray(viewerVisibilityRuleRow.allowed_role_values)
      ? viewerVisibilityRuleRow.allowed_role_values
          .map((value) => String(value || "").trim())
          .filter(Boolean)
      : viewerVisibilityRule.enabled
      ? DEFAULT_EMPLOYEE_INFO_ROLE_VALUES
      : [];
  const viewerUsesDefaultScope = !isAdmin && !viewerVisibilityRuleRow;
  const visibilityEditableUsers = users.filter((user) => user.role !== "admin");
  const selectedVisibilityUserId =
    canManageVisibilityRules && searchParams?.visibility_user_id
      ? String(searchParams.visibility_user_id).trim()
      : "";
  const selectedVisibilityUser =
    canManageVisibilityRules && selectedVisibilityUserId
      ? visibilityEditableUsers.find((user) => user.id === selectedVisibilityUserId) || null
      : null;
  const selectedVisibilityRuleRow = selectedVisibilityUser
    ? visibilityRuleRowsByUserId.get(selectedVisibilityUser.id) || null
    : null;
  const selectedAssignedClientIds = selectedVisibilityUser
    ? Array.from(assignedClientIdsByUserId.get(selectedVisibilityUser.id) || [])
    : [];
  const selectedHasCustomRule = Boolean(selectedVisibilityRuleRow);
  const selectedRule = toEmployeeInfoVisibilityRule(selectedVisibilityRuleRow);
  const selectedRoleColumnId =
    (selectedHasCustomRule ? selectedRule.roleColumnId : defaultRoleColumnId) || "";
  const selectedAllowedClientIds = selectedHasCustomRule
    ? selectedRule.allowedClientIds
    : selectedAssignedClientIds;
  const selectedAllowedRoleValuesText = selectedHasCustomRule
    ? ((selectedVisibilityRuleRow?.allowed_role_values || []) as string[])
        .map((value) => String(value || "").trim())
        .filter(Boolean)
        .join(", ")
    : DEFAULT_EMPLOYEE_INFO_ROLE_VALUES.join(", ");
  const selectedRoleValueHints = selectedVisibilityUser
    ? buildRoleValueSuggestions({
        records,
        valuesByRecordId,
        roleColumnId: selectedRoleColumnId || null,
      })
    : [];
  const selectedRoleColumnLabel =
    columns.find((column) => column.id === selectedRoleColumnId)?.label || "";

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

      {isAdmin && viewerVisibilityRule.enabled ? (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900">
          <p className="font-semibold uppercase tracking-wide">
            {viewerUsesDefaultScope ? "Default scope is active" : "Custom scope is active"}
          </p>
          <p className="mt-1">
            {viewerAllowedClientNames.length
              ? `Clients: ${viewerAllowedClientNames.join(", ")}.`
              : viewerUsesDefaultScope
              ? "Clients: none assigned."
              : "Clients: all."}{" "}
            {viewerRoleColumnLabel
              ? viewerAllowedRoleValues.length
                ? `Role filter (${viewerRoleColumnLabel}): ${viewerAllowedRoleValues.join(", ")}.`
                : `Role filter column (${viewerRoleColumnLabel}) is set, but no role values are limited.`
              : "Role filter: none."}
          </p>
        </div>
      ) : null}

      {canManageVisibilityRules ? (
        <section className="rounded-lg border border-slate-200 bg-white p-4 md:p-6">
          <details className="group">
            <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
              <span
                aria-hidden="true"
                className="inline-block text-[10px] transition-transform group-open:rotate-90"
              >
                &gt;
              </span>
              <span>Visibility Rules</span>
            </summary>
            <p className="mt-2 text-xs text-slate-500">
              Access to Employee Info is controlled in <code>/permissions</code>. Rules here only
              narrow what each user can see.
            </p>
            {viewerVisibilityTableMissing ? (
              <p className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                Run <code>sql/employee_info_visibility_rules.sql</code> in Supabase SQL editor to
                enable per-user visibility rules.
              </p>
            ) : visibilityRulesLoadError ? (
              <p className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                Failed to load visibility rules: {visibilityRulesLoadError}
              </p>
            ) : (
              <div className="mt-3 rounded-md border border-slate-200 bg-slate-50/70">
                <div className="border-b border-slate-200 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Users
                </div>
                <div className="max-h-80 space-y-1 overflow-y-auto p-2">
                  {visibilityEditableUsers.map((user) => {
                    const userRuleRow = visibilityRuleRowsByUserId.get(user.id) || null;
                    const userAssignedClientCount = (assignedClientIdsByUserId.get(user.id) || new Set()).size;
                    const isSelected = selectedVisibilityUserId === user.id;
                    return (
                      <a
                        key={user.id}
                        href={buildEmployeeInfoUrl({
                          displayCurrency,
                          visibilityUserId: user.id,
                        })}
                        className={[
                          "flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm",
                          isSelected
                            ? "border-slate-400 bg-white text-slate-900"
                            : "border-slate-200 bg-white text-slate-700 hover:border-slate-300",
                        ].join(" ")}
                      >
                        <span>{user.full_name || user.email || "Unnamed user"}</span>
                        <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                          {userRuleRow
                            ? "Custom scope"
                            : `Default: ${userAssignedClientCount} clients, CSR only`}
                        </span>
                      </a>
                    );
                  })}
                </div>
              </div>
            )}
          </details>
        </section>
      ) : null}

      {canManageVisibilityRules &&
      selectedVisibilityUser &&
      !viewerVisibilityTableMissing &&
      !visibilityRulesLoadError ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/40 p-4">
          <section className="w-full max-w-3xl rounded-lg border border-slate-200 bg-white p-4 shadow-xl md:p-6">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">
                  Visibility Scope: {selectedVisibilityUser.full_name || selectedVisibilityUser.email || "User"}
                </h2>
                <p className="text-xs text-slate-500">
                  Default scope is assigned clients plus {DEFAULT_EMPLOYEE_INFO_ROLE_VALUE}.
                </p>
              </div>
              <a
                href={buildEmployeeInfoUrl({ displayCurrency })}
                className="h-9 rounded-md border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 hover:bg-slate-100"
              >
                Close
              </a>
            </div>

            <form action={updateVisibilityRule} className="mt-4 space-y-4">
              <input type="hidden" name="user_id" value={selectedVisibilityUser.id} />
              <label className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-600">
                <input type="checkbox" name="enabled" defaultChecked={selectedHasCustomRule} />
                Enable custom scope override
              </label>

              <div className="grid gap-3 lg:grid-cols-3">
                <label className="grid gap-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Restrict by Client
                  <select
                    name="allowed_client_ids"
                    defaultValue={selectedAllowedClientIds}
                    multiple
                    className="min-h-[140px] rounded-md border border-slate-300 bg-white px-2 py-2 text-xs font-normal text-slate-700"
                  >
                    {clients.map((client) => (
                      <option key={client.id} value={client.id}>
                        {client.name}
                      </option>
                    ))}
                  </select>
                  <span className="font-normal normal-case tracking-normal text-slate-500">
                    Empty means all clients when custom scope is enabled.
                  </span>
                </label>

                <label className="grid gap-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Restrict by Role Column
                  <select
                    name="role_column_id"
                    defaultValue={selectedRoleColumnId}
                    className="h-11 rounded-md border border-slate-300 bg-white px-2 text-sm font-normal text-slate-700"
                  >
                    <option value="">No role filter</option>
                    {columns
                      .filter((column) => column.column_kind !== "formula")
                      .map((column) => (
                        <option key={column.id} value={column.id}>
                          {column.label}
                        </option>
                      ))}
                  </select>
                  <span className="font-normal normal-case tracking-normal text-slate-500">
                    {selectedRoleColumnLabel
                      ? `Using ${selectedRoleColumnLabel} for role matching.`
                      : "Pick the employee-role column."}
                  </span>
                </label>

                <label className="grid gap-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Restrict by Role Values
                  <input
                    name="allowed_role_values"
                    defaultValue={selectedAllowedRoleValuesText}
                    placeholder="Customer Service Representative"
                    className="h-11 rounded-md border border-slate-300 bg-white px-2 text-sm font-normal text-slate-700"
                  />
                  <span className="font-normal normal-case tracking-normal text-slate-500">
                    Comma separated. Empty means all roles when custom scope is enabled.
                  </span>
                  {selectedRoleValueHints.length ? (
                    <span className="font-normal normal-case tracking-normal text-slate-500">
                      Current values: {selectedRoleValueHints.join(", ")}
                    </span>
                  ) : null}
                </label>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="submit"
                  className="h-10 rounded-md border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 hover:bg-slate-100"
                >
                  Save custom scope
                </button>
                <button
                  type="submit"
                  formAction={clearVisibilityRule}
                  className="h-10 rounded-md border border-red-200 bg-red-50 px-3 text-sm font-semibold text-red-700 hover:bg-red-100"
                >
                  Revert to default
                </button>
              </div>
            </form>
          </section>
        </div>
      ) : null}

      <section className="rounded-lg border border-slate-200 bg-white">
        <div className="flex items-center justify-between gap-2 border-b border-slate-200 px-4 py-3">
          <div className="flex items-center gap-2">
            <CustomizeFieldsPopover columns={columns} />
            <CurrencyDisplaySelect value={displayCurrency} />
          </div>
          <div className="flex items-center gap-2">
            <a
              href={
                displayCurrency === "ORIGINAL"
                  ? `/employee-info/export?ts=${exportNonce}`
                  : `/employee-info/export?display_currency=${displayCurrency}&ts=${exportNonce}`
              }
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
            {canManageColumns ? (
              <AddColumnPopover
                formulaSuggestions={formulaSuggestions}
                onCreateColumn={createColumn}
              />
            ) : null}
          </div>
        </div>
        <EmployeeInfoTable
          records={visibleRecords}
          clients={clients}
          columns={columns}
          valuesByRecordId={valuesByRecordId}
          formulaValueByRecordIdAndColumnId={formulaValueByRecordIdAndColumnId}
          currencyDisplayValueByRecordIdAndColumnId={currencyDisplayValueByRecordIdAndColumnId}
          displayCurrency={displayCurrency}
          currentUserId={currentAppUserId}
          isAdmin={canManageColumns}
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

