import type { FormField } from "./types";

const EM_DASH = "\u2014";

export type SubmissionTableField = Pick<FormField, "key" | "type"> & {
  label: string;
};

function normalizeValuesJson(valuesJson: unknown): Record<string, unknown> {
  if (!valuesJson || typeof valuesJson !== "object" || Array.isArray(valuesJson)) {
    return {};
  }
  return valuesJson as Record<string, unknown>;
}

function normalizeScalarText(value: unknown): string {
  if (value === null || typeof value === "undefined") return "";
  if (Array.isArray(value)) {
    return value
      .map((entry) => normalizeScalarText(entry))
      .filter(Boolean)
      .join(", ")
      .trim();
  }
  if (typeof value === "object") {
    try {
      return JSON.stringify(value).trim();
    } catch {
      return "";
    }
  }
  return String(value).trim();
}

function normalizeCheckboxValue(value: unknown): "Yes" | "No" | "" {
  if (typeof value === "boolean") return value ? "Yes" : "No";

  const normalized = normalizeScalarText(value).toLowerCase();
  if (!normalized) return "";

  if (
    normalized === "true" ||
    normalized === "1" ||
    normalized === "yes" ||
    normalized === "y" ||
    normalized === "on"
  ) {
    return "Yes";
  }
  if (
    normalized === "false" ||
    normalized === "0" ||
    normalized === "no" ||
    normalized === "n" ||
    normalized === "off"
  ) {
    return "No";
  }

  return "";
}

export function shortQuestionLabel(label: string, maxChars = 20): string {
  const normalized = String(label || "").trim();
  if (!normalized) return "";
  if (maxChars < 4 || normalized.length <= maxChars) return normalized;
  return `${normalized.slice(0, maxChars - 3).trimEnd()}...`;
}

export function formatSubmissionValue(field: SubmissionTableField, valuesJson: unknown): string {
  const valuesByKey = normalizeValuesJson(valuesJson);
  const rawValue = valuesByKey[field.key];

  if (field.type === "checkbox") {
    const checkboxValue = normalizeCheckboxValue(rawValue);
    return checkboxValue || EM_DASH;
  }

  const textValue = normalizeScalarText(rawValue);
  return textValue || EM_DASH;
}
