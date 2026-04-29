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
const EMPLOYEE_INFO_EXCEL_EPOCH_UTC_MS = Date.UTC(1899, 11, 30);
const EMPLOYEE_INFO_DAY_MS = 24 * 60 * 60 * 1000;

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

export function parseEmployeeInfoDateToSerial(value: string | null | undefined) {
  const text = String(value || "").trim();
  if (!text) return null;

  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})(?:$|T|\s)/);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;

  const utcMs = Date.UTC(year, month - 1, day);
  const date = new Date(utcMs);
  const isValidDate =
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day;
  if (!isValidDate) return null;

  return (utcMs - EMPLOYEE_INFO_EXCEL_EPOCH_UTC_MS) / EMPLOYEE_INFO_DAY_MS;
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
  const resolveDirectOrInverse = (fromCode: EmployeeInfoCurrencyCode, toCode: EmployeeInfoCurrencyCode) => {
    const direct = exchangeRateMap[buildExchangeRateKey(fromCode, toCode)];
    if (direct && Number.isFinite(direct.rate) && direct.rate > 0) return direct.rate;

    const inverse = exchangeRateMap[buildExchangeRateKey(toCode, fromCode)];
    if (inverse && Number.isFinite(inverse.rate) && inverse.rate > 0) return 1 / inverse.rate;

    return null;
  };

  const fromCode = normalizeEmployeeInfoCurrencyCode(fromCurrencyCode);
  const toCode = normalizeEmployeeInfoCurrencyCode(toCurrencyCode);
  if (fromCode === toCode) return 1;

  const directOrInverse = resolveDirectOrInverse(fromCode, toCode);
  if (directOrInverse !== null) return directOrInverse;

  // Allow two-hop conversion through any supported currency (e.g. MUR -> USD -> GBP).
  for (const pivotCode of EMPLOYEE_INFO_CURRENCY_CODES) {
    if (pivotCode === fromCode || pivotCode === toCode) continue;
    const firstHop = resolveDirectOrInverse(fromCode, pivotCode);
    if (firstHop === null) continue;
    const secondHop = resolveDirectOrInverse(pivotCode, toCode);
    if (secondHop === null) continue;
    return firstHop * secondHop;
  }

  return null;
}

export function convertEmployeeInfoCurrencyAmount(args: {
  amount: number | string | null | undefined;
  fromCurrencyCode: EmployeeInfoCurrencyCode | string;
  toCurrencyCode: EmployeeInfoCurrencyCode | string;
  exchangeRateMap: EmployeeInfoExchangeRateMap;
}) {
  const { amount, fromCurrencyCode, toCurrencyCode, exchangeRateMap } = args;
  const normalizeNumericAmount = (value: number | string | null | undefined) => {
    if (typeof value === "number") {
      return Number.isFinite(value) ? value : null;
    }

    const raw = String(value ?? "").trim();
    if (!raw) return null;

    const hasParens = raw.startsWith("(") && raw.endsWith(")");
    const stripped = raw
      .replace(/[(),\s]/g, "")
      .replace(/[^0-9.+-]/g, "");
    if (!stripped) return null;

    const parsed = Number(stripped);
    if (!Number.isFinite(parsed)) return null;
    return hasParens ? -Math.abs(parsed) : parsed;
  };

  const numericAmount = normalizeNumericAmount(amount);
  if (numericAmount === null || !Number.isFinite(numericAmount)) return null;

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
