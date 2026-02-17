import FormulaParser from "fast-formula-parser";

export const EMPLOYEE_INFO_COLUMN_KINDS = [
  "text",
  "dropdown",
  "formula",
  "number",
  "date",
  "currency",
] as const;
export type EmployeeInfoColumnKind = (typeof EMPLOYEE_INFO_COLUMN_KINDS)[number];

export const EMPLOYEE_INFO_CURRENCY_CODES = ["USD", "GBP", "MUR"] as const;
export type EmployeeInfoCurrencyCode = (typeof EMPLOYEE_INFO_CURRENCY_CODES)[number];

export const EMPLOYEE_INFO_DISPLAY_CURRENCY_CODES = [
  "ORIGINAL",
  ...EMPLOYEE_INFO_CURRENCY_CODES,
] as const;
export type EmployeeInfoDisplayCurrencyCode =
  (typeof EMPLOYEE_INFO_DISPLAY_CURRENCY_CODES)[number];

export const EMPLOYEE_INFO_FORMULA_CURRENCY_MODES = ["display", "fixed"] as const;
export type EmployeeInfoFormulaCurrencyMode =
  (typeof EMPLOYEE_INFO_FORMULA_CURRENCY_MODES)[number];

const EMPLOYEE_INFO_CURRENCY_SYMBOL_BY_CODE: Record<EmployeeInfoCurrencyCode, string> = {
  USD: "$",
  GBP: "\u00A3",
  MUR: "Rs",
};

export type EmployeeInfoExchangeRateRow = {
  base_currency_code: string;
  quote_currency_code: string;
  rate: string | number;
  effective_month_start: string;
};

export type EmployeeInfoExchangeRateMapEntry = {
  rate: number;
  effectiveMonthStart: string;
};

export type EmployeeInfoExchangeRateMap = Record<string, EmployeeInfoExchangeRateMapEntry>;

function buildExchangeRateKey(baseCurrencyCode: string, quoteCurrencyCode: string) {
  const baseCode = normalizeEmployeeInfoCurrencyCode(baseCurrencyCode);
  const quoteCode = normalizeEmployeeInfoCurrencyCode(quoteCurrencyCode);
  return `${baseCode}->${quoteCode}`;
}

function toMonthStartString(value: Date | string | null | undefined) {
  const raw = value instanceof Date ? value.toISOString().slice(0, 10) : String(value || "").trim();
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return "";
  return `${match[1]}-${match[2]}-01`;
}

export function isEmployeeInfoColumnKind(value: string): value is EmployeeInfoColumnKind {
  return (EMPLOYEE_INFO_COLUMN_KINDS as readonly string[]).includes(value);
}

export function normalizeEmployeeInfoColumnKind(value: string): EmployeeInfoColumnKind {
  return isEmployeeInfoColumnKind(value) ? value : "text";
}

export function isEmployeeInfoCurrencyCode(value: string): value is EmployeeInfoCurrencyCode {
  return (EMPLOYEE_INFO_CURRENCY_CODES as readonly string[]).includes(value);
}

export function normalizeEmployeeInfoCurrencyCode(
  value: string | null | undefined
): EmployeeInfoCurrencyCode {
  const normalized = String(value || "")
    .trim()
    .toUpperCase();
  return isEmployeeInfoCurrencyCode(normalized) ? normalized : "USD";
}

export function isEmployeeInfoDisplayCurrencyCode(
  value: string
): value is EmployeeInfoDisplayCurrencyCode {
  return (EMPLOYEE_INFO_DISPLAY_CURRENCY_CODES as readonly string[]).includes(value);
}

export function normalizeEmployeeInfoDisplayCurrencyCode(
  value: string | null | undefined
): EmployeeInfoDisplayCurrencyCode {
  const normalized = String(value || "")
    .trim()
    .toUpperCase();
  return isEmployeeInfoDisplayCurrencyCode(normalized) ? normalized : "ORIGINAL";
}

