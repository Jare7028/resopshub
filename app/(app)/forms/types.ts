export const formStatusOptions = ["draft", "active", "archived"] as const;
export const formSubmissionStatusOptions = [
  "open",
  "in_progress",
  "completed",
  "rejected",
] as const;
export const formFieldTypeOptions = [
  "text",
  "textarea",
  "number",
  "date",
  "select",
  "checkbox",
] as const;
export const formFieldConditionOperatorOptions = [
  "equals",
  "not_equals",
  "contains",
  "not_contains",
  "is_empty",
  "is_not_empty",
  "greater_than",
  "greater_or_equal",
  "less_than",
  "less_or_equal",
] as const;
export const formFieldConditionModeOptions = ["all", "any"] as const;
export const formActionPriorityOptions = ["low", "medium", "high", "critical"] as const;

export type FormStatus = (typeof formStatusOptions)[number];
export type FormSubmissionStatus = (typeof formSubmissionStatusOptions)[number];
export type FormFieldType = (typeof formFieldTypeOptions)[number];
export type FormFieldConditionOperator = (typeof formFieldConditionOperatorOptions)[number];
export type FormFieldConditionMode = (typeof formFieldConditionModeOptions)[number];
export type FormActionPriority = (typeof formActionPriorityOptions)[number];

export type FormFieldCondition = {
  fieldKey: string;
  operator: FormFieldConditionOperator;
  value: string;
};

export type FormField = {
  id: string;
  key: string;
  label: string;
  type: FormFieldType;
  required: boolean;
  options?: string[];
  conditionMode?: FormFieldConditionMode;
  conditions?: FormFieldCondition[];
  condition?: FormFieldCondition | null;
};

export type FormAction = {
  id: string;
  label: string;
  taskTitleTemplate: string;
  taskDescriptionTemplate: string;
  assigneeUserId: string | null;
  priority: FormActionPriority;
  enabled: boolean;
};

export function normalizeFormStatus(value: string | null | undefined): FormStatus {
  return formStatusOptions.includes(value as FormStatus) ? (value as FormStatus) : "draft";
}

export function normalizeSubmissionStatus(
  value: string | null | undefined
): FormSubmissionStatus {
  return formSubmissionStatusOptions.includes(value as FormSubmissionStatus)
    ? (value as FormSubmissionStatus)
    : "open";
}

export function normalizeFormFieldType(value: string | null | undefined): FormFieldType {
  return formFieldTypeOptions.includes(value as FormFieldType)
    ? (value as FormFieldType)
    : "text";
}

export function normalizeFormActionPriority(
  value: string | null | undefined
): FormActionPriority {
  return formActionPriorityOptions.includes(value as FormActionPriority)
    ? (value as FormActionPriority)
    : "medium";
}

export function formatFormLabel(value: string) {
  return value
    .split("_")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export function buildFieldKey(label: string, fallback: string) {
  const fromLabel = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return fromLabel || fallback;
}

export function normalizeFormFieldConditionOperator(
  value: string | null | undefined
): FormFieldConditionOperator {
  return formFieldConditionOperatorOptions.includes(
    value as FormFieldConditionOperator
  )
    ? (value as FormFieldConditionOperator)
    : "equals";
}

export function normalizeFormFieldConditionMode(
  value: string | null | undefined
): FormFieldConditionMode {
  return formFieldConditionModeOptions.includes(value as FormFieldConditionMode)
    ? (value as FormFieldConditionMode)
    : "all";
}

export function conditionOperatorUsesValue(operator: FormFieldConditionOperator) {
  return operator !== "is_empty" && operator !== "is_not_empty";
}

export function normalizeFormFieldCondition(value: unknown): FormFieldCondition | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const fieldKey = String(row.fieldKey || "").trim();
  if (!fieldKey) return null;

  const operator = normalizeFormFieldConditionOperator(
    String(row.operator || "").trim() ||
      (Object.prototype.hasOwnProperty.call(row, "equals") ? "equals" : "")
  );
  const rawValue = String(
    Object.prototype.hasOwnProperty.call(row, "value")
      ? row.value || ""
      : row.equals || ""
  ).trim();
  const normalizedValue = conditionOperatorUsesValue(operator) ? rawValue : "";

  return {
    fieldKey,
    operator,
    value: normalizedValue,
  };
}

