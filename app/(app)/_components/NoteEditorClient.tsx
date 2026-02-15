"use client";

import type { ChangeEvent, MouseEvent as ReactMouseEvent, ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import type { Editor } from "@tiptap/core";
import { EditorContent, useEditor } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import StarterKit from "@tiptap/starter-kit";
import Highlight from "@tiptap/extension-highlight";
import Underline from "@tiptap/extension-underline";
import { FontSize, TextStyle } from "@tiptap/extension-text-style";
import FontFamily from "@tiptap/extension-font-family";
import TextAlign from "@tiptap/extension-text-align";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import Image from "@tiptap/extension-image";
import Link from "@tiptap/extension-link";
import { Table, TableRow, TableHeader, TableCell } from "@tiptap/extension-table";
import Placeholder from "@tiptap/extension-placeholder";
import { selectedRect } from "prosemirror-tables";
import { createEmptyDoc } from "@/lib/editorContent";

type ContextMenuState = {
  open: boolean;
  x: number;
  y: number;
  inTable: boolean;
};

type ContextMenuMode = "full" | "favorites";

type ContextMenuFavoriteActionId =
  | "paragraph"
  | "heading1"
  | "heading2"
  | "bulletList"
  | "orderedList"
  | "checklist"
  | "quote"
  | "insertTable"
  | "divider"
  | "addRowBefore"
  | "addRowAfter"
  | "addColumnBefore"
  | "addColumnAfter"
  | "deleteRow"
  | "deleteColumn"
  | "deleteTable";

type ContextMenuFavoriteAction = {
  id: ContextMenuFavoriteActionId;
  label: string;
  inTableOnly?: boolean;
  destructive?: boolean;
};

type SlashRange = {
  from: number;
  to: number;
};

type SlashCommand = {
  id: string;
  label: string;
  description: string;
  keywords: string[];
  run: (editor: Editor, range: SlashRange) => void;
};

type SlashMenuState = {
  open: boolean;
  query: string;
  x: number;
  y: number;
  index: number;
  range: SlashRange | null;
  items: SlashCommand[];
};

type MentionSuggestion = {
  id: string;
  handle: string;
  full_name: string | null;
  email: string | null;
};

type MentionMenuState = {
  open: boolean;
  query: string;
  x: number;
  y: number;
  index: number;
  range: SlashRange | null;
  items: MentionSuggestion[];
  loading: boolean;
};

type NoteEditorClientProps = {
  entityId: string;
  initialContent: unknown;
  title: string;
  placeholder: string;
  onSave: (entityId: string, content: unknown) => Promise<void>;
  onCreateTask?: (input: {
    title: string;
    dueDate: string | null;
    dueTime: string | null;
    assignToMe: boolean;
  }) => Promise<{ taskId: string }>;
  lastEditedAtLabel?: string | null;
  lastEditedByLabel?: string | null;
  showTopToolbar?: boolean;
  enableZoomControls?: boolean;
  contextMenuMode?: ContextMenuMode;
};

type TaskHoverSummary = {
  taskId: string;
  title: string;
  status: string;
  dueDate: string | null;
  dueTime: string | null;
  assignee: string | null;
};

type TaskHoverState = {
  open: boolean;
  taskId: string | null;
  x: number;
  y: number;
  loading: boolean;
  error: string;
  data: TaskHoverSummary | null;
};

type TaskInsertSelection = {
  from: number;
  to: number;
  text: string;
};

type ImageFloatMode = "none" | "left" | "right";
const MAX_INLINE_IMAGE_BYTES = 1_800_000;
const MAX_INLINE_IMAGE_DIMENSION = 1800;
const MIN_INLINE_IMAGE_DIMENSION = 640;
const IMAGE_COMPRESSION_QUALITIES = [0.9, 0.82, 0.74, 0.66, 0.58] as const;

const SLASH_COMMANDS: SlashCommand[] = [
  {
    id: "paragraph",
    label: "Paragraph",
    description: "Start with plain text.",
    keywords: ["text", "p"],
    run: (editor, range) =>
      editor.chain().focus().deleteRange(range).setParagraph().run(),
  },
  {
    id: "heading1",
    label: "Heading 1",
    description: "Large section heading.",
    keywords: ["h1", "title"],
    run: (editor, range) =>
      editor.chain().focus().deleteRange(range).setHeading({ level: 1 }).run(),
  },
  {
    id: "heading2",
    label: "Heading 2",
    description: "Medium section heading.",
    keywords: ["h2", "subtitle"],
    run: (editor, range) =>
      editor.chain().focus().deleteRange(range).setHeading({ level: 2 }).run(),
  },
  {
    id: "heading3",
    label: "Heading 3",
    description: "Small section heading.",
    keywords: ["h3"],
    run: (editor, range) =>
      editor.chain().focus().deleteRange(range).setHeading({ level: 3 }).run(),
  },
  {
    id: "bullet-list",
    label: "Bulleted list",
    description: "Create a bulleted list.",
    keywords: ["bullet", "list", "ul"],
    run: (editor, range) =>
      editor.chain().focus().deleteRange(range).toggleBulletList().run(),
  },
  {
    id: "ordered-list",
    label: "Numbered list",
    description: "Create a numbered list.",
    keywords: ["number", "list", "ol"],
    run: (editor, range) =>
      editor.chain().focus().deleteRange(range).toggleOrderedList().run(),
  },
  {
    id: "checklist",
    label: "Checklist",
    description: "Track tasks with checkboxes.",
    keywords: ["check", "todo", "task"],
    run: (editor, range) =>
      editor.chain().focus().deleteRange(range).toggleTaskList().run(),
  },
  {
    id: "quote",
    label: "Quote / Callout",
    description: "Emphasize a quote or callout.",
    keywords: ["quote", "callout", "blockquote"],
    run: (editor, range) =>
      editor.chain().focus().deleteRange(range).toggleBlockquote().run(),
  },
  {
    id: "table",
    label: "Table",
    description: "Insert a 3x3 table.",
    keywords: ["table", "grid", "rows", "cols"],
    run: (editor, range) =>
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
        .run(),
  },
  {
    id: "divider",
    label: "Divider",
    description: "Insert a horizontal rule.",
    keywords: ["divider", "hr", "line"],
    run: (editor, range) =>
      editor.chain().focus().deleteRange(range).setHorizontalRule().run(),
  },
];

const TABLE_COLUMN_TYPES = [
  { id: "text", label: "Text" },
  { id: "number", label: "Number" },
  { id: "date", label: "Date" },
  { id: "url", label: "URL" },
  { id: "email", label: "Email" },
  { id: "phone", label: "Phone" },
  { id: "checkbox", label: "Checkbox" },
] as const;

type TableColumnType = (typeof TABLE_COLUMN_TYPES)[number]["id"];

const WORD_FONT_OPTIONS = [
  { value: "Arial", label: "Arial" },
  { value: "Verdana", label: "Verdana" },
  { value: "Georgia", label: "Georgia" },
  { value: "Times New Roman", label: "Times New Roman" },
  { value: "Courier New", label: "Courier New" },
] as const;

const WORD_FONT_SIZE_OPTIONS = [
  { value: "12px", label: "12" },
  { value: "14px", label: "14" },
  { value: "16px", label: "16" },
  { value: "18px", label: "18" },
  { value: "24px", label: "24" },
  { value: "32px", label: "32" },
] as const;

const CONTEXT_MENU_FAVORITE_ACTIONS: ReadonlyArray<ContextMenuFavoriteAction> = [
  { id: "paragraph", label: "Paragraph" },
  { id: "heading1", label: "Heading 1" },
  { id: "heading2", label: "Heading 2" },
  { id: "bulletList", label: "Bulleted list" },
  { id: "orderedList", label: "Numbered list" },
  { id: "checklist", label: "Checklist" },
  { id: "quote", label: "Quote / Callout" },
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

const CONTEXT_MENU_FAVORITE_ACTION_ID_SET = new Set<ContextMenuFavoriteActionId>(
  CONTEXT_MENU_FAVORITE_ACTIONS.map((action) => action.id)
);

const CONTEXT_MENU_FAVORITES_STORAGE_KEY = "note_editor_context_favorites_v1";

type WordTextAlign = "left" | "center" | "right" | "justify";
type WordBlockStyle = "paragraph" | "h1" | "h2" | "h3" | "quote";
type RibbonTabId = "home" | "insert" | "layout" | "review" | "view";

const RIBBON_TABS: ReadonlyArray<{ id: RibbonTabId; label: string }> = [
  { id: "home", label: "Home" },
  { id: "insert", label: "Insert" },
  { id: "layout", label: "Layout" },
  { id: "review", label: "Review" },
  { id: "view", label: "View" },
];

type CopiedFormatSnapshot = {
  blockStyle: WordBlockStyle;
  textAlign: WordTextAlign;
  fontFamily: string;
  fontSize: string;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  highlight: boolean;
};

type RibbonGroupProps = {
  title: string;
  children: ReactNode;
};

type RibbonIconButtonProps = {
  label: string;
  title?: string;
  active?: boolean;
  disabled?: boolean;
  iconOnly?: boolean;
  onClick: () => void;
  icon: ReactNode;
};

function RibbonGroup({ title, children }: RibbonGroupProps) {
  return (
    <div
      className="rounded-md border border-slate-200 bg-slate-50 px-1.5 py-1.5"
      aria-label={title}
    >
      <div className="flex flex-wrap items-center gap-1">{children}</div>
    </div>
  );
}

function RibbonIconButton({
  label,
  title,
  active = false,
  disabled = false,
  iconOnly = false,
  onClick,
  icon,
}: RibbonIconButtonProps) {
  const baseClass =
    "inline-flex h-7 items-center gap-1 rounded-md border text-[11px] font-semibold transition";
  const stateClass = active
    ? "border-slate-900 bg-slate-900 text-white"
    : "border-slate-300 bg-white text-slate-700 hover:border-slate-400 hover:text-slate-900";
  const sizeClass = iconOnly ? "w-7 justify-center px-0" : "px-2";

  return (
    <button
      type="button"
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
      title={title || label}
      disabled={disabled}
      className={`${baseClass} ${stateClass} ${sizeClass} disabled:cursor-not-allowed disabled:opacity-40`}
    >
      <span className="inline-flex h-3.5 w-3.5 items-center justify-center">{icon}</span>
      {iconOnly ? <span className="sr-only">{label}</span> : <span>{label}</span>}
    </button>
  );
}

function AlignIcon({ align }: { align: WordTextAlign }) {
  if (align === "center") {
    return (
      <svg viewBox="0 0 14 14" className="h-3.5 w-3.5" aria-hidden="true">
        <path d="M2 3h10M3 6h8M2 9h10M3 12h8" stroke="currentColor" strokeWidth="1.2" />
      </svg>
    );
  }
  if (align === "right") {
    return (
      <svg viewBox="0 0 14 14" className="h-3.5 w-3.5" aria-hidden="true">
        <path d="M2 3h10M4 6h8M2 9h10M4 12h8" stroke="currentColor" strokeWidth="1.2" />
      </svg>
    );
  }
  if (align === "justify") {
    return (
      <svg viewBox="0 0 14 14" className="h-3.5 w-3.5" aria-hidden="true">
        <path d="M2 3h10M2 6h10M2 9h10M2 12h10" stroke="currentColor" strokeWidth="1.2" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 14 14" className="h-3.5 w-3.5" aria-hidden="true">
      <path d="M2 3h10M2 6h8M2 9h10M2 12h8" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}

function ListBulletedIcon() {
  return (
    <svg viewBox="0 0 14 14" className="h-3.5 w-3.5" aria-hidden="true">
      <path d="M5 3.5h7M5 7h7M5 10.5h7" stroke="currentColor" strokeWidth="1.2" />
      <circle cx="2.4" cy="3.5" r="0.8" fill="currentColor" />
      <circle cx="2.4" cy="7" r="0.8" fill="currentColor" />
      <circle cx="2.4" cy="10.5" r="0.8" fill="currentColor" />
    </svg>
  );
}

function ListNumberedIcon() {
  return (
    <svg viewBox="0 0 14 14" className="h-3.5 w-3.5" aria-hidden="true">
      <path d="M5 3.5h7M5 7h7M5 10.5h7" stroke="currentColor" strokeWidth="1.2" />
      <path d="M1.4 3h1v1.4M1.2 6.6h1.6M1.2 8.9l1.4-.8-1.4-.8" stroke="currentColor" strokeWidth="1.1" />
    </svg>
  );
}

function ChecklistIcon() {
  return (
    <svg viewBox="0 0 14 14" className="h-3.5 w-3.5" aria-hidden="true">
      <path d="M5 3.5h7M5 7h7M5 10.5h7" stroke="currentColor" strokeWidth="1.2" />
      <path d="M1.5 2.8h2v2h-2zM1.5 6.3h2v2h-2zM1.5 9.8h2v2h-2z" stroke="currentColor" strokeWidth="1" fill="none" />
    </svg>
  );
}

function PaintIcon() {
  return (
    <svg viewBox="0 0 14 14" className="h-3.5 w-3.5" aria-hidden="true">
      <path d="M2.5 8.5 7.2 3.8l3 3-4.7 4.7H2.5zM8.2 2.8l1-1a1.3 1.3 0 0 1 1.8 0l1.2 1.2a1.3 1.3 0 0 1 0 1.8l-1 1" stroke="currentColor" strokeWidth="1.1" fill="none" />
    </svg>
  );
}

function ApplyIcon() {
  return (
    <svg viewBox="0 0 14 14" className="h-3.5 w-3.5" aria-hidden="true">
      <path d="M3 2.5h8v9H3zM4.8 6.8l1.3 1.3 3-3" stroke="currentColor" strokeWidth="1.1" fill="none" />
    </svg>
  );
}

function ClearIcon() {
  return (
    <svg viewBox="0 0 14 14" className="h-3.5 w-3.5" aria-hidden="true">
      <path d="m3 9 3.2-3.2 3.2 3.2L6.8 11.6H4.2zM7.8 11.6H12" stroke="currentColor" strokeWidth="1.1" fill="none" />
    </svg>
  );
}

function LinkIcon() {
  return (
    <svg viewBox="0 0 14 14" className="h-3.5 w-3.5" aria-hidden="true">
      <path d="M5.3 8.7 3.8 10.2a1.9 1.9 0 0 1-2.7-2.7l1.5-1.5a1.9 1.9 0 0 1 2.7 0M8.7 5.3l1.5-1.5a1.9 1.9 0 0 1 2.7 2.7l-1.5 1.5a1.9 1.9 0 0 1-2.7 0M4.8 9.2l4.4-4.4" stroke="currentColor" strokeWidth="1.1" fill="none" />
    </svg>
  );
}

function ImageIcon() {
  return (
    <svg viewBox="0 0 14 14" className="h-3.5 w-3.5" aria-hidden="true">
      <path d="M2 2.5h10v9H2zM4 9l2-2 1.5 1.5L9.8 6 12 8.4" stroke="currentColor" strokeWidth="1.1" fill="none" />
      <circle cx="4.5" cy="5" r="0.8" fill="currentColor" />
    </svg>
  );
}

function AttachmentIcon() {
  return (
    <svg viewBox="0 0 14 14" className="h-3.5 w-3.5" aria-hidden="true">
      <path d="M9.8 4.4 6 8.2a1.9 1.9 0 1 1-2.7-2.7l4-4a2.8 2.8 0 0 1 4 4l-4.1 4.1a3.6 3.6 0 0 1-5.1-5.1l3.8-3.8" stroke="currentColor" strokeWidth="1.1" fill="none" />
    </svg>
  );
}

function TableIcon() {
  return (
    <svg viewBox="0 0 14 14" className="h-3.5 w-3.5" aria-hidden="true">
      <path d="M2 2.5h10v9H2zM2 5.5h10M2 8.5h10M5.3 2.5v9M8.7 2.5v9" stroke="currentColor" strokeWidth="1.1" fill="none" />
    </svg>
  );
}

function SectionIcon() {
  return (
    <svg viewBox="0 0 14 14" className="h-3.5 w-3.5" aria-hidden="true">
      <path d="M2.5 2.5h9v9h-9zM4.5 4.5h5M4.5 6.8h3.5M4.5 9h4.2" stroke="currentColor" strokeWidth="1.1" fill="none" />
    </svg>
  );
}

function UndoIcon() {
  return (
    <svg viewBox="0 0 14 14" className="h-3.5 w-3.5" aria-hidden="true">
      <path d="M5.2 4 2.6 6.5 5.2 9M3 6.5h4.5a3.5 3.5 0 1 1 0 7" stroke="currentColor" strokeWidth="1.1" fill="none" />
    </svg>
  );
}

function RedoIcon() {
  return (
    <svg viewBox="0 0 14 14" className="h-3.5 w-3.5" aria-hidden="true">
      <path d="m8.8 4 2.6 2.5-2.6 2.5M11 6.5H6.5a3.5 3.5 0 1 0 0 7" stroke="currentColor" strokeWidth="1.1" fill="none" />
    </svg>
  );
}

function getActiveTableColumnType(editor: Editor | null | undefined): TableColumnType {
  if (!editor || !editor.isActive("table")) {
    return "text";
  }
  const { $from } = editor.state.selection;
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    const node = $from.node(depth);
    const name = node.type.name;
    if (name === "tableCell" || name === "tableHeader") {
      const colType = (node.attrs?.colType as string | undefined) || "text";
      return TABLE_COLUMN_TYPES.some((type) => type.id === colType)
        ? (colType as TableColumnType)
        : "text";
    }
  }
  return "text";
}

function getCurrentTextAlign(editor: Editor | null | undefined): WordTextAlign {
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

function normalizeContent(content: unknown) {
  if (content && typeof content === "object") {
    const value = content as { type?: string };
    if (value.type === "doc") {
      return content;
    }
  }
  return createEmptyDoc();
}

function normalizeImageFloat(value: string | null | undefined): ImageFloatMode {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  if (normalized === "left" || normalized === "right") {
    return normalized;
  }
  return "none";
}

function normalizeFontFamilyLabel(value: string) {
  const firstFamily = String(value || "")
    .split(",")[0]
    ?.trim()
    .replace(/^["']|["']$/g, "");
  return firstFamily || "Default";
}

function normalizeFontSizeLabel(value: string) {
  const raw = String(value || "").trim().toLowerCase();
  if (raw.endsWith("px")) {
    const px = Number.parseFloat(raw.slice(0, -2));
    if (Number.isFinite(px) && px > 0) {
      return Number.isInteger(px) ? String(px) : px.toFixed(1).replace(/\.0$/, "");
    }
  }
  return "Default";
}

function readBlobAsDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result === "string") {
        resolve(result);
        return;
      }
      reject(new Error("Unable to read image data"));
    };
    reader.onerror = () => reject(reader.error || new Error("Unable to read image data"));
    reader.readAsDataURL(blob);
  });
}

function loadImageElement(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new window.Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Unable to decode image"));
    image.src = src;
  });
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality?: number) {
  return new Promise<Blob | null>((resolve) => {
    canvas.toBlob(
      (blob) => resolve(blob),
      type,
      typeof quality === "number" ? quality : undefined
    );
  });
}

