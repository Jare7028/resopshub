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
export const formActionPriorityOptions = ["low", "medium", "high", "critical"] as const;

export type FormStatus = (typeof formStatusOptions)[number];
export type FormSubmissionStatus = (typeof formSubmissionStatusOptions)[number];
export type FormFieldType = (typeof formFieldTypeOptions)[number];
export type FormActionPriority = (typeof formActionPriorityOptions)[number];

export type FormFieldCondition = {
  fieldKey: string;
  equals: string;
};

export type FormField = {
  id: string;
  key: string;
  label: string;
  type: FormFieldType;
  required: boolean;
  options?: string[];
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

export function renderTemplate(template: string, values: Record<string, string>) {
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_match, key: string) => {
    return values[key] ?? "";
  });
}