export function normalizeFormFieldConditions(value: unknown): FormFieldCondition[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => normalizeFormFieldCondition(entry))
    .filter((entry): entry is FormFieldCondition => Boolean(entry));
}

export function normalizeFormFieldVisibility(value: unknown): {
  conditionMode: FormFieldConditionMode;
  conditions: FormFieldCondition[];
  condition: FormFieldCondition | null;
} {
  if (!value || typeof value !== "object") {
    return {
      conditionMode: "all",
      conditions: [],
      condition: null,
    };
  }
  const row = value as Record<string, unknown>;
  const conditionMode = normalizeFormFieldConditionMode(
    String(row.conditionMode || row.condition_mode || "").trim()
  );
  const conditions = normalizeFormFieldConditions(row.conditions || row.rules);
  const condition = normalizeFormFieldCondition(row.condition);
  const normalizedConditions = conditions.length ? conditions : condition ? [condition] : [];

  return {
    conditionMode,
    conditions: normalizedConditions,
    condition: normalizedConditions[0] || null,
  };
}

export function doesFormFieldConditionMatch(
  condition: FormFieldCondition | null | undefined,
  values: Record<string, string>
) {
  if (!condition?.fieldKey) return true;
  const actual = String(values[condition.fieldKey] || "").trim().toLowerCase();
  const expected = String(condition.value || "").trim().toLowerCase();
  const compareValues = () => {
    const actualNumber = Number(actual);
    const expectedNumber = Number(expected);
    if (Number.isFinite(actualNumber) && Number.isFinite(expectedNumber)) {
      if (actualNumber === expectedNumber) return 0;
      return actualNumber > expectedNumber ? 1 : -1;
    }

    const actualTimestamp = Date.parse(actual);
    const expectedTimestamp = Date.parse(expected);
    if (Number.isFinite(actualTimestamp) && Number.isFinite(expectedTimestamp)) {
      if (actualTimestamp === expectedTimestamp) return 0;
      return actualTimestamp > expectedTimestamp ? 1 : -1;
    }

    return actual.localeCompare(expected);
  };

  switch (condition.operator) {
    case "not_equals":
      return actual !== expected;
    case "contains":
      return expected ? actual.includes(expected) : true;
    case "not_contains":
      return expected ? !actual.includes(expected) : true;
    case "is_empty":
      return actual.length === 0;
    case "is_not_empty":
      return actual.length > 0;
    case "greater_than":
      return expected ? compareValues() > 0 : false;
    case "greater_or_equal":
      return expected ? compareValues() >= 0 : false;
    case "less_than":
      return expected ? compareValues() < 0 : false;
    case "less_or_equal":
      return expected ? compareValues() <= 0 : false;
    case "equals":
    default:
      return actual === expected;
  }
}

export function doesFormFieldVisibilityMatch(
  field: Pick<FormField, "conditionMode" | "conditions" | "condition">,
  values: Record<string, string>
) {
  const normalizedConditions = normalizeFormFieldConditions(field.conditions);
  const legacyCondition = normalizeFormFieldCondition(field.condition);
  const conditions = normalizedConditions.length
    ? normalizedConditions
    : legacyCondition
      ? [legacyCondition]
      : [];
  if (!conditions.length) return true;

  const mode = normalizeFormFieldConditionMode(field.conditionMode);
  if (mode === "any") {
    return conditions.some((condition) => doesFormFieldConditionMatch(condition, values));
  }
  return conditions.every((condition) => doesFormFieldConditionMatch(condition, values));
}

export function renderTemplate(template: string, values: Record<string, string>) {
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_match, key: string) => {
    return values[key] ?? "";
  });
}