async function optimizeImageForInlineInsert(file: File) {
  const initialDataUrl = await readBlobAsDataUrl(file);
  if (file.size <= MAX_INLINE_IMAGE_BYTES) {
    return initialDataUrl;
  }

  const image = await loadImageElement(initialDataUrl);
  const sourceWidth = image.naturalWidth || image.width;
  const sourceHeight = image.naturalHeight || image.height;
  if (!sourceWidth || !sourceHeight) {
    return initialDataUrl;
  }

  const maxDimension = Math.max(sourceWidth, sourceHeight);
  const initialScale =
    maxDimension > MAX_INLINE_IMAGE_DIMENSION
      ? MAX_INLINE_IMAGE_DIMENSION / maxDimension
      : 1;
  let width = Math.max(1, Math.round(sourceWidth * initialScale));
  let height = Math.max(1, Math.round(sourceHeight * initialScale));

  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) {
    return initialDataUrl;
  }

  let bestBlob: Blob | null = null;
  while (true) {
    canvas.width = width;
    canvas.height = height;
    context.clearRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);

    for (const quality of IMAGE_COMPRESSION_QUALITIES) {
      const blob = await canvasToBlob(canvas, "image/jpeg", quality);
      if (!blob) {
        continue;
      }
      if (!bestBlob || blob.size < bestBlob.size) {
        bestBlob = blob;
      }
      if (blob.size <= MAX_INLINE_IMAGE_BYTES) {
        return readBlobAsDataUrl(blob);
      }
    }

    if (
      width <= MIN_INLINE_IMAGE_DIMENSION &&
      height <= MIN_INLINE_IMAGE_DIMENSION
    ) {
      break;
    }

    const nextWidth = Math.max(1, Math.floor(width * 0.85));
    const nextHeight = Math.max(1, Math.floor(height * 0.85));
    if (nextWidth === width && nextHeight === height) {
      break;
    }
    width = nextWidth;
    height = nextHeight;
  }

  if (!bestBlob) {
    return initialDataUrl;
  }

  if (bestBlob.size > MAX_INLINE_IMAGE_BYTES) {
    throw new Error("Image is too large. Try a smaller image.");
  }

  return readBlobAsDataUrl(bestBlob);
}

const FloatingImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      float: {
        default: "none",
        parseHTML: (element) =>
          normalizeImageFloat(
            element.getAttribute("data-float") || (element as HTMLElement).style.float
          ),
        renderHTML: (attributes) => {
          const float = normalizeImageFloat(
            (attributes as { float?: string | null }).float
          );
          return float === "none" ? {} : { "data-float": float };
        },
      },
    };
  },
});

function getSlashMatch(editor: Editor) {
  const { state } = editor;
  if (!state.selection.empty) {
    return null;
  }

  const { from } = state.selection;
  const start = Math.max(0, from - 120);
  const textBefore = state.doc.textBetween(start, from, "\n", "\n");
  const slashIndex = textBefore.lastIndexOf("/");

  if (slashIndex === -1) {
    return null;
  }

  const charBefore = slashIndex > 0 ? textBefore[slashIndex - 1] : " ";
  if (charBefore && !/\s/.test(charBefore)) {
    return null;
  }

  const query = textBefore.slice(slashIndex + 1);
  if (query.includes(" ") || query.length > 32) {
    return null;
  }

  const fromPos = from - query.length - 1;
  return {
    range: { from: fromPos, to: from },
    query,
  };
}

function filterSlashCommands(commands: SlashCommand[], query: string) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) {
    return commands;
  }
  return commands.filter((command) => {
    const label = command.label.toLowerCase();
    if (label.includes(normalized)) {
      return true;
    }
    return command.keywords.some((keyword) => keyword.includes(normalized));
  });
}

function normalizeMentionHandle(value: string) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/^@+/, "")
    .replace(/[^a-z0-9._@-]/g, "")
    .replace(/^[._-]+|[._-]+$/g, "");

  return normalized.length >= 2 ? normalized : "";
}

function getMentionMatch(editor: Editor) {
  const { state } = editor;
  if (!state.selection.empty) {
    return null;
  }

  const { from } = state.selection;
  const start = Math.max(0, from - 160);
  const textBefore = state.doc.textBetween(start, from, "\n", "\n");
  const match = textBefore.match(/(^|[^a-zA-Z0-9_])@([a-zA-Z0-9._@-]{0,127})$/);
  if (!match) {
    return null;
  }

  const mentionQuery = String(match[2] || "");
  const mentionToken = `@${mentionQuery}`;
  const tokenStartInText = textBefore.lastIndexOf(mentionToken);
  if (tokenStartInText < 0) {
    return null;
  }

  return {
    range: {
      from: start + tokenStartInText,
      to: from,
    },
    query: mentionQuery.toLowerCase(),
  };
}

function normalizeInlineText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function normalizeTaskStatusLabel(value: string | null | undefined) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  if (!normalized) return "To Do";
  return normalized
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function extractTaskIdFromHref(href: string) {
  const match = href.match(/^\/tasks\/([a-z0-9-]+)/i);
  return match?.[1] || null;
}