export function isEmployeeInfoFormulaCurrencyMode(
  value: string
): value is EmployeeInfoFormulaCurrencyMode {
  return (EMPLOYEE_INFO_FORMULA_CURRENCY_MODES as readonly string[]).includes(value);
}

export function normalizeEmployeeInfoFormulaCurrencyMode(
  value: string | null | undefined
): EmployeeInfoFormulaCurrencyMode {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  return isEmployeeInfoFormulaCurrencyMode(normalized) ? normalized : "display";
}

export function parseEmployeeInfoCurrencyCodeFromOptions(options: unknown): EmployeeInfoCurrencyCode {
  if (Array.isArray(options) && options.length) {
    return normalizeEmployeeInfoCurrencyCode(String(options[0] || ""));
  }
  if (options && typeof options === "object") {
    const candidate = options as { currency_code?: unknown };
    return normalizeEmployeeInfoCurrencyCode(
      typeof candidate.currency_code === "string" ? candidate.currency_code : ""
    );
  }
  return "USD";
}

export function getEmployeeInfoCurrencySymbol(
  code: EmployeeInfoCurrencyCode | string | null | undefined
) {
  const normalizedCode = normalizeEmployeeInfoCurrencyCode(String(code || ""));
  return EMPLOYEE_INFO_CURRENCY_SYMBOL_BY_CODE[normalizedCode];
}

export function parseEmployeeInfoCurrencyInput(
  rawValue: string | null | undefined,
  fallbackCurrencyCode?: EmployeeInfoCurrencyCode | string | null
) {
  let normalized = String(rawValue || "").trim();
  const fallbackCode = normalizeEmployeeInfoCurrencyCode(String(fallbackCurrencyCode || ""));
  if (!normalized) {
    return { amountText: null as string | null, currencyCode: fallbackCode };
  }

  let detectedCurrencyCode: EmployeeInfoCurrencyCode | null = null;
  const prefixPatterns: Array<{ code: EmployeeInfoCurrencyCode; pattern: RegExp }> = [
    { code: "USD", pattern: /^\s*(?:USD|\$)\s*/i },
    { code: "GBP", pattern: /^\s*(?:GBP|\u00A3|\u00C2\u00A3)\s*/i },
    { code: "MUR", pattern: /^\s*(?:MUR|RS\.?|RUPEES?)\s*/i },
  ];

  prefixPatterns.forEach((entry) => {
    if (detectedCurrencyCode) return;
    if (!entry.pattern.test(normalized)) return;
    detectedCurrencyCode = entry.code;
    normalized = normalized.replace(entry.pattern, "");
  });

  normalized = normalized.replace(/,/g, "").trim();
  if (!normalized) {
    return {
      amountText: null as string | null,
      currencyCode: detectedCurrencyCode || fallbackCode,
    };
  }

  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) {
    return {
      amountText: null as string | null,
      currencyCode: detectedCurrencyCode || fallbackCode,
    };
  }

  return {
    amountText: String(parsed),
    currencyCode: detectedCurrencyCode || fallbackCode,
  };
}

export function formatEmployeeInfoCurrencyAmount(
  amount: number | string | null | undefined,
  currencyCode: EmployeeInfoCurrencyCode | string | null | undefined
) {
  const numericAmount = Number(amount);
  if (!Number.isFinite(numericAmount)) return "";
  const normalizedCode = normalizeEmployeeInfoCurrencyCode(String(currencyCode || ""));
  const symbol = getEmployeeInfoCurrencySymbol(normalizedCode);
  const valueText = Number.isInteger(numericAmount)
    ? String(numericAmount)
    : numericAmount.toFixed(2).replace(/\.?0+$/, "");
  return normalizedCode === "MUR" ? `${symbol} ${valueText}` : `${symbol}${valueText}`;
}

