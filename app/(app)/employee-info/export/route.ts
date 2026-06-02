import { NextResponse } from "next/server";
import {
  buildEmployeeInfoExchangeRateMap,
  columnIndexToLetter,
  convertEmployeeInfoCurrencyAmount,
  formatEmployeeInfoCurrencyAmount,
  normalizeEmployeeInfoCurrencyCode,
  normalizeEmployeeInfoDisplayCurrencyCode,
  normalizeEmployeeInfoFormulaCurrencyMode,
  parseEmployeeInfoCurrencyCodeFromOptions,
  parseEmployeeInfoDateToSerial,
  toEmployeeInfoColumnKey,
  type EmployeeInfoCurrencyCode,
  type EmployeeInfoDisplayCurrencyCode,
  type EmployeeInfoExchangeRateRow,
} from "@/lib/employeeInfo";
import { evaluateEmployeeFormula, formatFormulaResult } from "@/lib/employeeInfoFormula";
import {
  isSupabaseMissingColumnError,
  isSupabaseMissingFunctionError,
  isSupabaseMissingTableError,
} from "@/lib/supabaseErrors";
import { getCurrentRequestUser } from "@/lib/supabase/currentUser";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  isEmployeeInfoRecordVisible,
  normalizeEmployeeInfoRoleToken,
  type EmployeeInfoVisibilityRule,
  toEmployeeInfoVisibilityRule,
  type EmployeeInfoVisibilityRuleRow,
} from "@/lib/employeeInfoVisibilityRules";

export const dynamic = "force-dynamic";
export const revalidate = 0;

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

const DEFAULT_EMPLOYEE_INFO_ROLE_VALUES = ["Customer Service Representative"];