function isPersonalPathLink(value: string) {
  return /^\/personal\/[a-f0-9-]+(?:[?#][^\s]*)?$/i.test(value.trim());
}

function getSelectedText(editor: Editor) {
  const { from, to, empty } = editor.state.selection;
  if (empty) {
    return "";
  }
  return normalizeInlineText(editor.state.doc.textBetween(from, to, " "));
}

function getCurrentLineText(editor: Editor) {
  const { $from } = editor.state.selection;
  return normalizeInlineText($from.parent.textContent || "");
}

function getSuggestedTaskTitle(editor: Editor) {
  return getSelectedText(editor) || getCurrentLineText(editor);
}

export default function NoteEditorClient({
  entityId,
  initialContent,
  title,
  placeholder,
  onSave,
  onCreateTask,
  lastEditedAtLabel,
  lastEditedByLabel,
  showTopToolbar = true,
  enableZoomControls = false,
  contextMenuMode = "full",
}: NoteEditorClientProps) {
  const [activeRibbonTab, setActiveRibbonTab] = useState<RibbonTabId>("home");
  const [, startTransition] = useTransition();
  const [isTaskPending, startTaskTransition] = useTransition();
  const [contextMenu, setContextMenu] = useState<ContextMenuState>({
    open: false,
    x: 0,
    y: 0,
    inTable: false,
  });
  const [contextMenuFavorites, setContextMenuFavorites] = useState<
    ContextMenuFavoriteActionId[]
  >([]);
  const [contextMenuFavoritesPickerOpen, setContextMenuFavoritesPickerOpen] =
    useState(false);
  const [activeTableColType, setActiveTableColType] = useState<TableColumnType>("text");
  const [slashMenu, setSlashMenu] = useState<SlashMenuState>({
    open: false,
    query: "",
    x: 0,
    y: 0,
    index: 0,
    range: null,
    items: [],
  });
  const [mentionMenu, setMentionMenu] = useState<MentionMenuState>({
    open: false,
    query: "",
    x: 0,
    y: 0,
    index: 0,
    range: null,
    items: [],
    loading: false,
  });
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const contextMenuRef = useRef<HTMLDivElement | null>(null);
  const slashMenuRef = useRef<HTMLDivElement | null>(null);
  const mentionMenuRef = useRef<HTMLDivElement | null>(null);
  const slashMenuStateRef = useRef<SlashMenuState>(slashMenu);
  const mentionMenuStateRef = useRef<MentionMenuState>(mentionMenu);
  const mentionFetchAbortRef = useRef<AbortController | null>(null);
  const mentionFetchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mentionRequestIdRef = useRef(0);
  const editorRef = useRef<Editor | null>(null);
  const taskInsertSelectionRef = useRef<TaskInsertSelection | null>(null);
  const lastTaskSelectionRef = useRef<TaskInsertSelection | null>(null);
  const lastTaskSelectionAtRef = useRef(0);
  const editorSurfaceRef = useRef<HTMLDivElement | null>(null);
  const taskTitleRef = useRef<HTMLInputElement | null>(null);
  const attachmentInputRef = useRef<HTMLInputElement | null>(null);
  const taskHoverOpenTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const taskHoverCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const taskHoverLinkRef = useRef<HTMLAnchorElement | null>(null);
  const taskHoverCacheRef = useRef<Record<string, TaskHoverSummary>>({});
  const taskHoverRequestIdRef = useRef(0);
  const [zoomPercent, setZoomPercent] = useState(100);
  const [saveError, setSaveError] = useState("");
  const [defaultFontFamilyLabel, setDefaultFontFamilyLabel] = useState("Arial");
  const [defaultFontSizeLabel, setDefaultFontSizeLabel] = useState("14");

  const [taskCreator, setTaskCreator] = useState<{
    open: boolean;
    title: string;
    dueDate: string;
    dueTime: string;
    assignToMe: boolean;
    error: string;
  }>({
    open: false,
    title: "",
    dueDate: "",
    dueTime: "",
    assignToMe: true,
    error: "",
  });

  const [taskToast, setTaskToast] = useState<{ taskId: string; title: string } | null>(
    null
  );
  const [taskHover, setTaskHover] = useState<TaskHoverState>({
    open: false,
    taskId: null,
    x: 0,
    y: 0,
    loading: false,
    error: "",
    data: null,
  });
  const [copiedFormat, setCopiedFormat] = useState<CopiedFormatSnapshot | null>(null);

  useEffect(() => {
    slashMenuStateRef.current = slashMenu;
  }, [slashMenu]);

  useEffect(() => {
    mentionMenuStateRef.current = mentionMenu;
  }, [mentionMenu]);

  useEffect(() => {
    if (contextMenuMode !== "favorites") {
      setContextMenuFavorites([]);
      return;
    }
    try {
      const stored = window.localStorage.getItem(CONTEXT_MENU_FAVORITES_STORAGE_KEY);
      if (!stored) {
        setContextMenuFavorites([]);
        return;
      }
      const parsed = JSON.parse(stored) as unknown;
      const nextFavorites = Array.isArray(parsed)
        ? parsed
            .map((value) => String(value || "").trim())
            .filter((value): value is ContextMenuFavoriteActionId =>
              CONTEXT_MENU_FAVORITE_ACTION_ID_SET.has(value as ContextMenuFavoriteActionId)
            )
        : [];
      setContextMenuFavorites(Array.from(new Set(nextFavorites)));
    } catch {
      setContextMenuFavorites([]);
    }
  }, [contextMenuMode]);

  useEffect(() => {
    if (contextMenuMode !== "favorites") {
      return;
    }
    try {
      window.localStorage.setItem(
        CONTEXT_MENU_FAVORITES_STORAGE_KEY,
        JSON.stringify(contextMenuFavorites)
      );
    } catch {
      // Ignore storage failures (private mode, quota, etc.).
    }
  }, [contextMenuFavorites, contextMenuMode]);

  const closeSlashMenu = useCallback(() => {
    setSlashMenu((prev) =>
      prev.open
        ? { ...prev, open: false, query: "", items: [], range: null, index: 0 }
        : prev
    );
  }, []);

  const closeMentionMenu = useCallback(() => {
    if (mentionFetchTimerRef.current) {
      clearTimeout(mentionFetchTimerRef.current);
      mentionFetchTimerRef.current = null;
    }
    if (mentionFetchAbortRef.current) {
      mentionFetchAbortRef.current.abort();
      mentionFetchAbortRef.current = null;
    }
    setMentionMenu((prev) =>
      prev.open
        ? {
            ...prev,
            open: false,
            query: "",
            items: [],
            range: null,
            index: 0,
            loading: false,
          }
        : prev
    );
  }, []);

  const closeContextMenu = useCallback(() => {
    setContextMenuFavoritesPickerOpen(false);
    setContextMenu((prev) => (prev.open ? { ...prev, open: false } : prev));
  }, []);

  const closeTaskCreator = useCallback(() => {
    taskInsertSelectionRef.current = null;
    setTaskCreator((prev) => (prev.open ? { ...prev, open: false, error: "" } : prev));
  }, []);

  const openTaskCreator = useCallback(
    (prefillTitle = "", options?: { useLastSelection?: boolean }) => {
      if (!onCreateTask) {
        return;
      }

      const currentEditor = editorRef.current;
      let nextTaskSelection: TaskInsertSelection | null = null;
      if (currentEditor) {
        const { from, to, empty } = currentEditor.state.selection;
        if (!empty && to > from) {
          nextTaskSelection = {
            from,
            to,
            text: normalizeInlineText(currentEditor.state.doc.textBetween(from, to, " ")),
          };
        }
      }

      if (!nextTaskSelection && options?.useLastSelection !== false) {
        const ageMs = Date.now() - lastTaskSelectionAtRef.current;
        if (ageMs >= 0 && ageMs <= 10_000 && lastTaskSelectionRef.current) {
          nextTaskSelection = { ...lastTaskSelectionRef.current };
        }
      }

      taskInsertSelectionRef.current = nextTaskSelection;

      closeContextMenu();
      closeSlashMenu();
      closeMentionMenu();
      setTaskCreator({
        open: true,
        title: nextTaskSelection?.text || prefillTitle,
        dueDate: "",
        dueTime: "",
        assignToMe: true,
        error: "",
      });
    },
    [onCreateTask, closeContextMenu, closeSlashMenu, closeMentionMenu]
  );

  const slashCommands = useMemo(() => {
    if (!onCreateTask) {
      return SLASH_COMMANDS;
    }

    const taskCommand: SlashCommand = {
      id: "task",
      label: "Task",
      description: "Create a task from your note.",
      keywords: ["task", "todo", "action", "action item"],
      run: (editor, range) => {
        editor.chain().focus().deleteRange(range).run();
        openTaskCreator(getSuggestedTaskTitle(editor), { useLastSelection: false });
      },
    };

    return [...SLASH_COMMANDS, taskCommand];
  }, [onCreateTask, openTaskCreator]);

  const applySlashCommand = useCallback(
    (command: SlashCommand, range: SlashRange) => {
      const currentEditor = editorRef.current;
      if (!currentEditor) {
        return;
      }
      command.run(currentEditor, range);
      closeSlashMenu();
    },
    [closeSlashMenu]
  );

  const applyMentionSuggestion = useCallback(
    (item: MentionSuggestion, range: SlashRange) => {
      const currentEditor = editorRef.current;
      if (!currentEditor) {
        return;
      }
      const handle = normalizeMentionHandle(item.handle);
      if (!handle) {
        return;
      }
      currentEditor
        .chain()
        .focus()
        .insertContentAt(range, {
          type: "text",
          text: `@${handle} `,
        })
        .run();
      closeMentionMenu();
    },
    [closeMentionMenu]
  );

  const updateMentionMenu = useCallback(
    (editor: Editor) => {
      const match = getMentionMatch(editor);
      if (!match) {
        if (mentionMenuStateRef.current.open) {
          closeMentionMenu();
        }
        return;
      }

      const coords = editor.view.coordsAtPos(match.range.to);
      setMentionMenu((prev) => {
        const queryChanged = prev.query !== match.query;
        const nextIndex = prev.items.length
          ? Math.min(queryChanged ? 0 : prev.index, Math.max(prev.items.length - 1, 0))
          : 0;
        return {
          open: true,
          query: match.query,
          x: coords.left,
          y: coords.bottom + 6,
          index: nextIndex,
          range: match.range,
          items: queryChanged ? [] : prev.items,
          loading: queryChanged || prev.loading,
        };
      });
    },
    [closeMentionMenu]
  );

  const handleEditorKeyDown = useCallback(
    (_view: unknown, event: KeyboardEvent) => {
      const mention = mentionMenuStateRef.current;
      if (mention.open) {
        if (event.key === "ArrowDown") {
          event.preventDefault();
          setMentionMenu((prev) => {
            if (!prev.items.length) return prev;
            return {
              ...prev,
              index: (prev.index + 1) % prev.items.length,
            };
          });
          return true;
        }

        if (event.key === "ArrowUp") {
          event.preventDefault();
          setMentionMenu((prev) => {
            if (!prev.items.length) return prev;
            return {
              ...prev,
              index: (prev.index - 1 + prev.items.length) % prev.items.length,
            };
          });
          return true;
        }

        if (event.key === "Enter" || event.key === "Tab") {
          if (mention.items.length && mention.range) {
            event.preventDefault();
            const item = mention.items[mention.index] || mention.items[0];
            applyMentionSuggestion(item, mention.range);
            return true;
          }
        }

        if (event.key === "Escape") {
          event.preventDefault();
          closeMentionMenu();
          return true;
        }
      }

      const menu = slashMenuStateRef.current;
      if (!menu.open) {
        return false;
      }

      if (event.key === "ArrowDown") {
        event.preventDefault();
        setSlashMenu((prev) => {
          if (!prev.items.length) {
            return prev;
          }
          return {
            ...prev,
            index: (prev.index + 1) % prev.items.length,
          };
        });
        return true;
      }

      if (event.key === "ArrowUp") {
        event.preventDefault();
        setSlashMenu((prev) => {
          if (!prev.items.length) {
            return prev;
          }
          return {
            ...prev,
            index: (prev.index - 1 + prev.items.length) % prev.items.length,
          };
        });
        return true;
      }

      if (event.key === "Enter") {
        if (menu.items.length && menu.range) {
          event.preventDefault();
          const command = menu.items[menu.index] || menu.items[0];
          applySlashCommand(command, menu.range);
          return true;
        }
      }

      if (event.key === "Escape") {
        event.preventDefault();
        closeSlashMenu();
        return true;
      }

      return false;
    },
    [applyMentionSuggestion, applySlashCommand, closeMentionMenu, closeSlashMenu]
  );

  const updateSlashMenu = useCallback(
    (editor: Editor) => {
      const match = getSlashMatch(editor);
      if (!match) {
        if (slashMenuStateRef.current.open) {
          closeSlashMenu();
        }
        return;
      }

      const items = filterSlashCommands(slashCommands, match.query);
      const coords = editor.view.coordsAtPos(match.range.from);
      setSlashMenu((prev) => {
        const queryChanged = prev.query !== match.query;
        const nextIndex = items.length
          ? Math.min(queryChanged ? 0 : prev.index, items.length - 1)
          : 0;
        return {
          open: true,
          query: match.query,
          x: coords.left,
          y: coords.bottom + 6,
          index: nextIndex,
          range: match.range,
          items,
        };
      });
    },
    [closeSlashMenu, slashCommands]
  );

  useEffect(() => {
    if (!mentionMenu.open) {
      return;
    }

    const query = mentionMenu.query.trim().toLowerCase();

    if (mentionFetchTimerRef.current) {
      clearTimeout(mentionFetchTimerRef.current);
      mentionFetchTimerRef.current = null;
    }
    if (mentionFetchAbortRef.current) {
      mentionFetchAbortRef.current.abort();
      mentionFetchAbortRef.current = null;
    }

    mentionFetchTimerRef.current = setTimeout(() => {
      const requestId = mentionRequestIdRef.current + 1;
      mentionRequestIdRef.current = requestId;
      const controller = new AbortController();
      mentionFetchAbortRef.current = controller;

      const params = new URLSearchParams();
      params.set("limit", "8");
      if (query) {
        params.set("q", query);
      }

      void fetch(`/api/mentions/suggestions?${params.toString()}`, {
        cache: "no-store",
        signal: controller.signal,
      })
        .then(async (response) => {
          const payload = (await response.json().catch(() => ({}))) as {
            items?: MentionSuggestion[];
            error?: string;
          };
          if (!response.ok) {
            throw new Error(payload.error || "Unable to load mentions");
          }
          if (mentionRequestIdRef.current !== requestId) {
            return;
          }

          const nextItems = Array.isArray(payload.items)
            ? payload.items
                .map((item) => ({
                  id: String(item.id || ""),
                  handle: normalizeMentionHandle(String(item.handle || "")),
                  full_name: item.full_name ? String(item.full_name) : null,
                  email: item.email ? String(item.email) : null,
                }))
                .filter((item) => item.id && item.handle)
            : [];

          setMentionMenu((prev) => {
            if (!prev.open || prev.query.trim().toLowerCase() !== query) {
              return prev;
            }
            const nextIndex = nextItems.length
              ? Math.min(prev.index, nextItems.length - 1)
              : 0;
            return {
              ...prev,
              items: nextItems,
              index: nextIndex,
              loading: false,
            };
          });
        })
        .catch((error: unknown) => {
          if (controller.signal.aborted || mentionRequestIdRef.current !== requestId) {
            return;
          }
          console.error(
            "[noteEditor.mentions.fetch]",
            error instanceof Error ? error.message : String(error)
          );
          setMentionMenu((prev) => (prev.open ? { ...prev, items: [], loading: false } : prev));
        });
    }, 110);

    return () => {
      if (mentionFetchTimerRef.current) {
        clearTimeout(mentionFetchTimerRef.current);
        mentionFetchTimerRef.current = null;
      }
      if (mentionFetchAbortRef.current) {
        mentionFetchAbortRef.current.abort();
        mentionFetchAbortRef.current = null;
      }
    };
  }, [mentionMenu.open, mentionMenu.query]);

  const handlePaste = useCallback((_view: unknown, event: ClipboardEvent) => {
    const clipboard = event.clipboardData;
    if (!clipboard) {
      return false;
    }

    const pastedText = clipboard.getData("text/plain").trim();
    if (pastedText && isPersonalPathLink(pastedText)) {
      event.preventDefault();
      editorRef.current
        ?.chain()
        .focus()
        .insertContent({
          type: "text",
          text: pastedText,
          marks: [{ type: "link", attrs: { href: pastedText } }],
        })
        .run();
      return true;
    }

    const imageItems = Array.from(clipboard.items || []).filter((item) =>
      item.type.startsWith("image/")
    );

    if (!imageItems.length) {
      return false;
    }

    event.preventDefault();

    void (async () => {
      for (const item of imageItems) {
        const file = item.getAsFile();
        if (!file) {
          continue;
        }
        try {
          const src = await optimizeImageForInlineInsert(file);
          editorRef.current?.chain().focus().setImage({ src }).run();
        } catch (error) {
          const message =
            error instanceof Error ? error.message : "Unable to paste image.";
          window.alert(message);
        }
      }
    })();

    return true;
  }, []);

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
      }),
      Highlight,
      Underline,
      TextStyle,
      FontSize,
      FontFamily.configure({
        types: ["textStyle"],
      }),
      TextAlign.configure({
        types: ["heading", "paragraph", "blockquote"],
        alignments: ["left", "center", "right", "justify"],
      }),
      TaskList,
      TaskItem.configure({ nested: true }),
      FloatingImage.configure({ inline: false, allowBase64: true }),
      Table.configure({ resizable: true }),
      TableRow,
      TableHeader.extend({
        addAttributes() {
          return {
            ...this.parent?.(),
            colType: {
              default: "text",
              parseHTML: (element) => element.getAttribute("data-col-type") || "text",
              renderHTML: (attributes) =>
                attributes.colType ? { "data-col-type": attributes.colType } : {},
            },
          };
        },
      }),
      TableCell.extend({
        addAttributes() {
          return {
            ...this.parent?.(),
            colType: {
              default: "text",
              parseHTML: (element) => element.getAttribute("data-col-type") || "text",
              renderHTML: (attributes) =>
                attributes.colType ? { "data-col-type": attributes.colType } : {},
            },
          };
        },
      }),
      Link.configure({
        autolink: true,
        linkOnPaste: true,
        openOnClick: true,
        defaultProtocol: "https",
        HTMLAttributes: {
          rel: null,
          target: null,
        },
      }),
      Placeholder.configure({
        placeholder,
      }),
    ],
    content: normalizeContent(initialContent),
    editorProps: {
      attributes: {
        class: "note-editor",
      },
      handleKeyDown: handleEditorKeyDown,
      handlePaste,
    },
    onUpdate: ({ editor }) => {
      updateSlashMenu(editor);
      updateMentionMenu(editor);
      const nextColType = getActiveTableColumnType(editor);
      setActiveTableColType((prev) => (prev === nextColType ? prev : nextColType));
      setSaveError((prev) => (prev ? "" : prev));
      if (saveTimer.current) {
        clearTimeout(saveTimer.current);
      }
      const json = editor.getJSON();
      saveTimer.current = setTimeout(() => {
        startTransition(() => {
          void onSave(entityId, json).catch((error: unknown) => {
            const message =
              error instanceof Error
                ? error.message
                : "Unable to save your changes.";
            setSaveError(message);
            console.error("[noteEditor.save]", message);
          });
        });
      }, 600);
    },
    onSelectionUpdate: ({ editor }) => {
      updateSlashMenu(editor);
      updateMentionMenu(editor);
      const nextColType = getActiveTableColumnType(editor);
      setActiveTableColType((prev) => (prev === nextColType ? prev : nextColType));
      const { from, to, empty } = editor.state.selection;
      if (!empty && to > from) {
        const selectedText = normalizeInlineText(editor.state.doc.textBetween(from, to, " "));
        if (selectedText) {
          lastTaskSelectionRef.current = { from, to, text: selectedText };
          lastTaskSelectionAtRef.current = Date.now();
        }
      }
    },
  });

  useEffect(() => {
    editorRef.current = editor;
  }, [editor]);

  useEffect(() => {
    if (!editor) {
      return;
    }
    const root = editor.view.dom as HTMLElement | null;
    if (!root) {
      return;
    }
    const styles = window.getComputedStyle(root);
    setDefaultFontFamilyLabel(normalizeFontFamilyLabel(styles.fontFamily));
    setDefaultFontSizeLabel(normalizeFontSizeLabel(styles.fontSize));
  }, [editor]);

  useEffect(() => {
    return () => {
      if (saveTimer.current) {
        clearTimeout(saveTimer.current);
      }
      if (taskHoverOpenTimerRef.current) {
        clearTimeout(taskHoverOpenTimerRef.current);
      }
      if (taskHoverCloseTimerRef.current) {
        clearTimeout(taskHoverCloseTimerRef.current);
      }
      if (mentionFetchTimerRef.current) {
        clearTimeout(mentionFetchTimerRef.current);
      }
      if (mentionFetchAbortRef.current) {
        mentionFetchAbortRef.current.abort();
      }
    };
  }, []);

  useEffect(() => {
    if (!taskCreator.open) {
      return;
    }
    const timer = window.setTimeout(() => taskTitleRef.current?.focus(), 0);
    return () => window.clearTimeout(timer);
  }, [taskCreator.open]);

  useEffect(() => {
    if (!taskToast) {
      return;
    }
    const timer = window.setTimeout(() => setTaskToast(null), 8000);
    return () => window.clearTimeout(timer);
  }, [taskToast]);

  useEffect(() => {
    if (!contextMenu.open) {
      return;
    }

    const handleClick = () => closeContextMenu();
    const handleEsc = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeContextMenu();
      }
    };
    window.addEventListener("click", handleClick);
    window.addEventListener("keydown", handleEsc);
    return () => {
      window.removeEventListener("click", handleClick);
      window.removeEventListener("keydown", handleEsc);
    };
  }, [contextMenu.open, closeContextMenu]);

  useEffect(() => {
    if (!slashMenu.open) {
      return;
    }

    const handleClick = (event: MouseEvent) => {
      if (slashMenuRef.current?.contains(event.target as Node)) {
        return;
      }
      closeSlashMenu();
    };

    window.addEventListener("click", handleClick);
    return () => {
      window.removeEventListener("click", handleClick);
    };
  }, [slashMenu.open, closeSlashMenu]);

  useEffect(() => {
    if (!mentionMenu.open) {
      return;
    }

    const handleClick = (event: MouseEvent) => {
      if (mentionMenuRef.current?.contains(event.target as Node)) {
        return;
      }
      closeMentionMenu();
    };

    window.addEventListener("click", handleClick);
    return () => {
      window.removeEventListener("click", handleClick);
    };
  }, [mentionMenu.open, closeMentionMenu]);

  useEffect(() => {
    if (!contextMenu.open || !contextMenuRef.current) {
      return;
    }

    const rect = contextMenuRef.current.getBoundingClientRect();
    const padding = 8;
    const maxLeft = window.innerWidth - rect.width - padding;
    const maxTop = window.innerHeight - rect.height - padding;
    const nextLeft = Math.max(padding, Math.min(contextMenu.x, maxLeft));
    const nextTop = Math.max(padding, Math.min(contextMenu.y, maxTop));

    if (nextLeft !== contextMenu.x || nextTop !== contextMenu.y) {
      setContextMenu((prev) =>
        prev.open ? { ...prev, x: nextLeft, y: nextTop } : prev
      );
    }
  }, [contextMenu.open, contextMenu.x, contextMenu.y]);

  useEffect(() => {
    if (!slashMenu.open || !slashMenuRef.current) {
      return;
    }

    const rect = slashMenuRef.current.getBoundingClientRect();
    const padding = 8;
    const maxLeft = window.innerWidth - rect.width - padding;
    const maxTop = window.innerHeight - rect.height - padding;
    const nextLeft = Math.max(padding, Math.min(slashMenu.x, maxLeft));
    const nextTop = Math.max(padding, Math.min(slashMenu.y, maxTop));

    if (nextLeft !== slashMenu.x || nextTop !== slashMenu.y) {
      setSlashMenu((prev) =>
        prev.open ? { ...prev, x: nextLeft, y: nextTop } : prev
      );
    }
  }, [slashMenu.open, slashMenu.x, slashMenu.y]);

  useEffect(() => {
    if (!mentionMenu.open || !mentionMenuRef.current) {
      return;
    }

    const rect = mentionMenuRef.current.getBoundingClientRect();
    const padding = 8;
    const maxLeft = window.innerWidth - rect.width - padding;
    const maxTop = window.innerHeight - rect.height - padding;
    const nextLeft = Math.max(padding, Math.min(mentionMenu.x, maxLeft));
    const nextTop = Math.max(padding, Math.min(mentionMenu.y, maxTop));

    if (nextLeft !== mentionMenu.x || nextTop !== mentionMenu.y) {
      setMentionMenu((prev) =>
        prev.open ? { ...prev, x: nextLeft, y: nextTop } : prev
      );
    }
  }, [mentionMenu.open, mentionMenu.x, mentionMenu.y]);

  const handleContextMenu = useCallback(
    (event: ReactMouseEvent) => {
      event.preventDefault();

      const target = event.target as HTMLElement | null;
      const inTable = Boolean(target?.closest("table"));

      if (editor) {
        if (editor.state.selection.empty) {
          const pos = editor.view.posAtCoords({
            left: event.clientX,
            top: event.clientY,
          });
          if (pos) {
            editor.chain().focus().setTextSelection(pos.pos).run();
          } else {
            editor.commands.focus();
          }
        } else {
          editor.commands.focus();
        }
      }

      setContextMenuFavoritesPickerOpen(false);
      setContextMenu({
        open: true,
        x: event.clientX,
        y: event.clientY,
        inTable,
      });
    },
    [editor]
  );

  const run = useCallback(
    (command: () => void) => {
      if (!editor) {
        return;
      }
      command();
      closeContextMenu();
      editor.commands.focus();
    },
    [editor, closeContextMenu]
  );

  const toggleContextMenuFavorite = useCallback((actionId: ContextMenuFavoriteActionId) => {
    setContextMenuFavorites((prev) => {
      if (prev.includes(actionId)) {
        return prev.filter((current) => current !== actionId);
      }
      return [...prev, actionId];
    });
  }, []);

  const favoriteContextActions = useMemo(
    () =>
      CONTEXT_MENU_FAVORITE_ACTIONS.filter((action) =>
        contextMenuFavorites.includes(action.id)
      ),
    [contextMenuFavorites]
  );

  const executeContextMenuFavoriteAction = useCallback(
    (actionId: ContextMenuFavoriteActionId) => {
      if (!editor) {
        return;
      }
      if (
        (actionId === "addRowBefore" ||
          actionId === "addRowAfter" ||
          actionId === "addColumnBefore" ||
          actionId === "addColumnAfter" ||
          actionId === "deleteRow" ||
          actionId === "deleteColumn" ||
          actionId === "deleteTable") &&
        !contextMenu.inTable
      ) {
        return;
      }

      if (actionId === "paragraph") {
        run(() => editor.chain().focus().setParagraph().run());
        return;
      }
      if (actionId === "heading1") {
        run(() => editor.chain().focus().toggleHeading({ level: 1 }).run());
        return;
      }
      if (actionId === "heading2") {
        run(() => editor.chain().focus().toggleHeading({ level: 2 }).run());
        return;
      }
      if (actionId === "bulletList") {
        run(() => editor.chain().focus().toggleBulletList().run());
        return;
      }
      if (actionId === "orderedList") {
        run(() => editor.chain().focus().toggleOrderedList().run());
        return;
      }
      if (actionId === "checklist") {
        run(() => editor.chain().focus().toggleTaskList().run());
        return;
      }
      if (actionId === "quote") {
        run(() => editor.chain().focus().toggleBlockquote().run());
        return;
      }
      if (actionId === "insertTable") {
        run(() =>
          editor
            .chain()
            .focus()
            .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
            .run()
        );
        return;
      }
      if (actionId === "divider") {
        run(() => editor.chain().focus().setHorizontalRule().run());
        return;
      }
      if (actionId === "addRowBefore") {
        run(() => editor.chain().focus().addRowBefore().run());
        return;
      }
      if (actionId === "addRowAfter") {
        run(() => editor.chain().focus().addRowAfter().run());
        return;
      }
      if (actionId === "addColumnBefore") {
        run(() => editor.chain().focus().addColumnBefore().run());
        return;
      }
      if (actionId === "addColumnAfter") {
        run(() => editor.chain().focus().addColumnAfter().run());
        return;
      }
      if (actionId === "deleteRow") {
        run(() => editor.chain().focus().deleteRow().run());
        return;
      }
      if (actionId === "deleteColumn") {
        run(() => editor.chain().focus().deleteColumn().run());
        return;
      }
      if (actionId === "deleteTable") {
        run(() => editor.chain().focus().deleteTable().run());
      }
    },
    [contextMenu.inTable, editor, run]
  );

  const submitTask = useCallback(() => {
    if (!onCreateTask) {
      return;
    }

    const taskTitle = normalizeInlineText(taskCreator.title);
    const dueDate = (taskCreator.dueDate || "").trim() || null;
    const dueTime = (taskCreator.dueTime || "").trim() || null;

    if (!taskTitle) {
      setTaskCreator((prev) => ({ ...prev, error: "Task title is required" }));
      return;
    }

    if (dueTime && !dueDate) {
      setTaskCreator((prev) => ({ ...prev, error: "Choose a due date if you set a time" }));
      return;
    }

    startTaskTransition(() => {
      void onCreateTask({
        title: taskTitle,
        dueDate,
        dueTime,
        assignToMe: taskCreator.assignToMe,
      })
        .then((result) => {
          const currentEditor = editorRef.current;
          if (currentEditor) {
            const selection = taskInsertSelectionRef.current;
            const linkText = selection?.text || taskTitle;

            if (selection && selection.to > selection.from) {
              const maxPos = currentEditor.state.doc.content.size;
              const from = Math.max(0, Math.min(selection.from, maxPos));
              const to = Math.max(from, Math.min(selection.to, maxPos));

              currentEditor
                .chain()
                .focus()
                .insertContentAt(
                  { from, to },
                  {
                    type: "text",
                    text: linkText,
                    marks: [{ type: "link", attrs: { href: `/tasks/${result.taskId}` } }],
                  }
                )
                .run();
            } else {
              currentEditor
                .chain()
                .focus()
                .insertContent([
                  {
                    type: "text",
                    text: taskTitle,
                    marks: [{ type: "link", attrs: { href: `/tasks/${result.taskId}` } }],
                  },
                  { type: "text", text: " " },
                ])
                .run();
            }
          }
          taskInsertSelectionRef.current = null;
          setTaskToast({ taskId: result.taskId, title: taskTitle });
          setTaskCreator((prev) => ({ ...prev, open: false, error: "" }));
        })
        .catch((err: unknown) => {
          const message = err instanceof Error ? err.message : "Unable to create task";
          setTaskCreator((prev) => ({ ...prev, error: message }));
        });
    });
  }, [onCreateTask, startTaskTransition, taskCreator]);

  const closeTaskHover = useCallback(() => {
    taskHoverLinkRef.current = null;
    setTaskHover((prev) =>
      prev.open || prev.loading || prev.error || prev.data || prev.taskId
        ? {
            open: false,
            taskId: null,
            x: 0,
            y: 0,
            loading: false,
            error: "",
            data: null,
          }
        : prev
    );
  }, []);

  const scheduleTaskHoverClose = useCallback(() => {
    if (taskHoverCloseTimerRef.current) {
      clearTimeout(taskHoverCloseTimerRef.current);
    }
    taskHoverCloseTimerRef.current = setTimeout(() => {
      closeTaskHover();
    }, 120);
  }, [closeTaskHover]);

  const clearTaskHoverClose = useCallback(() => {
    if (taskHoverCloseTimerRef.current) {
      clearTimeout(taskHoverCloseTimerRef.current);
      taskHoverCloseTimerRef.current = null;
    }
  }, []);

  const fetchTaskHoverData = useCallback((taskId: string) => {
    const cached = taskHoverCacheRef.current[taskId];
    if (cached) {
      setTaskHover((prev) => ({
        ...prev,
        open: true,
        loading: false,
        error: "",
        data: cached,
      }));
      return;
    }

    const requestId = taskHoverRequestIdRef.current + 1;
    taskHoverRequestIdRef.current = requestId;
    setTaskHover((prev) => ({ ...prev, open: true, loading: true, error: "", data: null }));

    void fetch(`/api/tasks/${taskId}/hover`, { cache: "no-store" })
      .then(async (response) => {
        const payload = (await response.json().catch(() => ({}))) as
          | TaskHoverSummary
          | { error?: string };
        if (!response.ok) {
          throw new Error(
            typeof (payload as { error?: string }).error === "string"
              ? (payload as { error?: string }).error || "Unable to load task"
              : "Unable to load task"
          );
        }
        if (taskHoverRequestIdRef.current !== requestId) return;
        const task = payload as TaskHoverSummary;
        taskHoverCacheRef.current[taskId] = task;
        setTaskHover((prev) => ({
          ...prev,
          open: true,
          loading: false,
          error: "",
          data: task,
        }));
      })
      .catch((error: unknown) => {
        if (taskHoverRequestIdRef.current !== requestId) return;
        setTaskHover((prev) => ({
          ...prev,
          open: true,
          loading: false,
          error: error instanceof Error ? error.message : "Unable to load task",
          data: null,
        }));
      });
  }, []);

  const openTaskHoverForLink = useCallback(
    (link: HTMLAnchorElement) => {
      const href = link.getAttribute("href") || "";
      const taskId = extractTaskIdFromHref(href);
      if (!taskId) {
        scheduleTaskHoverClose();
        return;
      }
      clearTaskHoverClose();
      if (taskHoverOpenTimerRef.current) {
        clearTimeout(taskHoverOpenTimerRef.current);
      }
      taskHoverOpenTimerRef.current = setTimeout(() => {
        const rect = link.getBoundingClientRect();
        const popoverWidth = 300;
        const x = Math.max(
          12,
          Math.min(window.innerWidth - popoverWidth - 12, rect.left)
        );
        const y = Math.min(window.innerHeight - 170, rect.bottom + 8);
        taskHoverLinkRef.current = link;
        setTaskHover((prev) => ({ ...prev, taskId, x, y }));
        fetchTaskHoverData(taskId);
      }, 110);
    },
    [clearTaskHoverClose, fetchTaskHoverData, scheduleTaskHoverClose]
  );

  const handleEditorMouseMove = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      if (event.buttons !== 0) return;
      const selection = window.getSelection();
      if (selection && !selection.isCollapsed) {
        scheduleTaskHoverClose();
        return;
      }

      const target = event.target as HTMLElement | null;
      const link = target?.closest('a[href^="/tasks/"]') as HTMLAnchorElement | null;
      if (!link || !editorSurfaceRef.current?.contains(link)) {
        scheduleTaskHoverClose();
        return;
      }

      if (taskHoverLinkRef.current === link && taskHover.open) {
        const rect = link.getBoundingClientRect();
        const popoverWidth = 300;
        const x = Math.max(
          12,
          Math.min(window.innerWidth - popoverWidth - 12, rect.left)
        );
        const y = Math.min(window.innerHeight - 170, rect.bottom + 8);
        setTaskHover((prev) => ({ ...prev, x, y }));
        clearTaskHoverClose();
        return;
      }

      openTaskHoverForLink(link);
    },
    [clearTaskHoverClose, openTaskHoverForLink, scheduleTaskHoverClose, taskHover.open]
  );

  const markTaskHoverDone = useCallback(() => {
    const taskId = taskHover.taskId;
    if (!taskId) return;
    setTaskHover((prev) => ({ ...prev, loading: true, error: "" }));
    void fetch(`/api/tasks/${taskId}/hover`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "mark_done" }),
    })
      .then(async (response) => {
        const payload = (await response.json().catch(() => ({}))) as {
          ok?: boolean;
          status?: string;
          error?: string;
        };
        if (!response.ok || !payload.ok) {
          throw new Error(payload.error || "Unable to mark done");
        }
        setTaskHover((prev) => ({
          ...prev,
          loading: false,
          data: prev.data ? { ...prev.data, status: payload.status || "completed" } : prev.data,
        }));
        const cached = taskHoverCacheRef.current[taskId];
        if (cached) {
          taskHoverCacheRef.current[taskId] = { ...cached, status: payload.status || "completed" };
        }
      })
      .catch((error: unknown) => {
        setTaskHover((prev) => ({
          ...prev,
          loading: false,
          error: error instanceof Error ? error.message : "Unable to mark done",
        }));
      });
  }, [taskHover.taskId]);

  const setSelectedTableColumnsType = useCallback(
    (colType: TableColumnType) => {
      if (!editor) {
        return;
      }
      if (!editor.isActive("table")) {
        return;
      }

      let rect: ReturnType<typeof selectedRect> | null = null;
      try {
        rect = selectedRect(editor.state);
      } catch {
        rect = null;
      }
      if (!rect) {
        return;
      }

      const { map, tableStart, table } = rect;
      const tr = editor.state.tr;
      const left = rect.left;
      const right = rect.right;

      for (let col = left; col < right; col += 1) {
        const columnRect = { left: col, right: col + 1, top: 0, bottom: map.height };
        const cellOffsets = map.cellsInRect(columnRect);
        cellOffsets.forEach((offset) => {
          const pos = tableStart + offset;
          const node = tr.doc.nodeAt(pos);
          if (!node) {
            return;
          }
          tr.setNodeMarkup(pos, undefined, { ...node.attrs, colType });
        });
      }

      // Keep the table node reference in sync for table maps in follow-up ops.
      if (table && table.type) {
        // no-op placeholder; ensures we keep the variables used above intentional.
      }

      editor.view.dispatch(tr);
      editor.commands.focus();
    },
    [editor]
  );

  const editorScale = Math.max(0.2, zoomPercent / 100);

  const currentBlockStyle: WordBlockStyle = !editor
    ? "paragraph"
    : editor.isActive("heading", { level: 1 })
    ? "h1"
    : editor.isActive("heading", { level: 2 })
    ? "h2"
    : editor.isActive("heading", { level: 3 })
    ? "h3"
    : editor.isActive("blockquote")
    ? "quote"
    : "paragraph";

  const applyBlockStyle = useCallback(
    (nextStyle: WordBlockStyle) => {
      if (!editor) {
        return;
      }
      if (nextStyle === "h1") {
        editor.chain().focus().setHeading({ level: 1 }).run();
        return;
      }
      if (nextStyle === "h2") {
        editor.chain().focus().setHeading({ level: 2 }).run();
        return;
      }
      if (nextStyle === "h3") {
        editor.chain().focus().setHeading({ level: 3 }).run();
        return;
      }
      if (nextStyle === "quote") {
        editor.chain().focus().setBlockquote().run();
        return;
      }
      editor.chain().focus().setParagraph().run();
    },
    [editor]
  );

  const currentTextStyleAttrs = (editor?.getAttributes("textStyle") || {}) as {
    fontFamily?: string;
    fontSize?: string;
  };

  const currentFontFamily = String(currentTextStyleAttrs.fontFamily || "");
  const currentFontSize = String(currentTextStyleAttrs.fontSize || "");
  const currentTextAlign = getCurrentTextAlign(editor);
  const fontFamilyOptions = useMemo(
    () =>
      WORD_FONT_OPTIONS.filter(
        (font) =>
          font.label.toLowerCase() !== defaultFontFamilyLabel.toLowerCase()
      ),
    [defaultFontFamilyLabel]
  );
  const fontSizeOptions = useMemo(
    () =>
      WORD_FONT_SIZE_OPTIONS.filter(
        (size) => size.label !== defaultFontSizeLabel
      ),
    [defaultFontSizeLabel]
  );

  const setFontFamilyValue = useCallback(
    (nextFontFamily: string) => {
      if (!editor) {
        return;
      }
      if (nextFontFamily) {
        editor.chain().focus().setFontFamily(nextFontFamily).run();
      } else {
        editor.chain().focus().unsetFontFamily().run();
      }
    },
    [editor]
  );

  const setFontSizeValue = useCallback(
    (nextFontSize: string) => {
      if (!editor) {
        return;
      }
      if (nextFontSize) {
        editor.chain().focus().setFontSize(nextFontSize).run();
      } else {
        editor.chain().focus().unsetFontSize().run();
      }
    },
    [editor]
  );

  const setTextAlignValue = useCallback(
    (align: WordTextAlign) => {
      if (!editor) {
        return;
      }
      editor.chain().focus().setTextAlign(align).run();
    },
    [editor]
  );

  const copyFormatting = useCallback(() => {
    if (!editor) {
      return;
    }
    setCopiedFormat({
      blockStyle: currentBlockStyle,
      textAlign: currentTextAlign,
      fontFamily: currentFontFamily,
      fontSize: currentFontSize,
      bold: editor.isActive("bold"),
      italic: editor.isActive("italic"),
      underline: editor.isActive("underline"),
      highlight: editor.isActive("highlight"),
    });
  }, [
    editor,
    currentBlockStyle,
    currentTextAlign,
    currentFontFamily,
    currentFontSize,
  ]);

  const applyCopiedFormatting = useCallback(() => {
    if (!editor || !copiedFormat) {
      return;
    }
    applyBlockStyle(copiedFormat.blockStyle);
    setTextAlignValue(copiedFormat.textAlign);
    setFontFamilyValue(copiedFormat.fontFamily);
    setFontSizeValue(copiedFormat.fontSize);

    if (copiedFormat.bold) editor.chain().focus().setBold().run();
    else editor.chain().focus().unsetBold().run();
    if (copiedFormat.italic) editor.chain().focus().setItalic().run();
    else editor.chain().focus().unsetItalic().run();
    if (copiedFormat.underline) editor.chain().focus().setUnderline().run();
    else editor.chain().focus().unsetUnderline().run();
    if (copiedFormat.highlight) editor.chain().focus().setHighlight().run();
    else editor.chain().focus().unsetHighlight().run();
  }, [
    editor,
    copiedFormat,
    applyBlockStyle,
    setTextAlignValue,
    setFontFamilyValue,
    setFontSizeValue,
  ]);

  const setLinkFromPrompt = useCallback(() => {
    if (!editor) {
      return;
    }
    const currentHref = editor.getAttributes("link")?.href || "";
    const nextHref = window.prompt("Enter link URL", currentHref);
    if (nextHref === null) {
      return;
    }
    const trimmedHref = nextHref.trim();
    if (!trimmedHref) {
      editor.chain().focus().unsetLink().run();
      return;
    }
    editor.chain().focus().extendMarkRange("link").setLink({ href: trimmedHref }).run();
  }, [editor]);

  const insertImageFromPrompt = useCallback(() => {
    if (!editor) {
      return;
    }
    const src = window.prompt("Enter image URL");
    const trimmedSrc = String(src || "").trim();
    if (!trimmedSrc) {
      return;
    }
    editor.chain().focus().setImage({ src: trimmedSrc }).run();
  }, [editor]);

  const insertSectionBox = useCallback(() => {
    if (!editor) {
      return;
    }
    editor
      .chain()
      .focus()
      .insertContent({
        type: "blockquote",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "Section box" }],
          },
        ],
      })
      .run();
  }, [editor]);

  const clearFormatting = useCallback(() => {
    if (!editor) {
      return;
    }
    editor.chain().focus().unsetAllMarks().clearNodes().run();
  }, [editor]);

  const triggerAttachmentPicker = useCallback(() => {
    attachmentInputRef.current?.click();
  }, []);

  const handleAttachmentSelected = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      event.currentTarget.value = "";
      if (!file || !editor) {
        return;
      }
      if (file.size > 5 * 1024 * 1024) {
        window.alert("Attachment is too large. Use files up to 5 MB.");
        return;
      }
      void (async () => {
        if (file.type.startsWith("image/")) {
          try {
            const src = await optimizeImageForInlineInsert(file);
            editor.chain().focus().setImage({ src }).run();
          } catch (error) {
            const message =
              error instanceof Error ? error.message : "Unable to insert image.";
            window.alert(message);
          }
          return;
        }

        const result = await readBlobAsDataUrl(file);
        editor
          .chain()
          .focus()
          .insertContent({
            type: "paragraph",
            content: [
              {
                type: "text",
                text: file.name,
                marks: [{ type: "link", attrs: { href: result } }],
              },
            ],
          })
          .run();
      })();
    },
    [editor]
  );

  const bubbleActions = useMemo(() => {
    const actions = [
      {
        label: "B",
        active: editor?.isActive("bold"),
        onClick: () => editor?.chain().focus().toggleBold().run(),
      },
      {
        label: "I",
        active: editor?.isActive("italic"),
        onClick: () => editor?.chain().focus().toggleItalic().run(),
      },
      {
        label: "U",
        active: editor?.isActive("underline"),
        onClick: () => editor?.chain().focus().toggleUnderline().run(),
      },
      {
        label: "Highlight",
        active: editor?.isActive("highlight"),
        onClick: () => editor?.chain().focus().toggleHighlight().run(),
      },
      {
        label: "Bullet list",
        active: editor?.isActive("bulletList"),
        onClick: () => editor?.chain().focus().toggleBulletList().run(),
      },
      {
        label: "Numbered list",
        active: editor?.isActive("orderedList"),
        onClick: () => editor?.chain().focus().toggleOrderedList().run(),
      },
      {
        label: "Checklist",
        active: editor?.isActive("taskList"),
        onClick: () => editor?.chain().focus().toggleTaskList().run(),
      },
    ];

    if (editor?.isActive("image")) {
      const imageAttrs = editor.getAttributes("image") as { float?: string | null };
      const currentFloat = normalizeImageFloat(imageAttrs.float);
      actions.push(
        {
          label: "Float left",
          active: currentFloat === "left",
          onClick: () =>
            editor.chain().focus().updateAttributes("image", { float: "left" }).run(),
        },
        {
          label: "Float right",
          active: currentFloat === "right",
          onClick: () =>
            editor.chain().focus().updateAttributes("image", { float: "right" }).run(),
        },
        {
          label: "Inline",
          active: currentFloat === "none",
          onClick: () =>
            editor.chain().focus().updateAttributes("image", { float: "none" }).run(),
        }
      );
    }

    return actions;
  }, [editor]);

  const metaTooltip = useMemo(() => {
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
  }, [lastEditedAtLabel, lastEditedByLabel]);

  if (!editor) {
    return (
      <div className="rounded-lg border border-slate-200 bg-white p-6">
        <div className="h-[240px] animate-pulse rounded-md bg-slate-100" />
      </div>
    );
  }

  const activeSlashItem = slashMenu.items[slashMenu.index];
  const activeMentionItem = mentionMenu.items[mentionMenu.index];

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4" aria-label={title}>

      {taskToast ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-800">
          <span>
            Task created: <span className="font-semibold">{taskToast.title}</span>
          </span>
          <div className="flex items-center gap-3">
            <a
              href={`/tasks/${taskToast.taskId}`}
              target="_blank"
              rel="noreferrer"
              className="text-emerald-800 underline underline-offset-2 hover:text-emerald-900"
            >
              Open
            </a>
            <button
              type="button"
              onClick={() => setTaskToast(null)}
              className="text-xs font-semibold text-emerald-800 hover:text-emerald-900"
            >
              Dismiss
            </button>
          </div>
        </div>
      ) : null}

      {showTopToolbar ? (
        <div
          className={`sticky top-0 z-20 rounded-lg border border-slate-200 bg-white p-2 ${
            taskToast ? "mt-3" : ""
          }`}
        >
          <div className="mb-1.5 flex items-center border-b border-slate-200 px-1">
            <div className="flex items-center gap-1" role="tablist" aria-label="Editor tabs">
              {RIBBON_TABS.map((tab) => {
                const isActive = activeRibbonTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setActiveRibbonTab(tab.id)}
                    role="tab"
                    aria-selected={isActive}
                    className={`rounded-t-md border border-b-0 px-3 py-1 text-xs font-semibold transition ${
                      isActive
                        ? "border-slate-300 bg-white text-slate-900"
                        : "border-transparent bg-transparent text-slate-500 hover:text-slate-700"
                    }`}
                  >
                    {tab.label}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="-mx-1 overflow-x-auto px-1">
            <div className="flex min-w-max items-start gap-1.5">
              <RibbonGroup title="Clipboard">
                <RibbonIconButton
                  label="Copy style"
                  title="Copy formatting"
                  onClick={copyFormatting}
                  active={Boolean(copiedFormat)}
                  icon={<PaintIcon />}
                />
                <RibbonIconButton
                  label="Apply style"
                  title="Apply copied formatting"
                  onClick={applyCopiedFormatting}
                  disabled={!copiedFormat}
                  icon={<ApplyIcon />}
                />
                <RibbonIconButton
                  label="Clear"
                  title="Clear formatting"
                  onClick={clearFormatting}
                  icon={<ClearIcon />}
                />
              </RibbonGroup>

              <RibbonGroup title="Font">
                <select
                  value={currentBlockStyle}
                  onChange={(event) => applyBlockStyle(event.target.value as WordBlockStyle)}
                  className="h-7 w-[8rem] rounded-md border border-slate-300 bg-white px-2 text-[11px] text-slate-700"
                  title="Text style"
                >
                  <option value="paragraph">Paragraph</option>
                  <option value="h1">Heading 1</option>
                  <option value="h2">Heading 2</option>
                  <option value="h3">Heading 3</option>
                  <option value="quote">Callout / Quote</option>
                </select>
                <select
                  value={currentFontFamily}
                  onChange={(event) => setFontFamilyValue(event.target.value)}
                  className="h-7 w-[7.2rem] rounded-md border border-slate-300 bg-white px-2 text-[11px] text-slate-700"
                  title="Font family"
                >
                  <option value="">{defaultFontFamilyLabel}</option>
                  {fontFamilyOptions.map((font) => (
                    <option key={font.value} value={font.value}>
                      {font.label}
                    </option>
                  ))}
                </select>
                <select
                  value={currentFontSize}
                  onChange={(event) => setFontSizeValue(event.target.value)}
                  className="h-7 w-[3.8rem] rounded-md border border-slate-300 bg-white px-2 text-[11px] text-slate-700"
                  title="Font size"
                >
                  <option value="">{defaultFontSizeLabel}</option>
                  {fontSizeOptions.map((size) => (
                    <option key={size.value} value={size.value}>
                      {size.label}
                    </option>
                  ))}
                </select>
                <RibbonIconButton
                  label="Bold"
                  title="Bold"
                  onClick={() => editor.chain().focus().toggleBold().run()}
                  active={editor.isActive("bold")}
                  icon={<span className="text-[11px] font-black leading-none">B</span>}
                  iconOnly
                />
                <RibbonIconButton
                  label="Italic"
                  title="Italic"
                  onClick={() => editor.chain().focus().toggleItalic().run()}
                  active={editor.isActive("italic")}
                  icon={<span className="text-[11px] italic leading-none">I</span>}
                  iconOnly
                />
                <RibbonIconButton
                  label="Underline"
                  title="Underline"
                  onClick={() => editor.chain().focus().toggleUnderline().run()}
                  active={editor.isActive("underline")}
                  icon={<span className="text-[11px] underline leading-none">U</span>}
                  iconOnly
                />
                <RibbonIconButton
                  label="Highlight"
                  title="Highlight"
                  onClick={() => editor.chain().focus().toggleHighlight().run()}
                  active={editor.isActive("highlight")}
                  icon={<span className="h-2.5 w-2.5 rounded-sm bg-amber-300" />}
                  iconOnly
                />
              </RibbonGroup>

              <RibbonGroup title="Paragraph">
                <RibbonIconButton
                  label="Align left"
                  onClick={() => setTextAlignValue("left")}
                  active={currentTextAlign === "left"}
                  icon={<AlignIcon align="left" />}
                  iconOnly
                />
                <RibbonIconButton
                  label="Align center"
                  onClick={() => setTextAlignValue("center")}
                  active={currentTextAlign === "center"}
                  icon={<AlignIcon align="center" />}
                  iconOnly
                />
                <RibbonIconButton
                  label="Align right"
                  onClick={() => setTextAlignValue("right")}
                  active={currentTextAlign === "right"}
                  icon={<AlignIcon align="right" />}
                  iconOnly
                />
                <RibbonIconButton
                  label="Justify"
                  onClick={() => setTextAlignValue("justify")}
                  active={currentTextAlign === "justify"}
                  icon={<AlignIcon align="justify" />}
                  iconOnly
                />
                <RibbonIconButton
                  label="Bullets"
                  onClick={() => editor.chain().focus().toggleBulletList().run()}
                  active={editor.isActive("bulletList")}
                  icon={<ListBulletedIcon />}
                  iconOnly
                />
                <RibbonIconButton
                  label="Numbered"
                  onClick={() => editor.chain().focus().toggleOrderedList().run()}
                  active={editor.isActive("orderedList")}
                  icon={<ListNumberedIcon />}
                  iconOnly
                />
                <RibbonIconButton
                  label="Checklist"
                  onClick={() => editor.chain().focus().toggleTaskList().run()}
                  active={editor.isActive("taskList")}
                  icon={<ChecklistIcon />}
                  iconOnly
                />
              </RibbonGroup>

              <RibbonGroup title="Insert">
                {onCreateTask ? (
                  <RibbonIconButton
                    label="Task"
                    title="Create task"
                    onClick={() => openTaskCreator(getSuggestedTaskTitle(editor))}
                    icon={<span className="text-sm leading-none">+</span>}
                  />
                ) : null}
                <RibbonIconButton
                  label="Section"
                  onClick={insertSectionBox}
                  icon={<SectionIcon />}
                />
                <RibbonIconButton
                  label="Link"
                  onClick={setLinkFromPrompt}
                  icon={<LinkIcon />}
                />
                <RibbonIconButton
                  label="Image"
                  onClick={insertImageFromPrompt}
                  icon={<ImageIcon />}
                />
                <RibbonIconButton
                  label="File"
                  title="Attachment"
                  onClick={triggerAttachmentPicker}
                  icon={<AttachmentIcon />}
                />
                <RibbonIconButton
                  label="Table"
                  onClick={() =>
                    editor
                      .chain()
                      .focus()
                      .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
                      .run()
                  }
                  icon={<TableIcon />}
                />
              </RibbonGroup>

              <RibbonGroup title="History">
                <RibbonIconButton
                  label="Undo"
                  onClick={() => editor.chain().focus().undo().run()}
                  icon={<UndoIcon />}
                />
                <RibbonIconButton
                  label="Redo"
                  onClick={() => editor.chain().focus().redo().run()}
                  icon={<RedoIcon />}
                />
              </RibbonGroup>

              {editor.isActive("table") ? (
                <RibbonGroup title="Table">
                  <div className="w-full space-y-1">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                      Column type
                    </p>
                    <select
                      value={activeTableColType}
                      onChange={(event) =>
                        setSelectedTableColumnsType(event.target.value as TableColumnType)
                      }
                      className="h-7 w-full rounded-md border border-slate-300 bg-white px-2 text-[11px] text-slate-700"
                    >
                      {TABLE_COLUMN_TYPES.map((type) => (
                        <option key={type.id} value={type.id}>
                          {type.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </RibbonGroup>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      {saveError ? (
        <p className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {saveError}
        </p>
      ) : null}

      <div
        ref={editorSurfaceRef}
        className={showTopToolbar ? "mt-3" : "mt-4"}
        onContextMenu={handleContextMenu}
        onMouseMove={handleEditorMouseMove}
        onMouseLeave={() => scheduleTaskHoverClose()}
        title={metaTooltip || undefined}
      >
        <BubbleMenu
          editor={editor}
          className="rounded-md border border-slate-200 bg-white p-1 shadow-md"
        >
          <div className="flex flex-wrap items-center gap-1">
            {bubbleActions.map((action) => (
              <button
                key={action.label}
                type="button"
                onClick={action.onClick}
                className={`rounded-md px-2 py-1 text-xs font-medium ${
                  action.active
                    ? "bg-slate-900 text-white"
                    : "text-slate-600 hover:bg-slate-100"
                }`}
              >
                {action.label}
              </button>
            ))}
            {editor.isActive("table") ? (
              <label className="ml-1 flex items-center gap-2 rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-600">
                <span className="font-semibold text-slate-500">Column</span>
                <select
                  value={activeTableColType}
                  onChange={(event) =>
                    setSelectedTableColumnsType(event.target.value as TableColumnType)
                  }
                  className="bg-transparent text-xs text-slate-700 outline-none"
                >
                  {TABLE_COLUMN_TYPES.map((type) => (
                    <option key={type.id} value={type.id}>
                      {type.label}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
          </div>
        </BubbleMenu>
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white p-4">
          <div
            style={{
              transform: `scale(${editorScale})`,
              transformOrigin: "top left",
              width: `${100 / editorScale}%`,
            }}
          >
            <EditorContent editor={editor} />
          </div>
        </div>
      </div>
      <input
        ref={attachmentInputRef}
        type="file"
        className="hidden"
        onChange={handleAttachmentSelected}
      />

      {taskHover.open && taskHover.taskId ? (
        <div
          className="fixed z-[70] w-[300px] rounded-md border border-slate-200 bg-white p-3 shadow-xl"
          style={{ left: taskHover.x, top: taskHover.y }}
          onMouseEnter={clearTaskHoverClose}
          onMouseLeave={scheduleTaskHoverClose}
          onMouseDown={(event) => event.stopPropagation()}
        >
          {taskHover.loading ? (
            <p className="text-sm text-slate-500">Loading task...</p>
          ) : taskHover.error ? (
            <p className="text-sm text-red-600">{taskHover.error}</p>
          ) : taskHover.data ? (
            <div className="space-y-2">
              <p className="text-sm font-semibold text-slate-900">{taskHover.data.title}</p>
              <div className="grid grid-cols-[72px_1fr] gap-x-2 gap-y-1 text-xs">
                <span className="font-semibold uppercase tracking-wide text-slate-500">Status</span>
                <span className="text-slate-700">
                  {normalizeTaskStatusLabel(taskHover.data.status)}
                </span>
                <span className="font-semibold uppercase tracking-wide text-slate-500">Due</span>
                <span className="text-slate-700">
                  {taskHover.data.dueDate
                    ? `${new Date(taskHover.data.dueDate).toLocaleDateString("en-US")}${
                        taskHover.data.dueTime
                          ? ` ${taskHover.data.dueTime.slice(0, 5)}`
                          : ""
                      }`
                    : "No due date"}
                </span>
                <span className="font-semibold uppercase tracking-wide text-slate-500">Assignee</span>
                <span className="text-slate-700">{taskHover.data.assignee || "Unassigned"}</span>
              </div>
              <div className="flex items-center justify-end gap-2 pt-1">
                <a
                  href={`/tasks/${taskHover.taskId}`}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-md border border-slate-300 px-2.5 py-1 text-xs font-semibold text-slate-700 hover:border-slate-400 hover:text-slate-900"
                >
                  Open
                </a>
                <button
                  type="button"
                  onClick={markTaskHoverDone}
                  disabled={taskHover.data.status === "completed" || taskHover.loading}
                  className="rounded-md btn-primary px-2.5 py-1 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {taskHover.data.status === "completed" ? "Done" : "Mark done"}
                </button>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {enableZoomControls ? (
        <div className="fixed bottom-4 right-4 z-[60] flex items-center gap-1 rounded-lg border border-slate-200 bg-white p-1 shadow-lg">
          <button
            type="button"
            onClick={() => setZoomPercent((prev) => Math.max(20, prev - 10))}
            className="h-8 w-8 rounded-md border border-slate-300 text-sm font-semibold text-slate-700 hover:border-slate-400"
            aria-label="Zoom out"
          >
            -
          </button>
          <button
            type="button"
            onClick={() => setZoomPercent(100)}
            className="h-8 min-w-[3.8rem] rounded-md border border-slate-300 px-2 text-xs font-semibold text-slate-700 hover:border-slate-400"
            aria-label="Reset zoom"
          >
            {zoomPercent}%
          </button>
          <button
            type="button"
            onClick={() => setZoomPercent((prev) => Math.min(1000, prev + 10))}
            className="h-8 w-8 rounded-md border border-slate-300 text-sm font-semibold text-slate-700 hover:border-slate-400"
            aria-label="Zoom in"
          >
            +
          </button>
        </div>
      ) : null}

      {slashMenu.open ? (
        <div
          className="fixed z-50 w-72 rounded-md border border-slate-200 bg-white shadow-lg"
          style={{ top: slashMenu.y, left: slashMenu.x }}
          ref={slashMenuRef}
        >
          <div className="border-b border-slate-200 px-3 py-2 text-xs font-semibold uppercase text-slate-400">
            Slash commands
          </div>
          <div className="max-h-64 overflow-y-auto py-1">
            {slashMenu.items.length ? (
              slashMenu.items.map((item, index) => (
                <button
                  key={item.id}
                  type="button"
                  onMouseDown={(event) => event.preventDefault()}
                  onMouseEnter={() =>
                    setSlashMenu((prev) => ({ ...prev, index }))
                  }
                  onClick={() =>
                    slashMenu.range ? applySlashCommand(item, slashMenu.range) : null
                  }
                  className={`flex w-full items-start gap-2 px-3 py-2 text-left text-sm ${
                    index === slashMenu.index
                      ? "bg-slate-100 text-slate-900"
                      : "text-slate-700 hover:bg-slate-50"
                  }`}
                >
                  <span className="font-semibold">{item.label}</span>
                  <span className="text-xs text-slate-500">{item.description}</span>
                </button>
              ))
            ) : (
              <div className="px-3 py-2 text-xs text-slate-500">
                No commands match &quot;{slashMenu.query}&quot;.
              </div>
            )}
          </div>
          {activeSlashItem ? (
            <div className="border-t border-slate-200 px-3 py-2 text-xs text-slate-400">
              Tip: type to filter, use arrows then Enter to insert.
            </div>
          ) : null}
        </div>
      ) : null}

      {mentionMenu.open ? (
        <div
          className="fixed z-50 w-80 rounded-md border border-slate-200 bg-white shadow-lg"
          style={{ top: mentionMenu.y, left: mentionMenu.x }}
          ref={mentionMenuRef}
        >
          <div className="border-b border-slate-200 px-3 py-2 text-xs font-semibold uppercase text-slate-400">
            Mention someone
          </div>
          <div className="max-h-64 overflow-y-auto py-1">
            {mentionMenu.loading ? (
              <div className="px-3 py-2 text-xs text-slate-500">Loading people...</div>
            ) : mentionMenu.items.length ? (
              mentionMenu.items.map((item, index) => (
                <button
                  key={`${item.id}:${item.handle}`}
                  type="button"
                  onMouseDown={(event) => event.preventDefault()}
                  onMouseEnter={() =>
                    setMentionMenu((prev) => ({ ...prev, index }))
                  }
                  onClick={() =>
                    mentionMenu.range ? applyMentionSuggestion(item, mentionMenu.range) : null
                  }
                  className={`flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left ${
                    index === mentionMenu.index
                      ? "bg-slate-100 text-slate-900"
                      : "text-slate-700 hover:bg-slate-50"
                  }`}
                >
                  <span className="text-sm font-semibold">
                    {item.full_name || item.email || item.handle}
                  </span>
                  <span className="text-xs text-slate-500">
                    @{item.handle}
                    {item.email ? ` • ${item.email}` : ""}
                  </span>
                </button>
              ))
            ) : (
              <div className="px-3 py-2 text-xs text-slate-500">
                No matches for @{mentionMenu.query || "..."}
              </div>
            )}
          </div>
          {activeMentionItem ? (
            <div className="border-t border-slate-200 px-3 py-2 text-xs text-slate-400">
              Tip: use arrows and Enter (or Tab) to insert.
            </div>
          ) : null}
        </div>
      ) : null}

      {contextMenu.open ? (
        <div
          className={`fixed z-50 rounded-md border border-slate-200 bg-white p-1 shadow-lg ${
            contextMenuMode === "favorites" ? "w-64" : "w-56"
          }`}
          style={{ top: contextMenu.y, left: contextMenu.x }}
          ref={contextMenuRef}
        >
          {contextMenuMode === "favorites" ? (
            <>
              {onCreateTask ? (
                <>
                  <button
                    type="button"
                    onClick={() => openTaskCreator(getSuggestedTaskTitle(editor))}
                    className="context-menu-item font-semibold text-slate-900"
                  >
                    Create task
                  </button>
                  <div className="my-1 border-t border-slate-200" />
                </>
              ) : null}

              {favoriteContextActions.length ? (
                favoriteContextActions.map((action) => {
                  const disabled = Boolean(action.inTableOnly && !contextMenu.inTable);
                  return (
                    <button
                      key={action.id}
                      type="button"
                      disabled={disabled}
                      onClick={() => executeContextMenuFavoriteAction(action.id)}
                      className={`context-menu-item flex items-center justify-between disabled:cursor-not-allowed disabled:opacity-45 ${
                        action.destructive ? "text-red-600 hover:text-red-700" : ""
                      }`}
                    >
                      <span>{action.label}</span>
                      {action.inTableOnly ? (
                        <span className="text-[10px] uppercase tracking-wide text-slate-400">
                          Table
                        </span>
                      ) : null}
                    </button>
                  );
                })
              ) : (
                <p className="px-2 py-1 text-xs text-slate-500">
                  No favorites yet. Add commands below.
                </p>
              )}

              <div className="my-1 border-t border-slate-200" />
              <button
                type="button"
                onClick={() =>
                  setContextMenuFavoritesPickerOpen((prev) => !prev)
                }
                className="context-menu-item font-semibold text-slate-700"
              >
                {contextMenuFavoritesPickerOpen ? "Done editing favorites" : "Add favorite..."}
              </button>

              {contextMenuFavoritesPickerOpen ? (
                <div className="mt-1 max-h-56 overflow-y-auto rounded-md border border-slate-200 bg-slate-50 p-1">
                  {CONTEXT_MENU_FAVORITE_ACTIONS.map((action) => {
                    const isFavorite = contextMenuFavorites.includes(action.id);
                    return (
                      <button
                        key={`favorite-${action.id}`}
                        type="button"
                        onClick={() => toggleContextMenuFavorite(action.id)}
                        className="context-menu-item flex items-center justify-between"
                      >
                        <span className="truncate text-left">{action.label}</span>
                        <span
                          className={`ml-2 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                            isFavorite
                              ? "bg-slate-900 text-white"
                              : "bg-slate-200 text-slate-700"
                          }`}
                        >
                          {isFavorite ? "Added" : "Add"}
                        </span>
                      </button>
                    );
                  })}
                </div>
              ) : null}
            </>
          ) : (
            <>
              {onCreateTask ? (
                <>
                  <button
                    type="button"
                    onClick={() => openTaskCreator(getSuggestedTaskTitle(editor))}
                    className="context-menu-item font-semibold text-slate-900"
                  >
                    Create task
                  </button>
                  <div className="my-1 border-t border-slate-200" />
                </>
              ) : null}
              <button
                type="button"
                onClick={() => run(() => editor.chain().focus().setParagraph().run())}
                className="context-menu-item"
              >
                Paragraph
              </button>
              <button
                type="button"
                onClick={() =>
                  run(() => editor.chain().focus().toggleHeading({ level: 1 }).run())
                }
                className="context-menu-item"
              >
                Heading 1
              </button>
              <button
                type="button"
                onClick={() =>
                  run(() => editor.chain().focus().toggleHeading({ level: 2 }).run())
                }
                className="context-menu-item"
              >
                Heading 2
              </button>
              <button
                type="button"
                onClick={() => run(() => editor.chain().focus().toggleBulletList().run())}
                className="context-menu-item"
              >
                Bulleted list
              </button>
              <button
                type="button"
                onClick={() => run(() => editor.chain().focus().toggleOrderedList().run())}
                className="context-menu-item"
              >
                Numbered list
              </button>
              <button
                type="button"
                onClick={() => run(() => editor.chain().focus().toggleTaskList().run())}
                className="context-menu-item"
              >
                Checklist
              </button>
              <button
                type="button"
                onClick={() => run(() => editor.chain().focus().toggleBlockquote().run())}
                className="context-menu-item"
              >
                Quote / Callout
              </button>
              <button
                type="button"
                onClick={() =>
                  run(() =>
                    editor
                      .chain()
                      .focus()
                      .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
                      .run()
                  )
                }
                className="context-menu-item"
              >
                Insert table
              </button>
              {contextMenu.inTable ? (
                <>
                  <div className="my-1 border-t border-slate-200" />
                  <button
                    type="button"
                    onClick={() => run(() => editor.chain().focus().addRowBefore().run())}
                    className="context-menu-item"
                  >
                    Insert row above
                  </button>
                  <button
                    type="button"
                    onClick={() => run(() => editor.chain().focus().addRowAfter().run())}
                    className="context-menu-item"
                  >
                    Insert row below
                  </button>
                  <button
                    type="button"
                    onClick={() => run(() => editor.chain().focus().addColumnBefore().run())}
                    className="context-menu-item"
                  >
                    Insert column left
                  </button>
                  <button
                    type="button"
                    onClick={() => run(() => editor.chain().focus().addColumnAfter().run())}
                    className="context-menu-item"
                  >
                    Insert column right
                  </button>
                  <button
                    type="button"
                    onClick={() => run(() => editor.chain().focus().deleteRow().run())}
                    className="context-menu-item"
                  >
                    Delete row
                  </button>
                  <button
                    type="button"
                    onClick={() => run(() => editor.chain().focus().deleteColumn().run())}
                    className="context-menu-item"
                  >
                    Delete column
                  </button>
                  <button
                    type="button"
                    onClick={() => run(() => editor.chain().focus().deleteTable().run())}
                    className="context-menu-item text-red-600 hover:text-red-700"
                  >
                    Delete table
                  </button>
                </>
              ) : null}
              <button
                type="button"
                onClick={() => run(() => editor.chain().focus().setHorizontalRule().run())}
                className="context-menu-item"
              >
                Divider
              </button>
            </>
          )}
        </div>
      ) : null}

      {taskCreator.open ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/30 p-4"
          onMouseDown={() => closeTaskCreator()}
        >
          <div
            className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-5 shadow-xl"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Create task
                </p>
                <h3 className="text-lg font-semibold text-slate-900">New task</h3>
              </div>
              <button
                type="button"
                onClick={() => closeTaskCreator()}
                className="rounded-md border border-slate-200 px-2 py-1 text-xs font-semibold text-slate-600 hover:border-slate-300 hover:text-slate-900"
              >
                Close
              </button>
            </div>

            {taskCreator.error ? (
              <p className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {taskCreator.error}
              </p>
            ) : null}

            <form
              className="mt-4 space-y-3"
              onSubmit={(event) => {
                event.preventDefault();
                submitTask();
              }}
            >
              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-600">Title</label>
                <input
                  ref={taskTitleRef}
                  value={taskCreator.title}
                  onChange={(event) =>
                    setTaskCreator((prev) => ({ ...prev, title: event.target.value }))
                  }
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                  placeholder="Task title"
                  required
                />
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-slate-600">Due date</label>
                  <input
                    type="date"
                    value={taskCreator.dueDate}
                    onChange={(event) =>
                      setTaskCreator((prev) => ({ ...prev, dueDate: event.target.value }))
                    }
                    className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-slate-600">Time</label>
                  <input
                    type="time"
                    value={taskCreator.dueTime}
                    onChange={(event) =>
                      setTaskCreator((prev) => ({ ...prev, dueTime: event.target.value }))
                    }
                    className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
              </div>

              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={taskCreator.assignToMe}
                  onChange={(event) =>
                    setTaskCreator((prev) => ({ ...prev, assignToMe: event.target.checked }))
                  }
                  className="h-4 w-4 rounded border-slate-300"
                />
                Assign to me
              </label>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => closeTaskCreator()}
                  className="rounded-md border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:border-slate-400 hover:text-slate-900"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isTaskPending}
                  className="rounded-md btn-primary px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
                >
                  {isTaskPending ? "Creating..." : "Create task"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      <style jsx global>{`
        .note-editor a[href^="/tasks/"] {
          border-bottom: 1px solid #6366f1;
          background: rgba(99, 102, 241, 0.12);
          border-radius: 4px;
          padding: 0 2px;
          color: #3730a3;
          font-weight: 600;
          text-decoration: none;
          cursor: pointer;
        }
        .note-editor a[href^="/tasks/"]:hover {
          background: rgba(99, 102, 241, 0.2);
        }
      `}</style>
    </section>
  );
}
