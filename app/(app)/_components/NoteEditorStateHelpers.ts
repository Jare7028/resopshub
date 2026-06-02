import type { Editor } from "@tiptap/core";
import { normalizeInlineText } from "@/lib/noteEditorInline";
import {
  NOTE_TABLE_COLUMN_TYPES,
  type NoteTableColumnType,
} from "@/lib/noteEditorTableColumns";
import {
  type WordBlockStyle,
  type WordTextAlign,
} from "./NoteEditorRibbonPrimitives";

export type CopiedFormatSnapshot = {
  blockStyle: WordBlockStyle;
  textAlign: WordTextAlign;
  fontFamily: string;
  fontSize: string;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  highlight: boolean;
};

export function getActiveTableColumnType(
  editor: Editor | null | undefined
): NoteTableColumnType {
  if (!editor || !editor.isActive("table")) {
    return "text";
  }
  const { $from } = editor.state.selection;
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    const node = $from.node(depth);
    const name = node.type.name;
    if (name === "tableCell" || name === "tableHeader") {
      const colType = (node.attrs?.colType as string | undefined) || "text";
      return NOTE_TABLE_COLUMN_TYPES.some((type) => type.id === colType)
        ? (colType as NoteTableColumnType)
        : "text";
    }
  }
  return "text";
}

export function getCurrentTextAlign(
  editor: Editor | null | undefined
): WordTextAlign {
  if (!editor) {
    return "left";
  }
  const candidates = [
    editor.getAttributes("paragraph"),
    editor.getAttributes("heading"),
    editor.getAttributes("blockquote"),
  ] as Array<{ textAlign?: string }>;
  for (const attrs of candidates) {
    const value = String(attrs?.textAlign || "")
      .trim()
      .toLowerCase();
    if (
      value === "left" ||
      value === "center" ||
      value === "right" ||
      value === "justify"
    ) {
      return value;
    }
  }
  return "left";
}

export function findTrailingMissingImageNodePos(editor: Editor) {
  let trailingPos: number | null = null;
  editor.state.doc.descendants((node, pos) => {
    const nodeType = String(node.type.name || "")
      .trim()
      .toLowerCase();
    if (!nodeType.includes("image")) {
      return true;
    }
    const attrs = (node.attrs || {}) as Record<string, unknown>;
    const src = String(attrs.src || "").trim();
    if (!src) {
      trailingPos = pos;
    }
    return true;
  });
  return trailingPos;
}

export function getSelectedText(editor: Editor) {
  const { from, to, empty } = editor.state.selection;
  if (empty) {
    return "";
  }
  return normalizeInlineText(editor.state.doc.textBetween(from, to, " "));
}

export function getCurrentLineText(editor: Editor) {
  const { $from } = editor.state.selection;
  return normalizeInlineText($from.parent.textContent || "");
}

export function getSuggestedTaskTitle(editor: Editor) {
  return getSelectedText(editor) || getCurrentLineText(editor);
}
