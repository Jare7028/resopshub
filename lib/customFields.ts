export const CUSTOM_FIELD_ENTITY_TYPES = ["client", "project", "task"] as const;
export type CustomFieldEntityType = (typeof CUSTOM_FIELD_ENTITY_TYPES)[number];

export const CUSTOM_FIELD_KINDS = ["text", "dropdown"] as const;
export type CustomFieldKind = (typeof CUSTOM_FIELD_KINDS)[number];

export type CustomFieldRow = {
  id: string;
  entity_type: CustomFieldEntityType;
  key: string;
  label: string;
  field_kind: CustomFieldKind;
  position: number;
};

export type CustomFieldOptionRow = {
  id: string;
  field_id: string;
  value: string;
  position: number;
};

export type CustomFieldValueRow = {
  field_id: string;
  text_value: string | null;
  option_value: string | null;
};

export function isCustomFieldEntityType(value: string): value is CustomFieldEntityType {
  return (CUSTOM_FIELD_ENTITY_TYPES as readonly string[]).includes(value);
}

export function isCustomFieldKind(value: string): value is CustomFieldKind {
  return (CUSTOM_FIELD_KINDS as readonly string[]).includes(value);
}

export function normalizeCustomFieldKind(value: string): CustomFieldKind {
  return isCustomFieldKind(value) ? value : "text";
}

export function toCustomFieldKey(label: string) {
  const normalized = String(label || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return normalized || "field";
}
