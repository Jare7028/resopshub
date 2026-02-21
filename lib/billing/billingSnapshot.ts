import {
  buildEmployeeInfoExchangeRateMap,
  columnIndexToLetter,
  convertEmployeeInfoCurrencyAmount,
  evaluateEmployeeFormula,
  normalizeEmployeeInfoCurrencyCode,
  normalizeEmployeeInfoFormulaCurrencyMode,
  parseEmployeeInfoCurrencyCodeFromOptions,
  parseEmployeeInfoDateToSerial,
  toEmployeeInfoColumnKey,
  toFormulaNumber,
  type EmployeeInfoCurrencyCode,
  type EmployeeInfoExchangeRateRow,
} from "../employeeInfo";

export type EmployeeInfoRecordRow = {
  id: string;
  full_name: string;
  client_id: string | null;
};

export type EmployeeInfoColumnRow = {
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

export type EmployeeInfoValueRow = {
  record_id: string;
  column_id: string;
  text_value: string | null;
  option_value: string | null;
  money_currency_code: string | null;
};

export type BillingProfileRevenueRow = {
  id?: string;
  currency: string | null;
  hourly_rate: number | string | null;
  total_billable_hours: number | string | null;
  revenue_charge_items: unknown;
  monthly_cost_items: unknown;
};

export type BillingRevenueChargeMode = "per_user" | "monthly";

export type BillingRevenueChargeItem = {
  id: string;
  label: string;
  amount: number;
  mode: BillingRevenueChargeMode;
};

export type BillingMonthlyCostSourceKind = "employee_column" | "custom";
export type BillingMonthlyCostCustomMode = "per_user" | "monthly";

export type BillingMonthlyCostItem = {
  id: string;
  source: BillingMonthlyCostSourceKind;
  column_id: string | null;
  label: string;
  amount: number;
  mode: BillingMonthlyCostCustomMode;
};

export type BillingMonthlyCostCustomBreakdownRow = {
  id: string;
  label: string;
  mode: BillingMonthlyCostCustomMode;
  amount: number;
  quantity: number;
  totalAmount: number;
};

export type EmployeeMonthlyCostBreakdownRow = {
  roleLabel: string;
  employeeCount: number;
  contributingRowCount: number;
  totalAmount: number;
};

export type EmployeeMonthlyCostSummary = {
  amount: number;
  currencyCode: EmployeeInfoCurrencyCode;
  clientRowCount: number;
  contributingRowCount: number;
  roleColumnLabel: string | null;
  breakdownRows: EmployeeMonthlyCostBreakdownRow[];
  customBreakdownRows: BillingMonthlyCostCustomBreakdownRow[];
  isConfigured: boolean;
  hasMissingExchangeRate: boolean;
};

export type RevenueBreakdownRow = {
  id: string;
  label: string;
  mode: BillingRevenueChargeMode;
  amount: number;
  quantity: number;
  totalAmount: number;
};

export type ClientBillingComputedSnapshot = {
  billingCurrencyCode: EmployeeInfoCurrencyCode;
  employeeMonthlyCostSummary: EmployeeMonthlyCostSummary;
  employeeColumnsForBilling: EmployeeInfoColumnRow[];
  monthlyCostItems: BillingMonthlyCostItem[];
  hourlyRate: number;
  totalBillableHours: number;
  revenueChargeItems: BillingRevenueChargeItem[];
  baseMonthlyRevenue: number;
  revenueBreakdownRows: RevenueBreakdownRow[];
  additionalMonthlyRevenue: number;
  estimatedMonthlyRevenue: number;
  estimatedMonthlyMargin: number;
  estimatedMonthlyMarginPercent: number | null;
};

function toMonthStart(value?: string | Date | null) {
  if (value instanceof Date) {
    return `${value.toISOString().slice(0, 7)}-01`;
  }
  const raw = String(value || "").trim();
  if (!raw) {
    return `${new Date().toISOString().slice(0, 7)}-01`;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return `${raw.slice(0, 7)}-01`;
  }
  return `${new Date().toISOString().slice(0, 7)}-01`;
}

export function hasStringId(value: unknown): value is { id: string } {
  return (
    !!value &&
    typeof value === "object" &&
    typeof (value as { id?: unknown }).id === "string" &&
    String((value as { id: string }).id).trim().length > 0
  );
}

function normalizeFilterToken(value: string | null | undefined) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function isReasonForLeavingColumn(column: Pick<EmployeeInfoColumnRow, "key" | "label">) {
  const keyToken = normalizeFilterToken(column.key);
  const labelToken = normalizeFilterToken(column.label);
  const isReasonForLeavingToken = (token: string) =>
    token === "reason_for_leaving" || (token.includes("reason") && token.includes("leaving"));
  return isReasonForLeavingToken(keyToken) || isReasonForLeavingToken(labelToken);
}

function hasNonEmptyCellValue(value: Pick<EmployeeInfoValueRow, "text_value" | "option_value">) {
  return (
    String(value.text_value || "").trim().length > 0 ||
    String(value.option_value || "").trim().length > 0
  );
}

export function excludeInactiveEmployeeRecordsForBilling(args: {
  employeeRecords: EmployeeInfoRecordRow[];
  employeeColumns: EmployeeInfoColumnRow[];
  employeeValues: EmployeeInfoValueRow[];
}) {
  const { employeeRecords, employeeColumns, employeeValues } = args;
  const reasonForLeavingColumnIds = new Set(
    employeeColumns.filter((column) => isReasonForLeavingColumn(column)).map((column) => column.id)
  );
  if (!reasonForLeavingColumnIds.size || !employeeRecords.length || !employeeValues.length) {
    return {
      employeeRecords,
      employeeValues,
    };
  }

  const inactiveRecordIds = new Set<string>();
  employeeValues.forEach((valueRow) => {
    if (!reasonForLeavingColumnIds.has(valueRow.column_id)) {
      return;
    }
    if (!hasNonEmptyCellValue(valueRow)) {
      return;
    }
    inactiveRecordIds.add(valueRow.record_id);
  });

  if (!inactiveRecordIds.size) {
    return {
      employeeRecords,
      employeeValues,
    };
  }

  const activeEmployeeRecords = employeeRecords.filter((record) => !inactiveRecordIds.has(record.id));
  const activeRecordIds = new Set(activeEmployeeRecords.map((record) => record.id));
  return {
    employeeRecords: activeEmployeeRecords,
    employeeValues: employeeValues.filter((valueRow) => activeRecordIds.has(valueRow.record_id)),
  };
}

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

export function isSupportedMonthlyCostSourceColumn(column: EmployeeInfoColumnRow) {
  return (
    column.column_kind === "formula" ||
    column.column_kind === "currency" ||
    column.column_kind === "number" ||
    column.column_kind === "text" ||
    column.column_kind === "dropdown"
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

export function getRoleBreakdownColumnScore(column: EmployeeInfoColumnRow) {
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

export function toFiniteNumber(value: unknown) {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function normalizeBillingRevenueChargeMode(value: unknown): BillingRevenueChargeMode {
  return String(value || "").trim().toLowerCase() === "per_user" ? "per_user" : "monthly";
}

function normalizeBillingMonthlyCostSource(value: unknown): BillingMonthlyCostSourceKind {
  return String(value || "").trim().toLowerCase() === "custom" ? "custom" : "employee_column";
}

function normalizeBillingMonthlyCostMode(value: unknown): BillingMonthlyCostCustomMode {
  return String(value || "").trim().toLowerCase() === "per_user" ? "per_user" : "monthly";
}

export function parseBillingRevenueChargeItems(value: unknown): BillingRevenueChargeItem[] {
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

export function parseBillingMonthlyCostItems(value: unknown): BillingMonthlyCostItem[] {
  if (!Array.isArray(value)) return [];

  const normalized: BillingMonthlyCostItem[] = [];
  value.forEach((entry, index) => {
    if (!entry || typeof entry !== "object") return;

    const row = entry as {
      id?: unknown;
      source?: unknown;
      column_id?: unknown;
      label?: unknown;
      amount?: unknown;
      mode?: unknown;
    };

    const idRaw = String(row.id || "").trim();
    const source = normalizeBillingMonthlyCostSource(row.source);

    if (source === "employee_column") {
      const columnId = String(row.column_id || "").trim();
      if (!columnId) return;

      normalized.push({
        id: idRaw || `cost_source_${index + 1}`,
        source,
        column_id: columnId,
        label: String(row.label || "").trim(),
        amount: 0,
        mode: "monthly",
      });
      return;
    }

    const label = String(row.label || "").trim();
    const amountRaw = String(row.amount ?? "")
      .trim()
      .replace(/,/g, "");
    const amount = Number(amountRaw);
    if (!label || !Number.isFinite(amount) || amount < 0) return;

    normalized.push({
      id: idRaw || `cost_source_${index + 1}`,
      source: "custom",
      column_id: null,
      label,
      amount,
      mode: normalizeBillingMonthlyCostMode(row.mode),
    });
  });

  return normalized;
}

export function computeClientBillingSnapshot(args: {
  clientId: string;
  clientName: string;
  billingProfile: BillingProfileRevenueRow | null;
  employeeRecords: EmployeeInfoRecordRow[];
  employeeColumns: EmployeeInfoColumnRow[];
  employeeValues: EmployeeInfoValueRow[];
  exchangeRateRows: EmployeeInfoExchangeRateRow[];
  monthStart?: string | Date | null;
}): ClientBillingComputedSnapshot {
  const {
    clientId,
    clientName,
    billingProfile,
    employeeRecords,
    employeeColumns,
    employeeValues,
    exchangeRateRows,
    monthStart,
  } = args;
  const billingCurrencyCode = normalizeEmployeeInfoCurrencyCode(billingProfile?.currency || "USD");

  let monthlyCostItems = parseBillingMonthlyCostItems(billingProfile?.monthly_cost_items);
  const filteredEmployeeColumns = employeeColumns.filter((row) => hasStringId(row));
  const filteredEmployeeRecords = employeeRecords.filter((row) => hasStringId(row));
  const filteredEmployeeValues = employeeValues.filter(
    (row) => !!row && !!row.record_id && !!row.column_id
  );
  const activeEmployeeRows = excludeInactiveEmployeeRecordsForBilling({
    employeeRecords: filteredEmployeeRecords,
    employeeColumns: filteredEmployeeColumns,
    employeeValues: filteredEmployeeValues,
  });
  const activeEmployeeRecords = activeEmployeeRows.employeeRecords;
  const activeEmployeeValues = activeEmployeeRows.employeeValues;

  const employeeMonthlyCostSummary: EmployeeMonthlyCostSummary = {
    amount: 0,
    currencyCode: billingCurrencyCode,
    clientRowCount: activeEmployeeRecords.length,
    contributingRowCount: 0,
    roleColumnLabel: null,
    breakdownRows: [],
    customBreakdownRows: [],
    isConfigured: false,
    hasMissingExchangeRate: false,
  };

  const legacyMonthlyCostColumn = filteredEmployeeColumns.find(isTotalMonthlyCostColumn);
  if (
    !monthlyCostItems.length &&
    legacyMonthlyCostColumn &&
    isSupportedMonthlyCostSourceColumn(legacyMonthlyCostColumn)
  ) {
    monthlyCostItems = [
      {
        id: "legacy_total_monthly_cost",
        source: "employee_column",
        column_id: legacyMonthlyCostColumn.id,
        label: legacyMonthlyCostColumn.label,
        amount: 0,
        mode: "monthly",
      },
    ];
  }

  const employeeColumnById = new Map(filteredEmployeeColumns.map((column) => [column.id, column]));
  const employeeSourceItems = monthlyCostItems
    .filter((item) => item.source === "employee_column" && !!item.column_id)
    .map((item) => ({
      item,
      column: item.column_id ? employeeColumnById.get(item.column_id) || null : null,
    }))
    .filter(
      (
        entry
      ): entry is {
        item: BillingMonthlyCostItem;
        column: EmployeeInfoColumnRow;
      } => !!entry.column && isSupportedMonthlyCostSourceColumn(entry.column)
    );
  const customCostItems = monthlyCostItems.filter((item) => item.source === "custom");

  employeeMonthlyCostSummary.customBreakdownRows = customCostItems.map((item, index) => {
    const safeAmount = Number.isFinite(item.amount) && item.amount >= 0 ? item.amount : 0;
    const quantity = item.mode === "per_user" ? employeeMonthlyCostSummary.clientRowCount : 1;
    const safeQuantity = Number.isFinite(quantity) && quantity > 0 ? quantity : 0;
    return {
      id: item.id || `custom_cost_${index + 1}`,
      label: item.label || `Custom cost ${index + 1}`,
      mode: item.mode,
      amount: safeAmount,
      quantity: item.mode === "per_user" ? safeQuantity : 1,
      totalAmount: safeAmount * (item.mode === "per_user" ? safeQuantity : 1),
    };
  });
  employeeMonthlyCostSummary.customBreakdownRows.forEach((row) => {
    employeeMonthlyCostSummary.amount += row.totalAmount;
    employeeMonthlyCostSummary.contributingRowCount += row.mode === "per_user" ? row.quantity : 1;
  });
  employeeMonthlyCostSummary.isConfigured =
    employeeSourceItems.length > 0 || customCostItems.length > 0;

  const roleBreakdownColumn =
    filteredEmployeeColumns
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

  const roleBreakdownMap = new Map<
    string,
    {
      roleLabel: string;
      employeeCount: number;
      contributingRowCount: number;
      totalAmount: number;
    }
  >();
  const valuesByRecordId = buildEmployeeInfoValueMap(activeEmployeeValues);

  const effectiveMonthStart = toMonthStart(monthStart);
  const exchangeRateMap = buildEmployeeInfoExchangeRateMap(exchangeRateRows, effectiveMonthStart);

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
  filteredEmployeeColumns.forEach((column, index) => {
    const displayIndex = index + 2;
    registerReference(column.key, displayIndex);
    registerReference(toEmployeeInfoColumnKey(column.label), displayIndex);
    registerReference(columnIndexToLetter(displayIndex), displayIndex);
  });

  const resolveFormulaTargetCurrencyCode = (column: EmployeeInfoColumnRow) => {
    const formulaMode = normalizeEmployeeInfoFormulaCurrencyMode(column.formula_currency_mode);
    if (formulaMode === "fixed") {
      return normalizeEmployeeInfoCurrencyCode(column.formula_currency_code);
    }
    return billingCurrencyCode;
  };

  const columnDisplayIndexById = new Map(
    filteredEmployeeColumns.map((column, index) => [column.id, index + 2])
  );

  activeEmployeeRecords.forEach((record) => {
    const valuesByColumnId = valuesByRecordId[record.id] || {};
    const roleSourceValue = roleBreakdownColumn ? valuesByColumnId[roleBreakdownColumn.id] : null;
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

    const resolveDisplayIndexValue = (
      displayIndex: number,
      visiting: Set<number>,
      targetCurrencyCode: EmployeeInfoCurrencyCode,
      onMissingExchangeRate: () => void,
      onCurrencyOperand: () => void
    ): unknown => {
      if (displayIndex === 0) return record.full_name;
      if (displayIndex === 1) return record.client_id === clientId ? clientName : "";

      const dynamicIndex = displayIndex - 2;
      if (dynamicIndex < 0 || dynamicIndex >= filteredEmployeeColumns.length) return "";
      const dynamicColumn = filteredEmployeeColumns[dynamicIndex];

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
      if (!cellValue) {
        return dynamicColumn.column_kind === "date" ? 0 : "";
      }
      if (dynamicColumn.column_kind === "dropdown") return cellValue.option_value || "";

      if (dynamicColumn.column_kind === "currency") {
        onCurrencyOperand();
        const sourceAmount = parseNumericCellValue(cellValue.text_value);
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

      if (dynamicColumn.column_kind === "date") {
        return parseEmployeeInfoDateToSerial(cellValue.text_value) ?? 0;
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

    const resolveEmployeeColumnAmount = (targetColumn: EmployeeInfoColumnRow) => {
      let amountToAdd: number | null = null;

      if (targetColumn.column_kind === "formula") {
        const formulaTargetCurrencyCode = resolveFormulaTargetCurrencyCode(targetColumn);
        const targetDisplayIndex = columnDisplayIndexById.get(targetColumn.id) || 2;
        let hasMissingExchangeRate = false;
        let hasCurrencyOperand = false;
        const evaluated = evaluateEmployeeFormula(
          targetColumn.formula,
          (refIndex) =>
            resolveDisplayIndexValue(
              refIndex,
              new Set([targetDisplayIndex]),
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
              new Set([targetDisplayIndex]),
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
          return null;
        }

        const numericEvaluated = toFormulaNumber(evaluated);
        if (!Number.isFinite(numericEvaluated)) return null;
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
            return null;
          }
          amountToAdd = convertedAmount;
        }
      } else if (targetColumn.column_kind === "currency") {
        const value = valuesByColumnId[targetColumn.id];
        if (!value?.text_value) return null;
        const sourceAmount = parseNumericCellValue(value.text_value);
        if (!Number.isFinite(sourceAmount)) return null;
        const sourceCurrencyCode = normalizeEmployeeInfoCurrencyCode(
          value.money_currency_code || parseEmployeeInfoCurrencyCodeFromOptions(targetColumn.options_json)
        );
        const convertedAmount = convertEmployeeInfoCurrencyAmount({
          amount: sourceAmount,
          fromCurrencyCode: sourceCurrencyCode,
          toCurrencyCode: billingCurrencyCode,
          exchangeRateMap,
        });
        if (convertedAmount === null) {
          employeeMonthlyCostSummary.hasMissingExchangeRate = true;
          return null;
        }
        amountToAdd = convertedAmount;
      } else if (targetColumn.column_kind === "dropdown") {
        amountToAdd = parseNumericCellValue(valuesByColumnId[targetColumn.id]?.option_value);
      } else {
        amountToAdd = parseNumericCellValue(valuesByColumnId[targetColumn.id]?.text_value);
      }

      if (amountToAdd === null || !Number.isFinite(amountToAdd)) return null;
      return amountToAdd;
    };

    employeeSourceItems.forEach(({ column }) => {
      const amountToAdd = resolveEmployeeColumnAmount(column);
      if (amountToAdd === null || !Number.isFinite(amountToAdd)) return;
      employeeMonthlyCostSummary.amount += amountToAdd;
      employeeMonthlyCostSummary.contributingRowCount += 1;
      roleEntry.contributingRowCount += 1;
      roleEntry.totalAmount += amountToAdd;
    });

    roleBreakdownMap.set(roleLabel, roleEntry);
  });

  employeeMonthlyCostSummary.customBreakdownRows.forEach((customRow) => {
    if (customRow.mode !== "per_user") return;
    roleBreakdownMap.forEach((roleEntry, roleLabel) => {
      if (!roleEntry.employeeCount) return;
      roleEntry.contributingRowCount += roleEntry.employeeCount;
      roleEntry.totalAmount += customRow.amount * roleEntry.employeeCount;
      roleBreakdownMap.set(roleLabel, roleEntry);
    });
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

  const hourlyRate = toFiniteNumber(billingProfile?.hourly_rate) ?? 0;
  const totalBillableHours = toFiniteNumber(billingProfile?.total_billable_hours) ?? 0;
  const revenueChargeItems = parseBillingRevenueChargeItems(billingProfile?.revenue_charge_items);
  const baseMonthlyRevenue = hourlyRate * totalBillableHours;
  const revenueBreakdownRows = revenueChargeItems.map((charge) => {
    const quantity = charge.mode === "per_user" ? employeeMonthlyCostSummary.clientRowCount : 1;
    return {
      id: charge.id,
      label: charge.label,
      mode: charge.mode,
      amount: charge.amount,
      quantity,
      totalAmount: charge.amount * quantity,
    };
  });
  const additionalMonthlyRevenue = revenueBreakdownRows.reduce((sum, row) => sum + row.totalAmount, 0);
  const estimatedMonthlyRevenue = baseMonthlyRevenue + additionalMonthlyRevenue;
  const estimatedMonthlyMargin = estimatedMonthlyRevenue - employeeMonthlyCostSummary.amount;
  const estimatedMonthlyMarginPercent =
    estimatedMonthlyRevenue > 0 ? (estimatedMonthlyMargin / estimatedMonthlyRevenue) * 100 : null;

  return {
    billingCurrencyCode,
    employeeMonthlyCostSummary,
    employeeColumnsForBilling: filteredEmployeeColumns,
    monthlyCostItems,
    hourlyRate,
    totalBillableHours,
    revenueChargeItems,
    baseMonthlyRevenue,
    revenueBreakdownRows,
    additionalMonthlyRevenue,
    estimatedMonthlyRevenue,
    estimatedMonthlyMargin,
    estimatedMonthlyMarginPercent,
  };
}

export function convertSnapshotAmountsToCurrency(args: {
  snapshot: ClientBillingComputedSnapshot;
  targetCurrencyCode: EmployeeInfoCurrencyCode;
  exchangeRateRows: EmployeeInfoExchangeRateRow[];
  monthStart?: string | Date | null;
}) {
  const { snapshot, targetCurrencyCode, exchangeRateRows, monthStart } = args;
  const normalizedTarget = normalizeEmployeeInfoCurrencyCode(targetCurrencyCode);
  const month = toMonthStart(monthStart);
  const exchangeRateMap = buildEmployeeInfoExchangeRateMap(exchangeRateRows, month);

  const convertValue = (value: number) =>
    convertEmployeeInfoCurrencyAmount({
      amount: value,
      fromCurrencyCode: snapshot.billingCurrencyCode,
      toCurrencyCode: normalizedTarget,
      exchangeRateMap,
    });

  if (snapshot.billingCurrencyCode === normalizedTarget) {
    return {
      currencyCode: normalizedTarget,
      estimatedMonthlyRevenue: snapshot.estimatedMonthlyRevenue,
      employeeMonthlyCosts: snapshot.employeeMonthlyCostSummary.amount,
      estimatedMonthlyMargin: snapshot.estimatedMonthlyMargin,
      missingExchangeRate: false,
    };
  }

  const convertedRevenue = convertValue(snapshot.estimatedMonthlyRevenue);
  const convertedCosts = convertValue(snapshot.employeeMonthlyCostSummary.amount);
  const convertedMargin = convertValue(snapshot.estimatedMonthlyMargin);

  if (
    convertedRevenue === null ||
    convertedCosts === null ||
    convertedMargin === null
  ) {
    return {
      currencyCode: normalizedTarget,
      estimatedMonthlyRevenue: 0,
      employeeMonthlyCosts: 0,
      estimatedMonthlyMargin: 0,
      missingExchangeRate: true,
    };
  }

  return {
    currencyCode: normalizedTarget,
    estimatedMonthlyRevenue: convertedRevenue,
    employeeMonthlyCosts: convertedCosts,
    estimatedMonthlyMargin: convertedMargin,
    missingExchangeRate: false,
  };
}