function csvEscape(value: unknown) {
  const text = String(value ?? "");
  if (!/["\n,\r]/.test(text)) return text;
  return `"${text.replace(/"/g, "\"\"")}"`;
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

function buildRoleValueLookup(args: {
  records: EmployeeInfoRecordRow[];
  valuesByRecordId: EmployeeInfoValuesByRecordId;
  roleColumnId: string | null;
}) {
  const { records, valuesByRecordId, roleColumnId } = args;
  if (!roleColumnId) return {} as Record<string, string>;

  return records.reduce<Record<string, string>>((acc, record) => {
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
      if (dynamicIndex < 0 || dynamicIndex >= columns.length) return "";
      const column = columns[dynamicIndex];

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
  const targetCurrencyCode = normalizeEmployeeInfoCurrencyCode(displayCurrency);
  const result: Record<string, Record<string, string>> = {};

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

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const displayCurrency = normalizeEmployeeInfoDisplayCurrencyCode(
    requestUrl.searchParams.get("display_currency")
  );
  const supabase = createSupabaseServerClient();
  const authUser = await getCurrentRequestUser(supabase, "employee_info.export.auth");
  const authUserId = authUser?.id;
  const authEmail = authUser?.email || "";
  if (!authUserId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: profile } = await supabase
    .from("users")
    .select("id,role")
    .eq("email", authEmail)
    .maybeSingle();
  const currentAppUserId = profile?.id || authUserId;
  const isAdmin = profile?.role === "admin";
  let canAccessEmployeeInfo = isAdmin;

  const canAccessResult = await supabase.rpc("can_access_employee_info");
  if (!isSupabaseMissingFunctionError(canAccessResult.error) && !canAccessResult.error) {
    canAccessEmployeeInfo = Boolean(canAccessResult.data);
  }

  if (!canAccessEmployeeInfo) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const visibilityRuleResult = await supabase
    .from("employee_info_visibility_rules")
    .select("user_id,enabled,allowed_client_ids,role_column_id,allowed_role_values")
    .eq("user_id", currentAppUserId)
    .maybeSingle();
  if (visibilityRuleResult.error && !isSupabaseMissingTableError(visibilityRuleResult.error)) {
    return NextResponse.json({ error: visibilityRuleResult.error.message }, { status: 400 });
  }
  const viewerRuleRow = isSupabaseMissingTableError(visibilityRuleResult.error)
    ? null
    : ((visibilityRuleResult.data || null) as EmployeeInfoVisibilityRuleRow | null);
  const viewerClientMembershipResult = await supabase
    .from("client_users")
    .select("client_id")
    .eq("user_id", currentAppUserId);
  if (
    viewerClientMembershipResult.error &&
    !isSupabaseMissingTableError(viewerClientMembershipResult.error)
  ) {
    return NextResponse.json({ error: viewerClientMembershipResult.error.message }, { status: 400 });
  }
  const viewerAssignedClientIds = Array.from(
    new Set(
      (viewerClientMembershipResult.data || [])
        .map((row) => String((row as { client_id: string | null }).client_id || "").trim())
        .filter(Boolean)
    )
  );
  const viewerCustomRule = toEmployeeInfoVisibilityRule(viewerRuleRow);

  const { data: clientsRaw } = await supabase.from("clients").select("id,name");
  let recordsQuery = supabase
    .from("employee_info_records")
    .select("id,full_name,client_id,created_at")
    .order("created_at", { ascending: false });
  const shouldApplyDefaultClientScope = !isAdmin && !viewerRuleRow;
  if (viewerCustomRule.enabled && viewerCustomRule.allowedClientIds.length) {
    recordsQuery = recordsQuery.in("client_id", viewerCustomRule.allowedClientIds);
  } else if (shouldApplyDefaultClientScope && viewerAssignedClientIds.length) {
    recordsQuery = recordsQuery.in("client_id", viewerAssignedClientIds);
  }
  const { data: recordsRaw, error: recordsError } = await recordsQuery;
  let { data: columnsRaw, error: columnsError } = await supabase
    .from("employee_info_columns")
    .select(
      "id,key,label,column_kind,formula,formula_currency_mode,formula_currency_code,options_json,position"
    )
    .order("position", { ascending: true })
    .order("created_at", { ascending: true });
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

  if (recordsError) {
    return NextResponse.json({ error: recordsError.message }, { status: 400 });
  }
  if (columnsError) {
    return NextResponse.json({ error: columnsError.message }, { status: 400 });
  }

  const columns = (columnsRaw || []) as EmployeeInfoColumnRow[];
  const defaultRoleColumnId = resolveDefaultRoleColumnId(columns);
  const viewerRule = resolveEffectiveVisibilityRule({
    isAdmin,
    ruleRow: viewerRuleRow,
    assignedClientIds: viewerAssignedClientIds,
    defaultRoleColumnId,
  });
  const records =
    shouldApplyDefaultClientScope && viewerAssignedClientIds.length === 0
      ? ([] as EmployeeInfoRecordRow[])
      : ((recordsRaw || []) as EmployeeInfoRecordRow[]);
  const clients = (clientsRaw || []) as Array<{ id: string; name: string }>;

  const recordIds = records.map((row) => row.id).filter(Boolean);
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

  if (valuesError) {
    return NextResponse.json({ error: valuesError.message }, { status: 400 });
  }

  const { data: exchangeRateRowsRaw, error: exchangeRateError } = await supabase
    .from("employee_info_exchange_rates")
    .select("base_currency_code,quote_currency_code,rate,effective_month_start")
    .order("effective_month_start", { ascending: false });
  const exchangeRateRows = (
    isSupabaseMissingTableError(exchangeRateError) ? [] : exchangeRateRowsRaw || []
  ) as EmployeeInfoExchangeRateRow[];

  const valuesByRecordId = buildValueMap((valuesRaw || []) as EmployeeInfoValueRow[]);
  const visibleRecords = filterRecordsByVisibilityRule({
    records,
    valuesByRecordId,
    rule: viewerRule,
  });
  const clientNameById = clients.reduce<Record<string, string>>((acc, client) => {
    acc[client.id] = client.name;
    return acc;
  }, {});
  const formulaValueByRecordIdAndColumnId = buildFormulaValueMap({
    records: visibleRecords,
    columns,
    valueMap: valuesByRecordId,
    clientNameById,
    exchangeRateRows,
    displayCurrency,
  });
  const currencyDisplayValueByRecordIdAndColumnId = buildCurrencyDisplayValueMap({
    records: visibleRecords,
    columns,
    valueMap: valuesByRecordId,
    exchangeRateRows,
    displayCurrency,
  });

  const headers = ["Full Name", "Client", ...columns.map((column) => column.label)];
  const rows = visibleRecords.map((record) => {
    const valuesByColumnId = valuesByRecordId[record.id] || {};
    const formulasByColumnId = formulaValueByRecordIdAndColumnId[record.id] || {};
    const rowValues: string[] = [
      record.full_name,
      record.client_id ? clientNameById[record.client_id] || "" : "",
    ];

    columns.forEach((column) => {
      if (column.column_kind === "formula") {
        rowValues.push(formulasByColumnId[column.id] || "");
        return;
      }
      const value = valuesByColumnId[column.id];
      if (!value) {
        rowValues.push("");
        return;
      }
      if (column.column_kind === "dropdown") {
        rowValues.push(value.option_value || "");
        return;
      }
      if (column.column_kind === "currency") {
        const sourceAmount = String(value.text_value || "").trim();
        if (!sourceAmount) {
          rowValues.push("");
          return;
        }
        if (displayCurrency !== "ORIGINAL") {
          rowValues.push(currencyDisplayValueByRecordIdAndColumnId[record.id]?.[column.id] || "");
          return;
        }
        const sourceCurrencyCode = normalizeEmployeeInfoCurrencyCode(
          value.money_currency_code || parseEmployeeInfoCurrencyCodeFromOptions(column.options_json)
        );
        rowValues.push(formatEmployeeInfoCurrencyAmount(sourceAmount, sourceCurrencyCode));
        return;
      }
      rowValues.push(value.text_value || "");
    });
    return rowValues;
  });

  const csvLines = [headers, ...rows].map((row) => row.map(csvEscape).join(",")).join("\r\n");
  const fileName = `employee-info-${new Date().toISOString().slice(0, 10)}.csv`;
  const body = `\uFEFF${csvLines}`;

  return new NextResponse(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename=\"${fileName}\"`,
      "Cache-Control": "no-store",
      Pragma: "no-cache",
      Expires: "0",
      Vary: "Cookie",
    },
  });
}
