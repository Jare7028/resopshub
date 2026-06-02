import type { Editor } from "@tiptap/core";
import { normalizeInlineText } from "@/lib/noteEditorInline";
import type { OverlayNodeType } from "@/lib/noteEditorOverlays";
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

export type NoteEditorReviewStats = {
  words: number;
  readingMinutes: number;
  mentions: number;
  linkedTaskRefs: number;
};

export type NoteEditorOutlineHeading = {
  id: string;
  label: string;
  level: number;
};

type NoteEditorOutlineNode = {
  type: { name: string };
  attrs?: { level?: unknown } | null;
  textContent?: string | null;
};

type NoteEditorOutlineDoc = {
  descendants(callback: (node: NoteEditorOutlineNode, pos: number) => boolean): unknown;
};

export const EMPTY_NOTE_EDITOR_REVIEW_STATS: NoteEditorReviewStats = {
  words: 0,
  readingMinutes: 0,
  mentions: 0,
  linkedTaskRefs: 0,
};

export function buildNoteEditorMetaTooltip(params: {
  lastEditedAtLabel?: string | null;
  lastEditedByLabel?: string | null;
}) {
  const lastEditedAtLabel = String(params.lastEditedAtLabel || "").trim();
  const lastEditedByLabel = String(params.lastEditedByLabel || "").trim();
  if (!lastEditedAtLabel && !lastEditedByLabel) {
    return "";
  }
  const parts: string[] = [];
  if (lastEditedAtLabel) {
    parts.push(`Last edited: ${lastEditedAtLabel}`);
  }
  if (lastEditedByLabel) {
    parts.push(`Edited by: ${lastEditedByLabel}`);
  }
  return parts.join("\n");
}

export function buildNoteEditorReviewStats(rawText: string): NoteEditorReviewStats {
  const plainText = normalizeInlineText(rawText);
  if (!plainText) {
    return EMPTY_NOTE_EDITOR_REVIEW_STATS;
  }
  const words = plainText.split(/\s+/).filter(Boolean).length;
  return {
    words,
    readingMinutes: Math.max(1, Math.ceil(words / 220)),
    mentions: (plainText.match(/@[a-z0-9._-]+/gi) || []).length,
    linkedTaskRefs: (plainText.match(/\/tasks\/[a-f0-9-]+/gi) || []).length,
  };
}

export function buildNoteEditorOutlineHeadings(
  doc: NoteEditorOutlineDoc | null | undefined
): NoteEditorOutlineHeading[] {
  if (!doc) {
    return [];
  }
  const headings: NoteEditorOutlineHeading[] = [];
  let headingIndex = 0;
  doc.descendants((node, pos) => {
    if (node.type.name !== "heading") {
      return true;
    }
    const level = Number(node.attrs?.level || 1);
    const label = normalizeInlineText(node.textContent || "");
    if (!label) {
      return true;
    }
    headings.push({
      id: `heading-${pos}-${headingIndex}`,
      label,
      level: Math.min(3, Math.max(1, level)),
    });
    headingIndex += 1;
    return true;
  });
  return headings;
}

export function getSelectedOverlayLabel(
  overlayNodeType: OverlayNodeType | null | undefined
) {
  if (overlayNodeType === "noteShape") {
    return "Shape selected";
  }
  if (overlayNodeType === "noteTextBox") {
    return "Text box selected";
  }
  return "No shape or text box selected";
}

export function getContextMenuOverlayDeleteLabel(
  overlayNodeType: OverlayNodeType | null | undefined
) {
  if (overlayNodeType === "noteShape") {
    return "Delete shape";
  }
  if (overlayNodeType === "noteTextBox") {
    return "Delete text box";
  }
  return "Delete item";
}

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
