export const EMPLOYEE_INFO_COLUMN_KINDS = ["text", "dropdown", "formula", "number"] as const;
export type EmployeeInfoColumnKind = (typeof EMPLOYEE_INFO_COLUMN_KINDS)[number];

export function isEmployeeInfoColumnKind(value: string): value is EmployeeInfoColumnKind {
  return (EMPLOYEE_INFO_COLUMN_KINDS as readonly string[]).includes(value);
}

export function normalizeEmployeeInfoColumnKind(value: string): EmployeeInfoColumnKind {
  return isEmployeeInfoColumnKind(value) ? value : "text";
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
  const text = String(value ?? "").trim();
  if (!text) return 0;
  const numeric = Number(text.replace(/,/g, ""));
  return Number.isFinite(numeric) ? numeric : 0;
}

export function evaluateEmployeeFormula(
  formula: string | null | undefined,
  resolveColumnIndex: (index: number) => unknown,
  resolveNamedReference?: (reference: string) => unknown
) {
  const raw = String(formula || "").trim();
  if (!raw) return null;
  const expression = raw.startsWith("=") ? raw.slice(1) : raw;
  if (!expression.trim()) return null;

  const replaced = expression.replace(/[A-Za-z_][A-Za-z0-9_]*/g, (match) => {
    if (typeof resolveNamedReference === "function") {
      const namedValue = resolveNamedReference(match);
      if (namedValue !== undefined) {
        return String(toFormulaNumber(namedValue));
      }
    }

    const index = columnLetterToIndex(match);
    if (index < 0) return "0";
    return String(toFormulaNumber(resolveColumnIndex(index)));
  });

  if (!/^[0-9+\-*/().\s]+$/.test(replaced)) {
    return null;
  }

  try {
    const result = Function(`"use strict"; return (${replaced});`)() as number;
    return Number.isFinite(result) ? result : null;
  } catch {
    return null;
  }
}

export function formatFormulaResult(value: number | null) {
  if (value === null) return "";
  if (Number.isInteger(value)) return String(value);
  return value.toFixed(2).replace(/\.?0+$/, "");
}
