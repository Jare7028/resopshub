import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import ClientTabs from "../_components/ClientTabs";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  isSupabaseMissingColumnError,
  isSupabaseMissingFunctionError,
  isSupabaseMissingTableError,
} from "@/lib/supabaseErrors";
import {
  EMPLOYEE_INFO_CURRENCY_CODES,
  buildEmployeeInfoExchangeRateMap,
  columnIndexToLetter,
  convertEmployeeInfoCurrencyAmount,
  evaluateEmployeeFormula,
  formatEmployeeInfoCurrencyAmount,
  normalizeEmployeeInfoCurrencyCode,
  normalizeEmployeeInfoFormulaCurrencyMode,
  parseEmployeeInfoCurrencyCodeFromOptions,
  toEmployeeInfoColumnKey,
  toFormulaNumber,
  type EmployeeInfoCurrencyCode,
  type EmployeeInfoExchangeRateRow,
} from "@/lib/employeeInfo";
import RevenueChargesEditor from "./RevenueChargesEditor";
import EmployeeMonthlyCostBreakdownPopover from "./EmployeeMonthlyCostBreakdownPopover";

type EmployeeInfoRecordRow = {
  id: string;
  full_name: string;
  client_id: string | null;
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

type BillingProfileRevenueRow = {
  id: string;
  currency: string | null;
  hourly_rate: number | string | null;
  total_billable_hours: number | string | null;
  revenue_charge_items: unknown;
};

type BillingRevenueChargeMode = "per_user" | "monthly";

type BillingRevenueChargeItem = {
  id: string;
  label: string;
  amount: number;
  mode: BillingRevenueChargeMode;
};

type EmployeeMonthlyCostSummary = {
  amount: number;
  currencyCode: EmployeeInfoCurrencyCode;
  clientRowCount: number;
  contributingRowCount: number;
  roleColumnLabel: string | null;
  breakdownRows: Array<{
    roleLabel: string;
    employeeCount: number;
    contributingRowCount: number;
    totalAmount: number;
  }>;
  isConfigured: boolean;
  hasMissingExchangeRate: boolean;
  errorMessage: string | null;
};

function buildEmployeeInfoValueMap(
  rows: EmployeeInfoValueRow[]
): Record<
  string,
  Record<string, { text_value: string | null; option_value: string | null; money_currency_code: string | null }>
> {
  return rows.reduce<
    Record<
      string,
      Record<string, { text_value: string | null; option_value: string | null; money_currency_code: string | null }>
    >
  >((acc, row) => {
    if (!row || !row.record_id || !row.column_id) return acc;
    if (!acc[row.record_id]) acc[row.record_id] = {};
    acc[row.record_id][row.column_id] = {
      text_value: row.text_value,
      option_value: row.option_value,
      money_currency_code: row.money_currency_code,
    };
    return acc;
  }, {});
}

function isTotalMonthlyCostColumn(column: EmployeeInfoColumnRow) {
  const expectedKey = "total_monthly_cost";
  return (
    toEmployeeInfoColumnKey(column.key) === expectedKey ||
    toEmployeeInfoColumnKey(column.label) === expectedKey
  );
}

function parseNumericCellValue(value: string | null | undefined) {
  const normalized = String(value || "")
    .trim()
    .replace(/,/g, "");
  if (!normalized) return null;
  const numeric = Number(normalized);
  return Number.isFinite(numeric) ? numeric : null;
}

function getRoleBreakdownColumnScore(column: EmployeeInfoColumnRow) {
  if (column.column_kind !== "text" && column.column_kind !== "dropdown") return 0;

  const tokens = [toEmployeeInfoColumnKey(column.key), toEmployeeInfoColumnKey(column.label)];
  let score = 0;
  tokens.forEach((token) => {
    if (token === "position") score = Math.max(score, 100);
    if (token === "role") score = Math.max(score, 95);
    if (token === "job_title") score = Math.max(score, 90);
    if (token === "job_role") score = Math.max(score, 85);
    if (token === "employee_role") score = Math.max(score, 80);
    if (token === "title") score = Math.max(score, 70);
    if (token === "function") score = Math.max(score, 60);
  });
  return score;
}

function toFiniteNumber(value: unknown) {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function parseNonNegativeNumberInput(value: FormDataEntryValue | null, label: string) {
  const raw = String(value || "")
    .trim()
    .replace(/,/g, "");
  if (!raw) return { value: null as number | null, error: null as string | null };
  const numeric = Number(raw);
  if (!Number.isFinite(numeric)) {
    return { value: null as number | null, error: `${label} must be a valid number` };
  }
  if (numeric < 0) {
    return { value: null as number | null, error: `${label} cannot be negative` };
  }
  return { value: numeric, error: null as string | null };
}

function normalizeBillingRevenueChargeMode(value: unknown): BillingRevenueChargeMode {
  return String(value || "").trim().toLowerCase() === "per_user" ? "per_user" : "monthly";
}

function parseBillingRevenueChargeItems(value: unknown): BillingRevenueChargeItem[] {
  if (!Array.isArray(value)) return [];

  const normalized: BillingRevenueChargeItem[] = [];
  value.forEach((entry, index) => {
    if (!entry || typeof entry !== "object") return;
    const row = entry as {
      id?: unknown;
      label?: unknown;
      amount?: unknown;
      mode?: unknown;
    };
    const label = String(row.label || "").trim();
    const amountRaw = String(row.amount ?? "")
      .trim()
      .replace(/,/g, "");
    const amount = Number(amountRaw);
    if (!label || !Number.isFinite(amount) || amount < 0) return;

    const idRaw = String(row.id || "").trim();
    normalized.push({
      id: idRaw || `charge_${index + 1}`,
      label,
      amount,
      mode: normalizeBillingRevenueChargeMode(row.mode),
    });
  });

  return normalized;
}

function parseRevenueChargeItemsInput(value: FormDataEntryValue | null) {
  const raw = String(value || "").trim();
  if (!raw) return { value: [] as BillingRevenueChargeItem[], error: null as string | null };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { value: [] as BillingRevenueChargeItem[], error: "Additional charges are invalid." };
  }

  if (!Array.isArray(parsed)) {
    return { value: [] as BillingRevenueChargeItem[], error: "Additional charges are invalid." };
  }

  const normalized: BillingRevenueChargeItem[] = [];
  for (let index = 0; index < parsed.length; index += 1) {
    const entry = parsed[index];
    if (!entry || typeof entry !== "object") continue;
    const row = entry as {
      id?: unknown;
      label?: unknown;
      amount?: unknown;
      mode?: unknown;
    };

    const label = String(row.label || "").trim();
    const amountRaw = String(row.amount ?? "")
      .trim()
      .replace(/,/g, "");

    if (!label && !amountRaw) continue;
    if (!label) {
      return { value: [] as BillingRevenueChargeItem[], error: `Charge ${index + 1} needs a label.` };
    }

    const amount = Number(amountRaw);
    if (!Number.isFinite(amount)) {
      return {
        value: [] as BillingRevenueChargeItem[],
        error: `Charge "${label}" must have a valid amount.`,
      };
    }
    if (amount < 0) {
      return {
        value: [] as BillingRevenueChargeItem[],
        error: `Charge "${label}" cannot be negative.`,
      };
    }

    const idRaw = String(row.id || "").trim();
    normalized.push({
      id: idRaw || `charge_${index + 1}`,
      label,
      amount,
      mode: normalizeBillingRevenueChargeMode(row.mode),
    });
  }

  return { value: normalized, error: null as string | null };
}

function formatPercent(value: number | null) {
  if (value === null || !Number.isFinite(value)) return "-";
  const rounded = value.toFixed(1).replace(/\.0$/, "");
  return `${rounded}%`;
}

function hasStringId(value: unknown): value is { id: string } {
  return (
    !!value &&
    typeof value === "object" &&
    typeof (value as { id?: unknown }).id === "string" &&
    String((value as { id: string }).id).trim().length > 0
  );
}

export default async function ClientBillingPage(props: {
  params: Promise<{ clientId: string }>;
  searchParams?: Promise<{ error?: string; success?: string }>;
}) {
  const params = await props.params;
  const searchParams = await props.searchParams;
  const clientId = params.clientId;
  const supabase = createSupabaseServerClient();
  const { data: client } = await supabase
    .from("clients")
    .select("id,name")
    .eq("id", clientId)
    .single();

  if (!client) {
    notFound();
  }
  const clientName = client.name;
  const clientRecordId = client.id;
  let canEditBilling = true;
  let billingPermissionErrorMessage: string | null = null;

  const canEditBillingResult = await supabase.rpc("can_edit_client_billing", {
    client_uuid: clientId,
  });
  if (isSupabaseMissingFunctionError(canEditBillingResult.error)) {
    canEditBilling = true;
  } else if (canEditBillingResult.error) {
    canEditBilling = false;
    billingPermissionErrorMessage = `Could not verify billing edit permission (${canEditBillingResult.error.message}).`;
  } else {
    canEditBilling = Boolean(canEditBillingResult.data);
  }

  let billingProfile: BillingProfileRevenueRow | null = null;
  let billingProfileErrorMessage: string | null = null;
  let billingRevenueColumnsMissing = false;
  let billingProfilesTableMissing = false;

  let { data: billingProfileRaw, error: billingProfileError } = await supabase
    .from("billing_profiles")
    .select("id,currency,hourly_rate,total_billable_hours,revenue_charge_items")
    .eq("client_id", clientId)
    .maybeSingle();

  if (isSupabaseMissingColumnError(billingProfileError)) {
    billingRevenueColumnsMissing = true;
    const fallbackProfile = await supabase
      .from("billing_profiles")
      .select("id,currency,hourly_rate,total_billable_hours")
      .eq("client_id", clientId)
      .maybeSingle();
    if (isSupabaseMissingColumnError(fallbackProfile.error)) {
      const fallbackProfileMinimal = await supabase
        .from("billing_profiles")
        .select("id,currency")
        .eq("client_id", clientId)
        .maybeSingle();
      billingProfileError = fallbackProfileMinimal.error;
      billingProfileRaw = fallbackProfileMinimal.data
        ? {
            ...fallbackProfileMinimal.data,
            hourly_rate: null,
            total_billable_hours: null,
            revenue_charge_items: [],
          }
        : null;
    } else {
      billingProfileError = fallbackProfile.error;
      billingProfileRaw = fallbackProfile.data
        ? {
            ...fallbackProfile.data,
            revenue_charge_items: [],
          }
        : null;
    }
  }

  if (isSupabaseMissingTableError(billingProfileError)) {
    billingProfilesTableMissing = true;
    billingProfile = null;
  } else if (billingProfileError) {
    billingProfileErrorMessage = `Could not load billing profile (${billingProfileError.message}).`;
    billingProfile = null;
  } else {
    billingProfile = (billingProfileRaw || null) as BillingProfileRevenueRow | null;
  }

  const billingCurrencyCode = normalizeEmployeeInfoCurrencyCode(billingProfile?.currency || "USD");
  const employeeMonthlyCostSummary: EmployeeMonthlyCostSummary = {
    amount: 0,
    currencyCode: billingCurrencyCode,
    clientRowCount: 0,
    contributingRowCount: 0,
    roleColumnLabel: null,
    breakdownRows: [],
    isConfigured: false,
    hasMissingExchangeRate: false,
    errorMessage: null,
  };

  const { data: employeeRecordsRaw, error: employeeRecordsError } = await supabase
    .from("employee_info_records")
    .select("id,full_name,client_id")
    .eq("client_id", clientId);

  if (isSupabaseMissingTableError(employeeRecordsError)) {
    employeeMonthlyCostSummary.errorMessage = "Employee Info is not set up yet.";
  } else if (employeeRecordsError) {
    employeeMonthlyCostSummary.errorMessage = `Could not load Employee Info rows (${employeeRecordsError.message}).`;
  } else {
    let { data: employeeColumnsRaw, error: employeeColumnsError } = await supabase
      .from("employee_info_columns")
      .select(
        "id,key,label,column_kind,formula,formula_currency_mode,formula_currency_code,options_json,position"
      )
      .order("position", { ascending: true })
      .order("created_at", { ascending: true });

    if (isSupabaseMissingColumnError(employeeColumnsError)) {
      const fallbackColumns = await supabase
        .from("employee_info_columns")
        .select("id,key,label,column_kind,formula,options_json,position")
        .order("position", { ascending: true })
        .order("created_at", { ascending: true });
      employeeColumnsError = fallbackColumns.error;
      employeeColumnsRaw = (fallbackColumns.data || [])
        .filter((column) => hasStringId(column))
        .map((column) => ({
          ...column,
          formula_currency_mode: "display",
          formula_currency_code: "USD",
        }));
    }

    if (isSupabaseMissingTableError(employeeColumnsError)) {
      employeeMonthlyCostSummary.errorMessage = "Employee Info is not set up yet.";
    } else if (employeeColumnsError) {
      employeeMonthlyCostSummary.errorMessage = `Could not load Employee Info columns (${employeeColumnsError.message}).`;
    } else {
      const employeeRecords = ((employeeRecordsRaw || []) as EmployeeInfoRecordRow[]).filter((row) =>
        hasStringId(row)
      );
      employeeMonthlyCostSummary.clientRowCount = employeeRecords.length;
      const employeeColumns = ((employeeColumnsRaw || []) as EmployeeInfoColumnRow[]).filter((row) =>
        hasStringId(row)
      );
      const monthlyCostColumn = employeeColumns.find(isTotalMonthlyCostColumn);
      const roleBreakdownColumn =
        employeeColumns
          .map((column) => ({
            column,
            score: getRoleBreakdownColumnScore(column),
          }))
          .filter((entry) => entry.score > 0)
          .sort((left, right) => {
            if (right.score !== left.score) return right.score - left.score;
            return (left.column.position || 0) - (right.column.position || 0);
          })[0]?.column || null;
      if (roleBreakdownColumn) {
        employeeMonthlyCostSummary.roleColumnLabel = roleBreakdownColumn.label;
      }

      if (monthlyCostColumn) {
        employeeMonthlyCostSummary.isConfigured = true;

        const employeeRecordIds = employeeRecords.map((row) => row.id).filter(Boolean);
        let employeeValuesRaw: EmployeeInfoValueRow[] = [];
        let employeeValuesError: { message?: string; code?: string } | null = null;
        if (employeeRecordIds.length) {
          const employeeValuesResult = await supabase
            .from("employee_info_values")
            .select("record_id,column_id,text_value,option_value,money_currency_code")
            .in("record_id", employeeRecordIds);
          employeeValuesRaw = (employeeValuesResult.data || []) as EmployeeInfoValueRow[];
          employeeValuesError = employeeValuesResult.error;

          if (isSupabaseMissingColumnError(employeeValuesError)) {
            const fallbackValuesResult = await supabase
              .from("employee_info_values")
              .select("record_id,column_id,text_value,option_value")
              .in("record_id", employeeRecordIds);
            employeeValuesError = fallbackValuesResult.error;
            employeeValuesRaw = ((fallbackValuesResult.data || []) as Array<
              Omit<EmployeeInfoValueRow, "money_currency_code">
            >)
              .filter((row) => !!row && !!row.record_id && !!row.column_id)
              .map((row) => ({
                ...row,
                money_currency_code: null,
              }));
          }
        }

        if (employeeValuesError && !isSupabaseMissingTableError(employeeValuesError)) {
          employeeMonthlyCostSummary.errorMessage = `Could not load Employee Info values (${employeeValuesError.message}).`;
        } else {
          const employeeValueRows = (
            isSupabaseMissingTableError(employeeValuesError) ? [] : employeeValuesRaw || []
          ) as EmployeeInfoValueRow[];
          const valuesByRecordId = buildEmployeeInfoValueMap(employeeValueRows);

          const { data: exchangeRateRowsRaw, error: exchangeRateError } = await supabase
            .from("employee_info_exchange_rates")
            .select("base_currency_code,quote_currency_code,rate,effective_month_start")
            .order("effective_month_start", { ascending: false });

          if (exchangeRateError && !isSupabaseMissingTableError(exchangeRateError)) {
            employeeMonthlyCostSummary.errorMessage = `Could not load Employee Info exchange rates (${exchangeRateError.message}).`;
          } else {
            const exchangeRateRows = (
              isSupabaseMissingTableError(exchangeRateError) ? [] : exchangeRateRowsRaw || []
            ) as EmployeeInfoExchangeRateRow[];
            const monthStart = `${new Date().toISOString().slice(0, 7)}-01`;
            const exchangeRateMap = buildEmployeeInfoExchangeRateMap(exchangeRateRows, monthStart);

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
            employeeColumns.forEach((column, index) => {
              const displayIndex = index + 2;
              registerReference(column.key, displayIndex);
              registerReference(toEmployeeInfoColumnKey(column.label), displayIndex);
              registerReference(columnIndexToLetter(displayIndex), displayIndex);
            });

            const resolveFormulaTargetCurrencyCode = (column: EmployeeInfoColumnRow) => {
              const formulaMode = normalizeEmployeeInfoFormulaCurrencyMode(
                column.formula_currency_mode
              );
              if (formulaMode === "fixed") {
                return normalizeEmployeeInfoCurrencyCode(column.formula_currency_code);
              }
              return billingCurrencyCode;
            };

            const monthlyCostDisplayIndex =
              employeeColumns.findIndex((column) => column.id === monthlyCostColumn.id) + 2;
            const roleBreakdownMap = new Map<
              string,
              {
                roleLabel: string;
                employeeCount: number;
                contributingRowCount: number;
                totalAmount: number;
              }
            >();

            employeeRecords.forEach((record) => {
              const valuesByColumnId = valuesByRecordId[record.id] || {};
              const roleSourceValue = roleBreakdownColumn
                ? valuesByColumnId[roleBreakdownColumn.id]
                : null;
              const roleLabel = String(
                roleBreakdownColumn?.column_kind === "dropdown"
                  ? roleSourceValue?.option_value
                  : roleSourceValue?.text_value
              ).trim() || "Unspecified role";
              const roleEntry = roleBreakdownMap.get(roleLabel) || {
                roleLabel,
                employeeCount: 0,
                contributingRowCount: 0,
                totalAmount: 0,
              };
              roleEntry.employeeCount += 1;
              roleBreakdownMap.set(roleLabel, roleEntry);

              const resolveDisplayIndexValue = (
                displayIndex: number,
                visiting: Set<number>,
                targetCurrencyCode: EmployeeInfoCurrencyCode,
                onMissingExchangeRate: () => void,
                onCurrencyOperand: () => void
              ): unknown => {
                if (displayIndex === 0) return record.full_name;
                if (displayIndex === 1) return record.client_id === clientRecordId ? clientName : "";

                const dynamicIndex = displayIndex - 2;
                if (dynamicIndex < 0 || dynamicIndex >= employeeColumns.length) return "";
                const dynamicColumn = employeeColumns[dynamicIndex];

                if (dynamicColumn.column_kind === "formula") {
                  if (visiting.has(displayIndex)) return 0;
                  visiting.add(displayIndex);
                  const nestedValue = evaluateEmployeeFormula(
                    dynamicColumn.formula,
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
                  return nestedValue ?? 0;
                }

                const cellValue = valuesByColumnId[dynamicColumn.id];
                if (!cellValue) return "";
                if (dynamicColumn.column_kind === "dropdown") return cellValue.option_value || "";

                if (dynamicColumn.column_kind === "currency") {
                  onCurrencyOperand();
                  const sourceAmount = Number(cellValue.text_value);
                  if (!Number.isFinite(sourceAmount)) return 0;
                  const sourceCurrencyCode = normalizeEmployeeInfoCurrencyCode(
                    cellValue.money_currency_code ||
                      parseEmployeeInfoCurrencyCodeFromOptions(dynamicColumn.options_json)
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

                return cellValue.text_value || "";
              };

              const resolveNamedReferenceValue = (
                reference: string,
                visiting: Set<number>,
                targetCurrencyCode: EmployeeInfoCurrencyCode,
                onMissingExchangeRate: () => void,
                onCurrencyOperand: () => void
              ) => {
                const displayIndex =
                  namedReferenceToDisplayIndex[String(reference || "").trim().toLowerCase()];
                if (displayIndex === undefined) return undefined;
                return resolveDisplayIndexValue(
                  displayIndex,
                  visiting,
                  targetCurrencyCode,
                  onMissingExchangeRate,
                  onCurrencyOperand
                );
              };

              let amountToAdd: number | null = null;
              if (monthlyCostColumn.column_kind === "formula") {
                const formulaTargetCurrencyCode = resolveFormulaTargetCurrencyCode(monthlyCostColumn);
                let hasMissingExchangeRate = false;
                let hasCurrencyOperand = false;
                const evaluated = evaluateEmployeeFormula(
                  monthlyCostColumn.formula,
                  (refIndex) =>
                    resolveDisplayIndexValue(
                      refIndex,
                      new Set([monthlyCostDisplayIndex]),
                      formulaTargetCurrencyCode,
                      () => {
                        hasMissingExchangeRate = true;
                      },
                      () => {
                        hasCurrencyOperand = true;
                      }
                    ),
                  (reference) =>
                    resolveNamedReferenceValue(
                      reference,
                      new Set([monthlyCostDisplayIndex]),
                      formulaTargetCurrencyCode,
                      () => {
                        hasMissingExchangeRate = true;
                      },
                      () => {
                        hasCurrencyOperand = true;
                      }
                    )
                );
                if (hasMissingExchangeRate) {
                  employeeMonthlyCostSummary.hasMissingExchangeRate = true;
                  return;
                }

                const numericEvaluated = toFormulaNumber(evaluated);
                if (!Number.isFinite(numericEvaluated)) return;
                if (!hasCurrencyOperand || formulaTargetCurrencyCode === billingCurrencyCode) {
                  amountToAdd = numericEvaluated;
                } else {
                  const convertedAmount = convertEmployeeInfoCurrencyAmount({
                    amount: numericEvaluated,
                    fromCurrencyCode: formulaTargetCurrencyCode,
                    toCurrencyCode: billingCurrencyCode,
                    exchangeRateMap,
                  });
                  if (convertedAmount === null) {
                    employeeMonthlyCostSummary.hasMissingExchangeRate = true;
                    return;
                  }
                  amountToAdd = convertedAmount;
                }
              } else if (monthlyCostColumn.column_kind === "currency") {
                const value = valuesByColumnId[monthlyCostColumn.id];
                if (!value?.text_value) return;
                const sourceAmount = parseNumericCellValue(value.text_value);
                if (!Number.isFinite(sourceAmount)) return;
                const sourceCurrencyCode = normalizeEmployeeInfoCurrencyCode(
                  value.money_currency_code ||
                    parseEmployeeInfoCurrencyCodeFromOptions(monthlyCostColumn.options_json)
                );
                const convertedAmount = convertEmployeeInfoCurrencyAmount({
                  amount: sourceAmount,
                  fromCurrencyCode: sourceCurrencyCode,
                  toCurrencyCode: billingCurrencyCode,
                  exchangeRateMap,
                });
                if (convertedAmount === null) {
                  employeeMonthlyCostSummary.hasMissingExchangeRate = true;
                  return;
                }
                amountToAdd = convertedAmount;
              } else if (monthlyCostColumn.column_kind === "dropdown") {
                amountToAdd = parseNumericCellValue(valuesByColumnId[monthlyCostColumn.id]?.option_value);
              } else {
                amountToAdd = parseNumericCellValue(valuesByColumnId[monthlyCostColumn.id]?.text_value);
              }

              if (amountToAdd === null || !Number.isFinite(amountToAdd)) return;
              employeeMonthlyCostSummary.amount += amountToAdd;
              employeeMonthlyCostSummary.contributingRowCount += 1;
              roleEntry.contributingRowCount += 1;
              roleEntry.totalAmount += amountToAdd;
              roleBreakdownMap.set(roleLabel, roleEntry);
            });

            employeeMonthlyCostSummary.breakdownRows = Array.from(roleBreakdownMap.values()).sort(
              (left, right) => {
                if (right.employeeCount !== left.employeeCount) {
                  return right.employeeCount - left.employeeCount;
                }
                if (right.totalAmount !== left.totalAmount) {
                  return right.totalAmount - left.totalAmount;
                }
                return left.roleLabel.localeCompare(right.roleLabel);
              }
            );
          }
        }
      }
    }
  }

  const hourlyRate = toFiniteNumber(billingProfile?.hourly_rate) ?? 0;
  const totalBillableHours = toFiniteNumber(billingProfile?.total_billable_hours) ?? 0;
  const revenueChargeItems = parseBillingRevenueChargeItems(billingProfile?.revenue_charge_items);
  const additionalMonthlyRevenue = revenueChargeItems.reduce((sum, charge) => {
    const quantity = charge.mode === "per_user" ? employeeMonthlyCostSummary.clientRowCount : 1;
    return sum + charge.amount * quantity;
  }, 0);
  const estimatedMonthlyRevenue = hourlyRate * totalBillableHours + additionalMonthlyRevenue;
  const estimatedMonthlyMargin = estimatedMonthlyRevenue - employeeMonthlyCostSummary.amount;
  const estimatedMonthlyMarginPercent =
    estimatedMonthlyRevenue > 0 ? (estimatedMonthlyMargin / estimatedMonthlyRevenue) * 100 : null;

  async function saveRevenueModel(formData: FormData) {
    "use server";
    const supabase = createSupabaseServerClient();

    if (!canEditBilling) {
      redirect(
        `/clients/${clientId}/billing?error=${encodeURIComponent(
          "You do not have permission to edit billing for this client."
        )}`
      );
    }

    if (billingProfilesTableMissing) {
      redirect(
        `/clients/${clientId}/billing?error=${encodeURIComponent(
          "Billing table is missing. Set up billing_profiles first."
        )}`
      );
    }

    if (billingRevenueColumnsMissing) {
      redirect(
        `/clients/${clientId}/billing?error=${encodeURIComponent(
          "Run sql/client_billing_revenue_fields.sql before saving revenue fields."
        )}`
      );
    }

    const currency = normalizeEmployeeInfoCurrencyCode(String(formData.get("currency") || "USD"));
    const hourlyRateValue = parseNonNegativeNumberInput(formData.get("hourly_rate"), "Hourly rate");
    if (hourlyRateValue.error) {
      redirect(`/clients/${clientId}/billing?error=${encodeURIComponent(hourlyRateValue.error)}`);
    }
    const totalBillableHoursValue = parseNonNegativeNumberInput(
      formData.get("total_billable_hours"),
      "Total billable hours"
    );
    if (totalBillableHoursValue.error) {
      redirect(`/clients/${clientId}/billing?error=${encodeURIComponent(totalBillableHoursValue.error)}`);
    }
    const revenueChargeItemsValue = parseRevenueChargeItemsInput(
      formData.get("revenue_charge_items_json")
    );
    if (revenueChargeItemsValue.error) {
      redirect(
        `/clients/${clientId}/billing?error=${encodeURIComponent(revenueChargeItemsValue.error)}`
      );
    }

    const payload = {
      client_id: clientId,
      currency,
      hourly_rate: hourlyRateValue.value,
      total_billable_hours: totalBillableHoursValue.value,
      revenue_charge_items: revenueChargeItemsValue.value,
      display_name: clientName,
    };
    const existingBillingProfileId = hasStringId(billingProfile) ? billingProfile.id : null;
    const { error } = existingBillingProfileId
      ? await supabase.from("billing_profiles").update(payload).eq("id", existingBillingProfileId)
      : await supabase.from("billing_profiles").insert(payload);

    if (error) {
      if (isSupabaseMissingColumnError(error)) {
        redirect(
          `/clients/${clientId}/billing?error=${encodeURIComponent(
            "Run sql/client_billing_revenue_fields.sql before saving revenue fields."
          )}`
        );
      }
      if (isSupabaseMissingTableError(error)) {
        redirect(
          `/clients/${clientId}/billing?error=${encodeURIComponent(
            "Billing table is missing. Set up billing_profiles first."
          )}`
        );
      }
      redirect(`/clients/${clientId}/billing?error=${encodeURIComponent(error.message)}`);
    }

    revalidatePath(`/clients/${clientId}/billing`);
    redirect(`/clients/${clientId}/billing?success=Revenue%20model%20saved`);
  }

  return (
    <div className="space-y-8">
      <section className="space-y-2">
        <h1 className="text-2xl font-semibold text-slate-900">
          {clientName} - Billing
        </h1>
        <ClientTabs clientId={clientId} active="billing" />
      </section>

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

      <section className="grid gap-4 lg:grid-cols-3">
        <div className="rounded-lg border border-slate-200 bg-white p-5">
          <div className="flex items-start justify-between gap-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Employee monthly costs
            </p>
            <EmployeeMonthlyCostBreakdownPopover
              currencyCode={employeeMonthlyCostSummary.currencyCode}
              rows={employeeMonthlyCostSummary.breakdownRows}
              totalAmount={employeeMonthlyCostSummary.amount}
              clientRowCount={employeeMonthlyCostSummary.clientRowCount}
              contributingRowCount={employeeMonthlyCostSummary.contributingRowCount}
              roleColumnLabel={employeeMonthlyCostSummary.roleColumnLabel}
            />
          </div>
          <p className="mt-2 text-3xl font-semibold text-slate-900">
            {formatEmployeeInfoCurrencyAmount(
              employeeMonthlyCostSummary.amount,
              employeeMonthlyCostSummary.currencyCode
            )}
          </p>
          <p className="mt-2 text-sm text-slate-600">
            From {employeeMonthlyCostSummary.contributingRowCount} populated entries across{" "}
            {employeeMonthlyCostSummary.clientRowCount} employee rows.
          </p>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Estimated monthly revenue
          </p>
          <p className="mt-2 text-3xl font-semibold text-slate-900">
            {formatEmployeeInfoCurrencyAmount(estimatedMonthlyRevenue, billingCurrencyCode)}
          </p>
          <p className="mt-2 text-sm text-slate-600">
            {formatEmployeeInfoCurrencyAmount(hourlyRate, billingCurrencyCode)} x{" "}
            {totalBillableHours.toFixed(2).replace(/\.?0+$/, "")}h +{" "}
            {formatEmployeeInfoCurrencyAmount(additionalMonthlyRevenue, billingCurrencyCode)}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            {revenueChargeItems.length} custom charge
            {revenueChargeItems.length === 1 ? "" : "s"}; per-user charges use{" "}
            {employeeMonthlyCostSummary.clientRowCount} assigned employees.
          </p>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Estimated gross margin
          </p>
          <p
            className={`mt-2 text-3xl font-semibold ${
              estimatedMonthlyMargin < 0 ? "text-red-700" : "text-slate-900"
            }`}
          >
            {formatEmployeeInfoCurrencyAmount(estimatedMonthlyMargin, billingCurrencyCode)}
          </p>
          <p className="mt-2 text-sm text-slate-600">{formatPercent(estimatedMonthlyMarginPercent)}</p>
        </div>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-6">
        <h2 className="text-lg font-semibold text-slate-900">Revenue model</h2>
        <p className="mt-1 text-sm text-slate-600">
          Store the billing assumptions used to estimate monthly revenue for this client.
        </p>

        {billingProfileErrorMessage ? (
          <p className="mt-4 rounded-md border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900">
            {billingProfileErrorMessage}
          </p>
        ) : null}
        {billingRevenueColumnsMissing ? (
          <p className="mt-4 rounded-md border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900">
            Run <code>sql/client_billing_revenue_fields.sql</code> to enable revenue fields.
          </p>
        ) : null}
        {employeeMonthlyCostSummary.errorMessage ? (
          <p className="mt-4 rounded-md border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900">
            {employeeMonthlyCostSummary.errorMessage}
          </p>
        ) : null}
        {employeeMonthlyCostSummary.hasMissingExchangeRate ? (
          <p className="mt-4 rounded-md border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900">
            Some employee rows were skipped due to missing FX rates (<code>#FX!</code>).
          </p>
        ) : null}
        {billingPermissionErrorMessage ? (
          <p className="mt-4 rounded-md border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900">
            {billingPermissionErrorMessage}
          </p>
        ) : null}
        {!canEditBilling ? (
          <p className="mt-4 rounded-md border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900">
            You can view this billing page, but only users with billing edit permission can save
            changes.
          </p>
        ) : null}

        <form action={saveRevenueModel} className="mt-6 space-y-4">
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-700" htmlFor="currency">
                Currency
              </label>
              <select
                id="currency"
                name="currency"
                defaultValue={billingCurrencyCode}
                disabled={!canEditBilling}
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              >
                {EMPLOYEE_INFO_CURRENCY_CODES.map((code) => (
                  <option key={code} value={code}>
                    {code}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-700" htmlFor="hourly_rate">
                Hourly rate
              </label>
              <input
                id="hourly_rate"
                name="hourly_rate"
                type="number"
                step="0.01"
                min="0"
                defaultValue={toFiniteNumber(billingProfile?.hourly_rate) ?? ""}
                disabled={!canEditBilling}
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                placeholder="0.00"
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-700" htmlFor="total_billable_hours">
                Total billable hours
              </label>
              <input
                id="total_billable_hours"
                name="total_billable_hours"
                type="number"
                step="0.01"
                min="0"
                defaultValue={toFiniteNumber(billingProfile?.total_billable_hours) ?? ""}
                disabled={!canEditBilling}
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                placeholder="0"
              />
            </div>
          </div>

          <RevenueChargesEditor
            name="revenue_charge_items_json"
            initialItems={revenueChargeItems}
            currencyCode={billingCurrencyCode}
            employeeCount={employeeMonthlyCostSummary.clientRowCount}
            disabled={!canEditBilling}
          />

          <div>
            <button
              type="submit"
              disabled={!canEditBilling}
              className="rounded-md btn-primary px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
            >
              Save revenue model
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