export function buildEmployeeInfoExchangeRateMap(
  rows: EmployeeInfoExchangeRateRow[],
  asOfMonthStart: Date | string | null | undefined
) {
  const effectiveUpperBound = toMonthStartString(asOfMonthStart) || "9999-12-01";
  const map: EmployeeInfoExchangeRateMap = {};

  rows.forEach((row) => {
    const baseCurrencyCode = normalizeEmployeeInfoCurrencyCode(row.base_currency_code);
    const quoteCurrencyCode = normalizeEmployeeInfoCurrencyCode(row.quote_currency_code);
    if (baseCurrencyCode === quoteCurrencyCode) return;

    const rate = Number(row.rate);
    if (!Number.isFinite(rate) || rate <= 0) return;

    const effectiveMonthStart = toMonthStartString(row.effective_month_start);
    if (!effectiveMonthStart || effectiveMonthStart > effectiveUpperBound) return;

    const key = buildExchangeRateKey(baseCurrencyCode, quoteCurrencyCode);
    const existing = map[key];
    if (!existing || effectiveMonthStart > existing.effectiveMonthStart) {
      map[key] = { rate, effectiveMonthStart };
    }
  });

  return map;
}

export function resolveEmployeeInfoExchangeRate(
  exchangeRateMap: EmployeeInfoExchangeRateMap,
  fromCurrencyCode: EmployeeInfoCurrencyCode | string,
  toCurrencyCode: EmployeeInfoCurrencyCode | string
) {
  const fromCode = normalizeEmployeeInfoCurrencyCode(fromCurrencyCode);
  const toCode = normalizeEmployeeInfoCurrencyCode(toCurrencyCode);
  if (fromCode === toCode) return 1;

  const direct = exchangeRateMap[buildExchangeRateKey(fromCode, toCode)];
  if (direct && Number.isFinite(direct.rate) && direct.rate > 0) return direct.rate;

  const inverse = exchangeRateMap[buildExchangeRateKey(toCode, fromCode)];
  if (inverse && Number.isFinite(inverse.rate) && inverse.rate > 0) return 1 / inverse.rate;

  return null;
}

export function convertEmployeeInfoCurrencyAmount(args: {
  amount: number | string | null | undefined;
  fromCurrencyCode: EmployeeInfoCurrencyCode | string;
  toCurrencyCode: EmployeeInfoCurrencyCode | string;
  exchangeRateMap: EmployeeInfoExchangeRateMap;
}) {
  const { amount, fromCurrencyCode, toCurrencyCode, exchangeRateMap } = args;
  const numericAmount = Number(amount);
  if (!Number.isFinite(numericAmount)) return null;

  const exchangeRate = resolveEmployeeInfoExchangeRate(
    exchangeRateMap,
    fromCurrencyCode,
    toCurrencyCode
  );
  if (exchangeRate === null) return null;
  return numericAmount * exchangeRate;
}

export function toEmployeeInfoColumnKey(label: string) {
  const normalized = String(label || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return normalized || "column";
}

export function columnIndexToLetter(index: number) {
  if (!Number.isFinite(index) || index < 0) return "A";
  let value = Math.floor(index);
  let result = "";
  while (value >= 0) {
    result = String.fromCharCode(65 + (value % 26)) + result;
    value = Math.floor(value / 26) - 1;
  }
  return result;
}

export function columnLetterToIndex(letter: string) {
  const upper = String(letter || "").trim().toUpperCase();
  if (!/^[A-Z]+$/.test(upper)) return -1;
  let result = 0;
  for (let i = 0; i < upper.length; i += 1) {
    result = result * 26 + (upper.charCodeAt(i) - 64);
  }
  return result - 1;
}

export function toFormulaNumber(value: unknown) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "boolean") return value ? 1 : 0;
  const text = String(value ?? "").trim();
  if (!text) return 0;
  const numeric = Number(text.replace(/,/g, ""));
  return Number.isFinite(numeric) ? numeric : 0;
}

function stripLeadingReturnWord(value: string) {
  return String(value || "")
    .replace(/^return\s+/i, "")
    .trim()
    .replace(/,$/, "")
    .trim();
}

