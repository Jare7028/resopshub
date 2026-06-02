export type ContextMenuFavoriteActionId =
  | "bold"
  | "italic"
  | "underline"
  | "highlight"
  | "fontSizeUp"
  | "fontSizeDown"
  | "textColorSlate"
  | "textColorBlue"
  | "textColorRed"
  | "paragraph"
  | "heading1"
  | "heading2"
  | "bulletList"
  | "orderedList"
  | "checklist"
  | "quote"
  | "insertShape"
  | "insertArrow"
  | "insertTextBox"
  | "insertTable"
  | "divider"
  | "addRowBefore"
  | "addRowAfter"
  | "addColumnBefore"
  | "addColumnAfter"
  | "deleteRow"
  | "deleteColumn"
  | "deleteTable";

export type ContextMenuFavoriteAction = {
  id: ContextMenuFavoriteActionId;
  label: string;
  inTableOnly?: boolean;
  destructive?: boolean;
};

export const CONTEXT_MENU_FAVORITE_ACTIONS: ReadonlyArray<ContextMenuFavoriteAction> = [
  { id: "bold", label: "Bold" },
  { id: "italic", label: "Italic" },
  { id: "underline", label: "Underline" },
  { id: "highlight", label: "Highlight" },
  { id: "fontSizeUp", label: "Font size +" },
  { id: "fontSizeDown", label: "Font size -" },
  { id: "textColorSlate", label: "Text color: Slate" },
  { id: "textColorBlue", label: "Text color: Blue" },
  { id: "textColorRed", label: "Text color: Red" },
  { id: "paragraph", label: "Paragraph" },
  { id: "heading1", label: "Heading 1" },
  { id: "heading2", label: "Heading 2" },
  { id: "bulletList", label: "Bulleted list" },
  { id: "orderedList", label: "Numbered list" },
  { id: "checklist", label: "Checklist" },
  { id: "quote", label: "Quote / Callout" },
  { id: "insertShape", label: "Insert shape" },
  { id: "insertArrow", label: "Insert arrow" },
  { id: "insertTextBox", label: "Insert text box" },
  { id: "insertTable", label: "Insert table" },
  { id: "divider", label: "Divider" },
  { id: "addRowBefore", label: "Insert row above", inTableOnly: true },
  { id: "addRowAfter", label: "Insert row below", inTableOnly: true },
  { id: "addColumnBefore", label: "Insert column left", inTableOnly: true },
  { id: "addColumnAfter", label: "Insert column right", inTableOnly: true },
  { id: "deleteRow", label: "Delete row", inTableOnly: true },
  { id: "deleteColumn", label: "Delete column", inTableOnly: true },
  {
    id: "deleteTable",
    label: "Delete table",
    inTableOnly: true,
    destructive: true,
  },
];

export const CONTEXT_MENU_FAVORITE_ACTION_ID_SET =
  new Set<ContextMenuFavoriteActionId>(
    CONTEXT_MENU_FAVORITE_ACTIONS.map((action) => action.id)
  );

export const CONTEXT_MENU_FAVORITES_STORAGE_KEY =
  "note_editor_context_favorites_v1";

export function normalizeContextMenuFavoriteIds(
  value: unknown
): ContextMenuFavoriteActionId[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const next = value
    .map((item) => String(item || "").trim())
    .filter((item): item is ContextMenuFavoriteActionId =>
      CONTEXT_MENU_FAVORITE_ACTION_ID_SET.has(item as ContextMenuFavoriteActionId)
    );
  return Array.from(new Set(next));
}
