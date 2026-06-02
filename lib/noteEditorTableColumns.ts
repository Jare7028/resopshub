export const NOTE_TABLE_COLUMN_TYPES = [
  { id: "text", label: "Text" },
  { id: "number", label: "Number" },
  { id: "date", label: "Date" },
  { id: "url", label: "URL" },
  { id: "email", label: "Email" },
  { id: "phone", label: "Phone" },
  { id: "checkbox", label: "Checkbox" },
] as const;

export type NoteTableColumnType = (typeof NOTE_TABLE_COLUMN_TYPES)[number]["id"];