function toNaturalReference(value: string) {
  const cleaned = String(value || "")
    .replace(/\b(column|entry|value)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return "";
  return toEmployeeInfoColumnKey(cleaned);
}

function normalizeNaturalCondition(rawCondition: string) {
  let condition = String(rawCondition || "")
    .replace(/\bcolumn\s+entry\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();

  const comparison = condition.match(/^\s*([^<>=!]+?)\s*(==|=|!=|<>|<=|>=|<|>)([\s\S]+)$/);
  if (comparison) {
    const lhs = toNaturalReference(comparison[1]);
    const operator = comparison[2];
    const rhs = comparison[3].trim();
    if (lhs) {
      condition = `${lhs} ${operator} ${rhs}`;
    }
  }
  return condition;
}

function expandComparisonShorthand(expression: string) {
  const shorthandPattern =
    /([A-Za-z_][A-Za-z0-9_]*)\s*(==|=|!=|<>|<=|>=|<|>)\s*("[^"]*"|'[^']*'|[A-Za-z_][A-Za-z0-9_]*|-?\d+(?:\.\d+)?)((?:\s+(?:OR|AND)\s+(?:"[^"]*"|'[^']*'|[A-Za-z_][A-Za-z0-9_]*|-?\d+(?:\.\d+)?))+)/gi;

  return expression.replace(shorthandPattern, (_match, lhs, operator, firstRight, tail) => {
    const conditions = [`${lhs} ${operator} ${firstRight}`];
    const connectors: string[] = [];
    const tailPattern =
      /\s+(OR|AND)\s+("[^"]*"|'[^']*'|[A-Za-z_][A-Za-z0-9_]*|-?\d+(?:\.\d+)?)/gi;
    let segment: RegExpExecArray | null = tailPattern.exec(tail);
    while (segment) {
      connectors.push(segment[1].toUpperCase());
      conditions.push(`${lhs} ${operator} ${segment[2]}`);
      segment = tailPattern.exec(tail);
    }
    const firstConnector = connectors[0];
    const hasMixedConnectors = connectors.some((connector) => connector !== firstConnector);
    if (!firstConnector || hasMixedConnectors) {
      return _match;
    }
    return `${firstConnector}(${conditions.join(",")})`;
  });
}

function normalizeFormulaExpression(expression: string) {
  const input = String(expression || "").trim();
  const naturalIfMatch = input.match(/^if\s+(.+?)\s+then\s+(.+?)\s+else\s+(.+)$/i);
  const normalized = !naturalIfMatch
    ? expandComparisonShorthand(input)
    : (() => {
        const condition = normalizeNaturalCondition(naturalIfMatch[1] || "");
        const truthyValue = stripLeadingReturnWord(naturalIfMatch[2] || "");
        const falsyValue = stripLeadingReturnWord(naturalIfMatch[3] || "");
        return expandComparisonShorthand(`IF(${condition}, ${truthyValue}, ${falsyValue})`);
      })();
  return normalized.replace(/==/g, "=").replace(/!=/g, "<>");
}

function isFormulaErrorLike(value: unknown) {
  if (!value || typeof value !== "object") return false;
  const candidate = value as { _error?: unknown; name?: unknown };
  if (typeof candidate._error === "string" && candidate._error.startsWith("#")) return true;
  if (typeof candidate.name === "string" && candidate.name.startsWith("#")) return true;
  return false;
}

function toFormulaDisplayValue(value: unknown) {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : "";
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  if (Array.isArray(value)) return JSON.stringify(value);
  return String(value);
}

export function evaluateEmployeeFormula(
  formula: string | null | undefined,
  resolveColumnIndex: (index: number) => unknown,
  resolveNamedReference?: (reference: string) => unknown
) {
  const raw = String(formula || "").trim();
  if (!raw) return null;
  const expression = normalizeFormulaExpression(raw.startsWith("=") ? raw.slice(1) : raw);
  if (!expression.trim()) return null;

  const position = { row: 1, col: 1, sheet: "Sheet1" };
  const virtualColumnByReference = new Map<string, number>();
  const virtualColumnValueByColumnNumber = new Map<number, unknown>();
  let nextVirtualColumn = 12000;

  const getCellValue = (row: unknown, col: unknown): unknown => {
    const columnNumber = Number(col);
    if (!Number.isFinite(columnNumber) || columnNumber < 1) return "";
    const normalizedColumnNumber = Math.trunc(columnNumber);

    const variableValue = virtualColumnValueByColumnNumber.get(normalizedColumnNumber);
    if (variableValue !== undefined) return variableValue;

    const rowNumber = Number.isFinite(Number(row)) ? Math.trunc(Number(row)) : 1;
    if (rowNumber !== 1) return "";
    return resolveColumnIndex(normalizedColumnNumber - 1);
  };

  const parser = new FormulaParser({
    onCell: (reference) => getCellValue(reference.row, reference.col),
    onRange: (reference) => {
      const fromColumn = Math.max(
        1,
        Math.trunc(Number.isFinite(Number(reference.from.col)) ? Number(reference.from.col) : 1)
      );
      const toColumn = Math.max(
        fromColumn,
        Math.trunc(Number.isFinite(Number(reference.to.col)) ? Number(reference.to.col) : fromColumn)
      );

      const requestedFromRow = Number.isFinite(Number(reference.from.row))
        ? Math.trunc(Number(reference.from.row))
        : 1;
      const requestedToRow = Number.isFinite(Number(reference.to.row))
        ? Math.trunc(Number(reference.to.row))
        : 1;
      const fromRow = Math.max(1, Math.min(requestedFromRow, requestedToRow));
      const toRow = Math.max(1, Math.max(requestedFromRow, requestedToRow));
      const effectiveStartRow = Math.max(fromRow, 1);
      const effectiveEndRow = Math.min(toRow, 1);

      const rows: unknown[][] = [];
      if (effectiveStartRow > effectiveEndRow) {
        rows.push(new Array(toColumn - fromColumn + 1).fill(""));
        return rows;
      }

      for (let row = effectiveStartRow; row <= effectiveEndRow; row += 1) {
        const rowValues: unknown[] = [];
        for (let col = fromColumn; col <= toColumn; col += 1) {
          rowValues.push(getCellValue(row, col));
        }
        rows.push(rowValues);
      }
      return rows;
    },
    onVariable: (name) => {
      const cleaned = String(name || "").trim();
      if (!cleaned) return undefined;

      const normalized = cleaned.toLowerCase();
      const existingVirtualColumn = virtualColumnByReference.get(normalized);
      if (existingVirtualColumn !== undefined) {
        return { sheet: "Sheet1", row: 1, col: existingVirtualColumn };
      }

      if (/^[A-Za-z]{1,3}$/.test(cleaned)) {
        const index = columnLetterToIndex(cleaned);
        if (index >= 0) {
          return { sheet: "Sheet1", row: 1, col: index + 1 };
        }
      }

      if (typeof resolveNamedReference !== "function") return undefined;

      const referencedValue = resolveNamedReference(cleaned);
      if (referencedValue === undefined) return undefined;

      if (nextVirtualColumn > 16384) return undefined;
      const virtualColumn = nextVirtualColumn;
      nextVirtualColumn += 1;
      virtualColumnByReference.set(normalized, virtualColumn);
      virtualColumnValueByColumnNumber.set(virtualColumn, referencedValue);
      return { sheet: "Sheet1", row: 1, col: virtualColumn };
    },
  });

  try {
    const result = parser.parse(expression, position);
    if (isFormulaErrorLike(result)) return null;
    return result ?? null;
  } catch {
    return null;
  }
}

export function formatFormulaResult(value: unknown) {
  const normalized = toFormulaDisplayValue(value);
  if (normalized === "") return "";
  if (typeof normalized !== "number") return normalized;
  if (Number.isInteger(normalized)) return String(normalized);
  return normalized.toFixed(2).replace(/\.?0+$/, "");
}
