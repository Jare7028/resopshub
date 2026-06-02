"use client";

import type { ChangeEvent, MouseEvent as ReactMouseEvent, ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import {
  Extension,
  mergeAttributes,
  Node as TiptapNode,
  type Editor,
} from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { EditorContent, useEditor } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import { createPortal } from "react-dom";
import StarterKit from "@tiptap/starter-kit";
import Highlight from "@tiptap/extension-highlight";
import Underline from "@tiptap/extension-underline";
import { FontSize, TextStyle } from "@tiptap/extension-text-style";
import FontFamily from "@tiptap/extension-font-family";
import TextAlign from "@tiptap/extension-text-align";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import Image, { type SetImageOptions } from "@tiptap/extension-image";
import Link from "@tiptap/extension-link";
import { Table, TableRow, TableHeader, TableCell } from "@tiptap/extension-table";
import Placeholder from "@tiptap/extension-placeholder";
import { selectedRect } from "prosemirror-tables";
import { getMentionRanges } from "@/lib/mentions";
import {
  countImageNodesBySrc,
  fillMissingImageSrcFromQueue,
  removeMissingSrcImageNodes,
  summarizeImageNodes,
} from "@/lib/imageNodeIntegrity";
import {
  ALLOWED_UPLOAD_IMAGE_TYPE_LABEL,
  getAllowedImageExtensionFromMimeType,
  isAllowedUploadImageMimeType,
} from "@/lib/imageUploadValidation";
import {
  getNextSaveVersion,
  hasActiveSaveCoordinatorWork,
  resolveSaveCompletion,
  shouldSurfaceSaveError,
} from "@/lib/noteSaveCoordinator";
import {
  logClientDebug,
  logClientError,
  logClientInfo,
  logClientWarn,
} from "@/lib/clientLogger";
import {
  cloneJsonValue,
  containsEphemeralImageSource,
  isEphemeralImageSource,
  isObjectRecord,
  isTiptapDocContent,
  mergeSaveWarnings,
  normalizeContent,
} from "@/lib/noteEditorContent";
import {
  getNextFontSizeValue,
  normalizeFontFamilyLabel,
  normalizeFontSizeLabel,
  normalizeImageFloat,
  WORD_FONT_OPTIONS,
  WORD_FONT_SIZE_OPTIONS,
} from "@/lib/noteEditorFormatting";
import {
  CONTEXT_MENU_FAVORITE_ACTIONS,
  CONTEXT_MENU_FAVORITES_STORAGE_KEY,
  normalizeContextMenuFavoriteIds,
  type ContextMenuFavoriteActionId,
} from "@/lib/noteEditorContextMenu";
import {
  NOTE_SHAPE_DEFAULT_FILL,
  NOTE_SHAPE_DEFAULT_STROKE,
  NOTE_SHAPE_INSERT_OPTIONS,
  NOTE_TEXTBOX_DEFAULT_HEIGHT,
  NOTE_TEXTBOX_DEFAULT_WIDTH,
  areNoteShapeAttrsEqual,
  areNoteTextBoxAttrsEqual,
  createOverlayObjectId,
  getDefaultShapeSize,
  getShapeSvgMarkup,
  normalizeNoteShapeAttrs,
  normalizeNoteTextBoxAttrs,
  type NoteShapeAttrs,
  type NoteShapeKind,
  type NoteTextBoxAttrs,
} from "@/lib/noteEditorOverlays";
import {
  extractTaskIdFromHref,
  normalizeInlineText,
  normalizeMentionHandle,
  normalizePastedLink,
  normalizeTaskStatusLabel,
  parseTimestampMs,
} from "@/lib/noteEditorInline";

type OverlayNodeType = "noteShape" | "noteTextBox";
type OverlayCommitResult = "saved" | "no_change" | "resolve_failed";
type OverlayResolveStrategy =
  | "known_pos"
  | "get_pos"
  | "dom"
  | "object_id"
  | "nearest_type"
  | "unresolved";
type OverlayCommitMeta = {
  nodeType: OverlayNodeType;
  objectId: string;
  result: OverlayCommitResult;
  resolvedPos: number | null;
};

type ContextMenuState = {
  open: boolean;
  x: number;
  y: number;
  inTable: boolean;
  overlayNodeType: OverlayNodeType | null;
  overlayNodePos: number | null;
};

export type ContextMenuMode = "full" | "favorites";

export type { ContextMenuFavoriteActionId } from "@/lib/noteEditorContextMenu";

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

export type NoteEditorClientProps = {
  entityId: string;
  initialContent: unknown;
  initialUpdatedAt?: string | null;
  liveContentSnapshot?: NoteLiveContentSnapshot | null;
  onLiveSnapshotApplied?: (updatedAt: string | null) => void;
  title: string;
  placeholder: string;
  onSave: (entityId: string, content: unknown) => Promise<NoteSaveResult | void>;
  onUploadImageFile?: (file: File) => Promise<string>;
  onCreateTask?: (input: {
    title: string;
    dueDate: string | null;
    dueTime: string | null;
    assignToMe: boolean;
  }) => Promise<{ taskId: string }>;
  lastEditedAtLabel?: string | null;
  lastEditedByLabel?: string | null;
  showTopToolbar?: boolean;
  adjacentToolbarTabs?: ReadonlyArray<{
    id: string;
    label: string;
    href?: string;
    active?: boolean;
    onSelect?: () => void;
  }>;
  toolbarPanel?: ReactNode;
  suppressToolbarGroups?: boolean;
  onRibbonTabSelect?: (tabId: RibbonTabId) => void;
  enableZoomControls?: boolean;
  disableHorizontalScroll?: boolean;
  blockNavigationWhileSaving?: boolean;
  contextMenuMode?: ContextMenuMode;
  initialContextMenuFavorites?: ContextMenuFavoriteActionId[];
  onSaveContextMenuFavorites?: (
    favorites: ContextMenuFavoriteActionId[]
  ) => Promise<void>;
  initialRibbonTab?: RibbonTabId;
  initialZoomPercent?: number;
  initialFocusMode?: boolean;
  editorHeightMode?: "default" | "fill";
  onViewStateChange?: (state: {
    ribbonTab: RibbonTabId;
    zoomPercent: number;
    focusMode: boolean;
  }) => Promise<void>;
  onFocusModeChange?: (focusMode: boolean) => void;
  debugImagePersistence?: boolean;
  enforceImageNodeIntegrity?: boolean;
};

export type NoteSaveResult = {
  content?: unknown;
  updatedAt?: string | null;
  warnings?: string[];
};

export type NoteLiveContentSnapshot = {
  content: unknown;
  updatedAt: string | null;
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

type FloatingMenuPosition = {
  x: number;
  y: number;
};

const MAX_INLINE_IMAGE_BYTES = 1_800_000;
const MAX_INLINE_IMAGE_DATA_URL_BYTES = 2_600_000;
const MAX_INLINE_IMAGE_DIMENSION = 1800;
const MIN_INLINE_IMAGE_DIMENSION = 640;
const NAVIGATION_SAVE_TIMEOUT_MS = 12000;
const IMAGE_COMPRESSION_QUALITIES = [0.9, 0.82, 0.74, 0.66, 0.58] as const;
const UPLOADED_IMAGE_SRC_QUEUE_LIMIT = 30;
const MISSING_IMAGE_SRC_SAVE_BLOCK_MESSAGE =
  "One or more images failed to attach. Please re-paste the image before leaving this page.";

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

type WordTextAlign = "left" | "center" | "right" | "justify";
type WordBlockStyle = "paragraph" | "h1" | "h2" | "h3" | "quote";
export type RibbonTabId = "home" | "insert" | "layout" | "review" | "view";

const NOTE_CRITICAL_SAVE_META_KEY = "note-critical-save";
const NOTE_OVERLAY_COMMIT_META_KEY = "note-overlay-commit";
const NOTE_OVERLAY_DEBUG_STORAGE_KEY = "note-editor:overlay-debug";
const NOTE_OVERLAY_SAVE_ERROR_MESSAGE = "Could not save object position. Move it again.";
const DRAFT_STORAGE_PREFIX = "note-editor-draft-v2:";
const MAX_UPLOADED_IMAGE_BYTES = 10 * 1024 * 1024;

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

function ShapeIcon() {
  return (
    <svg viewBox="0 0 14 14" className="h-3.5 w-3.5" aria-hidden="true">
      <rect x="1.8" y="2.2" width="5.2" height="4.4" rx="0.8" stroke="currentColor" strokeWidth="1" fill="none" />
      <circle cx="10.3" cy="9.2" r="2.1" stroke="currentColor" strokeWidth="1" fill="none" />
      <path d="M6.8 5.2h2.2M8.5 4.2l1.2 1-1.2 1" stroke="currentColor" strokeWidth="1" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function TextBoxIcon() {
  return (
    <svg viewBox="0 0 14 14" className="h-3.5 w-3.5" aria-hidden="true">
      <rect x="1.5" y="2.2" width="11" height="9.6" rx="1.1" stroke="currentColor" strokeWidth="1" fill="none" />
      <path d="M4.2 5.1h5.6M7 5.1v3.6" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
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

function getImageExtensionFromMimeType(mimeType: string) {
  const normalized = String(mimeType || "").trim().toLowerCase();
  return getAllowedImageExtensionFromMimeType(normalized) || "png";
}

function createImageFileFromBlob(blob: Blob, baseName = "pasted-image") {
  const normalizedMimeType = String(blob.type || "").toLowerCase();
  if (!isAllowedUploadImageMimeType(normalizedMimeType)) {
    throw new Error(`Unsupported image type. Use ${ALLOWED_UPLOAD_IMAGE_TYPE_LABEL}.`);
  }
  const extension = getImageExtensionFromMimeType(normalizedMimeType);
  return new File([blob], `${baseName}.${extension}`, {
    type: normalizedMimeType,
    lastModified: Date.now(),
  });
}

function extractImageSourcesFromHtml(htmlValue: string) {
  const html = String(htmlValue || "").trim();
  if (!html || typeof window === "undefined") {
    return [] as string[];
  }
  try {
    const parser = new window.DOMParser();
    const document = parser.parseFromString(html, "text/html");
    const sources = Array.from(document.querySelectorAll("img[src]"))
      .map((node) => String(node.getAttribute("src") || "").trim())
      .filter(Boolean);
    return Array.from(new Set(sources));
  } catch {
    return [] as string[];
  }
}

function extractSingleLinkFromHtml(htmlValue: string) {
  const html = String(htmlValue || "").trim();
  if (!html || typeof window === "undefined") {
    return null;
  }
  try {
    const parser = new window.DOMParser();
    const document = parser.parseFromString(html, "text/html");
    const links = Array.from(document.querySelectorAll("a[href]"));
    if (links.length !== 1) {
      return null;
    }
    const link = links[0];
    const normalizeText = (value: string) => value.replace(/\s+/g, " ").trim();
    const bodyText = normalizeText(document.body.textContent || "");
    const linkText = normalizeText(link.textContent || "");
    if (bodyText && linkText && bodyText !== linkText) {
      return null;
    }
    return normalizePastedLink(String(link.getAttribute("href") || "").trim());
  } catch {
    return null;
  }
}

function findTrailingMissingImageNodePos(editor: Editor) {
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

function getInsertShapeDefaults(editor: Editor, kind: NoteShapeKind) {
  const { width, height } = getDefaultShapeSize(kind);
  let existingShapeCount = 0;
  editor.state.doc.descendants((node) => {
    if (node.type.name === "noteShape") {
      existingShapeCount += 1;
    }
    return true;
  });

  const offset = (existingShapeCount % 6) * 18;
  let x = 24 + offset;
  let y = 24 + offset;
  try {
    const cursor = editor.view.coordsAtPos(editor.state.selection.from);
    const editorRect = editor.view.dom.getBoundingClientRect();
    const editorElement = editor.view.dom as HTMLElement;
    x = Math.max(8, Math.round(cursor.left - editorRect.left + editorElement.scrollLeft + offset));
    y = Math.max(8, Math.round(cursor.top - editorRect.top + editorElement.scrollTop + offset));
  } catch {
    // Keep fallback placement when selection coordinates are unavailable.
  }

  return normalizeNoteShapeAttrs({
    objectId: createOverlayObjectId(),
    kind,
    x,
    y,
    width,
    height,
    stroke: NOTE_SHAPE_DEFAULT_STROKE,
    fill: kind === "arrow" ? "transparent" : NOTE_SHAPE_DEFAULT_FILL,
    zIndex: 20 + existingShapeCount,
  });
}

function insertNoteShapeAtSelection(editor: Editor, kind: NoteShapeKind) {
  const attrs = getInsertShapeDefaults(editor, kind);
  editor
    .chain()
    .focus()
    .insertContent({
      type: "noteShape",
      attrs,
      content: [{ type: "paragraph", content: [{ type: "text", text: "Text" }] }],
    })
    .run();
}

function getInsertTextBoxDefaults(editor: Editor) {
  let existingTextBoxCount = 0;
  editor.state.doc.descendants((node) => {
    if (node.type.name === "noteTextBox") {
      existingTextBoxCount += 1;
    }
    return true;
  });

  const offset = (existingTextBoxCount % 6) * 20;
  let x = 24 + offset;
  let y = 24 + offset;
  try {
    const cursor = editor.view.coordsAtPos(editor.state.selection.from);
    const editorRect = editor.view.dom.getBoundingClientRect();
    const editorElement = editor.view.dom as HTMLElement;
    x = Math.max(8, Math.round(cursor.left - editorRect.left + editorElement.scrollLeft + offset));
    y = Math.max(8, Math.round(cursor.top - editorRect.top + editorElement.scrollTop + offset));
  } catch {
    // Keep fallback placement when selection coordinates are unavailable.
  }

  return normalizeNoteTextBoxAttrs({
    objectId: createOverlayObjectId(),
    x,
    y,
    width: NOTE_TEXTBOX_DEFAULT_WIDTH,
    height: NOTE_TEXTBOX_DEFAULT_HEIGHT,
    zIndex: 24 + existingTextBoxCount,
  });
}

function insertNoteTextBoxAtSelection(editor: Editor) {
  const attrs = getInsertTextBoxDefaults(editor);
  editor
    .chain()
    .focus()
    .insertContent({
      type: "noteTextBox",
      attrs,
      content: [{ type: "paragraph" }],
    })
    .run();
}

const NoteShape = TiptapNode.create({
  name: "noteShape",
  group: "block",
  content: "block*",
  isolating: true,
  defining: true,
  selectable: true,
  draggable: false,
  addAttributes() {
    return {
      objectId: { default: null },
      kind: { default: "rectangle" },
      x: { default: 24 },
      y: { default: 24 },
      width: { default: 150 },
      height: { default: 104 },
      stroke: { default: NOTE_SHAPE_DEFAULT_STROKE },
      fill: { default: NOTE_SHAPE_DEFAULT_FILL },
      zIndex: { default: 20 },
    };
  },
  parseHTML() {
    return [{ tag: "note-shape" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["note-shape", mergeAttributes(HTMLAttributes), 0];
  },
  addNodeView() {
    return ({ node, editor, getPos }) => {
      let persistedAttrs = normalizeNoteShapeAttrs(node.attrs as Record<string, unknown>);
      let currentAttrs = persistedAttrs;
      let activeDragFinalize: (() => void) | null = null;
      const dom = document.createElement("div");
      dom.className = "note-shape-node";

      const inner = document.createElement("div");
      inner.className = "note-shape-node-inner";
      const contentDOM = document.createElement("div");
      contentDOM.className = "note-shape-content";
      contentDOM.setAttribute("data-note-shape-content", "1");
      const dragHandle = document.createElement("button");
      dragHandle.type = "button";
      dragHandle.className = "note-shape-drag-handle";
      dragHandle.textContent = "Move";
      dragHandle.title = "Drag shape";
      dragHandle.contentEditable = "false";
      dragHandle.setAttribute("aria-label", "Drag shape");
      dragHandle.setAttribute("data-note-shape-drag", "1");
      const resizeHandle = document.createElement("button");
      resizeHandle.type = "button";
      resizeHandle.className = "note-shape-resize-handle";
      resizeHandle.contentEditable = "false";
      resizeHandle.setAttribute("aria-label", "Resize shape");
      resizeHandle.setAttribute("data-note-shape-resize", "1");

      dom.append(inner, contentDOM, dragHandle, resizeHandle);

      const applyToDom = (next: NoteShapeAttrs) => {
        currentAttrs = next;
        dom.style.left = `${next.x}px`;
        dom.style.top = `${next.y}px`;
        dom.style.width = `${next.width}px`;
        dom.style.height = `${next.height}px`;
        dom.style.zIndex = String(next.zIndex);
        dom.setAttribute("data-note-shape-object-id", next.objectId);
        dom.setAttribute("data-note-shape-kind", next.kind);
        inner.innerHTML = getShapeSvgMarkup(next);
      };

      const commitNodeAttrs = (next: NoteShapeAttrs) => {
        const committed = commitOverlayNodeAttrs<NoteShapeAttrs>({
          editor,
          nodeType: "noteShape",
          dom,
          getPos: typeof getPos === "function" ? getPos : undefined,
          fallbackObjectId: next.objectId,
          previousAttrs: persistedAttrs,
          nextAttrs: next,
          normalize: normalizeNoteShapeAttrs,
          equals: areNoteShapeAttrsEqual,
        });
        if (committed.result === "saved") {
          persistedAttrs = committed.normalizedNext;
        }
      };

      const bindPointerDrag = (
        startEvent: PointerEvent,
        onMove: (
          event: PointerEvent,
          startState: {
            attrs: NoteShapeAttrs;
            clientX: number;
            clientY: number;
          }
        ) => NoteShapeAttrs
      ) => {
        if (startEvent.button !== 0 && startEvent.button !== -1) {
          return null;
        }
        if (activeDragFinalize) {
          activeDragFinalize();
        }
        startEvent.preventDefault();
        startEvent.stopPropagation();
        const startState = {
          attrs: currentAttrs,
          clientX: startEvent.clientX,
          clientY: startEvent.clientY,
        };
        let liveAttrs = startState.attrs;
        let finished = false;

        const handleMove = (moveEvent: PointerEvent) => {
          moveEvent.preventDefault();
          liveAttrs = onMove(moveEvent, startState);
          applyToDom(liveAttrs);
        };

        const handleVisibilityChange = () => {
          if (document.visibilityState === "hidden") {
            finish();
          }
        };

        const detach = () => {
          window.removeEventListener("pointermove", handleMove);
          window.removeEventListener("pointerup", handleUp);
          window.removeEventListener("pointercancel", handleUp);
          window.removeEventListener("blur", handleUp);
          document.removeEventListener("visibilitychange", handleVisibilityChange);
          if (activeDragFinalize === finish) {
            activeDragFinalize = null;
          }
        };

        const finish = () => {
          if (finished) {
            return;
          }
          finished = true;
          detach();
          commitNodeAttrs(liveAttrs);
        };

        const handleUp = () => finish();
        activeDragFinalize = finish;

        window.addEventListener("pointermove", handleMove);
        window.addEventListener("pointerup", handleUp);
        window.addEventListener("pointercancel", handleUp);
        window.addEventListener("blur", handleUp);
        document.addEventListener("visibilitychange", handleVisibilityChange);

        applyToDom(startState.attrs);

        return startState;
      };

      const bindMouseDrag = (
        startEvent: MouseEvent,
        onMove: (
          event: MouseEvent,
          startState: {
            attrs: NoteShapeAttrs;
            clientX: number;
            clientY: number;
          }
        ) => NoteShapeAttrs
      ) => {
        if (startEvent.button !== 0) {
          return;
        }
        if (activeDragFinalize) {
          activeDragFinalize();
        }
        startEvent.preventDefault();
        startEvent.stopPropagation();
        const startState = {
          attrs: currentAttrs,
          clientX: startEvent.clientX,
          clientY: startEvent.clientY,
        };
        let liveAttrs = startState.attrs;
        let finished = false;

        const handleMove = (moveEvent: MouseEvent) => {
          moveEvent.preventDefault();
          liveAttrs = onMove(moveEvent, startState);
          applyToDom(liveAttrs);
        };

        const handleVisibilityChange = () => {
          if (document.visibilityState === "hidden") {
            finish();
          }
        };

        const detach = () => {
          window.removeEventListener("mousemove", handleMove);
          window.removeEventListener("mouseup", handleUp);
          window.removeEventListener("blur", handleUp);
          document.removeEventListener("visibilitychange", handleVisibilityChange);
          if (activeDragFinalize === finish) {
            activeDragFinalize = null;
          }
        };

        const finish = () => {
          if (finished) {
            return;
          }
          finished = true;
          detach();
          commitNodeAttrs(liveAttrs);
        };

        const handleUp = () => finish();
        activeDragFinalize = finish;

        window.addEventListener("mousemove", handleMove);
        window.addEventListener("mouseup", handleUp);
        window.addEventListener("blur", handleUp);
        document.addEventListener("visibilitychange", handleVisibilityChange);

        applyToDom(startState.attrs);
      };

      let ignoreMouseDownUntil = 0;

      const handleDragPointerDown = (event: PointerEvent) => {
        ignoreMouseDownUntil = Date.now() + 320;
        bindPointerDrag(event, (moveEvent, startState) => {
          const deltaX = moveEvent.clientX - startState.clientX;
          const deltaY = moveEvent.clientY - startState.clientY;
          return normalizeNoteShapeAttrs({
            ...startState.attrs,
            x: startState.attrs.x + deltaX,
            y: startState.attrs.y + deltaY,
          });
        });
      };

      const handleDragMouseDown = (event: MouseEvent) => {
        if (Date.now() < ignoreMouseDownUntil) {
          return;
        }
        bindMouseDrag(event, (moveEvent, startState) => {
          const deltaX = moveEvent.clientX - startState.clientX;
          const deltaY = moveEvent.clientY - startState.clientY;
          return normalizeNoteShapeAttrs({
            ...startState.attrs,
            x: startState.attrs.x + deltaX,
            y: startState.attrs.y + deltaY,
          });
        });
      };

      const handleResizePointerDown = (event: PointerEvent) => {
        ignoreMouseDownUntil = Date.now() + 320;
        bindPointerDrag(event, (moveEvent, startState) => {
          const deltaX = moveEvent.clientX - startState.clientX;
          const deltaY = moveEvent.clientY - startState.clientY;
          const nextRaw = {
            ...startState.attrs,
            width: startState.attrs.width + deltaX,
            height: startState.attrs.height + deltaY,
          };
          if (
            startState.attrs.kind === "square" ||
            startState.attrs.kind === "circle"
          ) {
            const squareSize = Math.max(nextRaw.width, nextRaw.height);
            nextRaw.width = squareSize;
            nextRaw.height = squareSize;
          }
          return normalizeNoteShapeAttrs(nextRaw);
        });
      };

      const handleResizeMouseDown = (event: MouseEvent) => {
        if (Date.now() < ignoreMouseDownUntil) {
          return;
        }
        bindMouseDrag(event, (moveEvent, startState) => {
          const deltaX = moveEvent.clientX - startState.clientX;
          const deltaY = moveEvent.clientY - startState.clientY;
          const nextRaw = {
            ...startState.attrs,
            width: startState.attrs.width + deltaX,
            height: startState.attrs.height + deltaY,
          };
          if (
            startState.attrs.kind === "square" ||
            startState.attrs.kind === "circle"
          ) {
            const squareSize = Math.max(nextRaw.width, nextRaw.height);
            nextRaw.width = squareSize;
            nextRaw.height = squareSize;
          }
          return normalizeNoteShapeAttrs(nextRaw);
        });
      };

      dragHandle.addEventListener("pointerdown", handleDragPointerDown);
      dragHandle.addEventListener("mousedown", handleDragMouseDown);
      resizeHandle.addEventListener("pointerdown", handleResizePointerDown);
      resizeHandle.addEventListener("mousedown", handleResizeMouseDown);
      applyToDom(persistedAttrs);

      return {
        dom,
        contentDOM,
        update(updatedNode) {
          if (updatedNode.type.name !== "noteShape") {
            return false;
          }
          persistedAttrs = normalizeNoteShapeAttrs(
            updatedNode.attrs as Record<string, unknown>
          );
          applyToDom(persistedAttrs);
          return true;
        },
        stopEvent(event) {
          const target = event.target as HTMLElement | null;
          if (!target) {
            return false;
          }
          return Boolean(
            target.closest("[data-note-shape-drag='1'], [data-note-shape-resize='1']")
          );
        },
        ignoreMutation(mutation) {
          if (mutation.type !== "attributes") {
            return false;
          }
          return (
            mutation.target === dom ||
            mutation.target === inner ||
            mutation.target === dragHandle ||
            mutation.target === resizeHandle
          );
        },
        destroy() {
          if (activeDragFinalize) {
            activeDragFinalize();
            activeDragFinalize = null;
          }
          dragHandle.removeEventListener("pointerdown", handleDragPointerDown);
          dragHandle.removeEventListener("mousedown", handleDragMouseDown);
          resizeHandle.removeEventListener("pointerdown", handleResizePointerDown);
          resizeHandle.removeEventListener("mousedown", handleResizeMouseDown);
        },
      };
    };
  },
});

const NoteTextBox = TiptapNode.create({
  name: "noteTextBox",
  group: "block",
  content: "block+",
  isolating: true,
  defining: true,
  draggable: false,
  addAttributes() {
    return {
      objectId: { default: null },
      x: { default: 24 },
      y: { default: 24 },
      width: { default: NOTE_TEXTBOX_DEFAULT_WIDTH },
      height: { default: NOTE_TEXTBOX_DEFAULT_HEIGHT },
      zIndex: { default: 24 },
    };
  },
  parseHTML() {
    return [{ tag: "note-text-box" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["note-text-box", mergeAttributes(HTMLAttributes), 0];
  },
  addNodeView() {
    return ({ node, editor, getPos }) => {
      let persistedAttrs = normalizeNoteTextBoxAttrs(node.attrs as Record<string, unknown>);
      let currentAttrs = persistedAttrs;
      let activeDragFinalize: (() => void) | null = null;

      const dom = document.createElement("div");
      dom.className = "note-textbox-node";

      const dragHandle = document.createElement("button");
      dragHandle.type = "button";
      dragHandle.className = "note-textbox-drag-handle";
      dragHandle.textContent = "Move";
      dragHandle.title = "Drag text box";
      dragHandle.contentEditable = "false";
      dragHandle.setAttribute("aria-label", "Drag text box");
      dragHandle.setAttribute("data-note-textbox-drag", "1");

      const contentDOM = document.createElement("div");
      contentDOM.className = "note-textbox-content";

      const resizeHandle = document.createElement("button");
      resizeHandle.type = "button";
      resizeHandle.className = "note-textbox-resize-handle";
      resizeHandle.contentEditable = "false";
      resizeHandle.setAttribute("aria-label", "Resize text box");
      resizeHandle.setAttribute("data-note-textbox-resize", "1");

      dom.append(dragHandle, contentDOM, resizeHandle);

      const applyToDom = (next: NoteTextBoxAttrs) => {
        currentAttrs = next;
        dom.style.left = `${next.x}px`;
        dom.style.top = `${next.y}px`;
        dom.style.width = `${next.width}px`;
        dom.style.height = `${next.height}px`;
        dom.style.zIndex = String(next.zIndex);
        dom.setAttribute("data-note-textbox-object-id", next.objectId);
      };

      const commitNodeAttrs = (next: NoteTextBoxAttrs) => {
        const committed = commitOverlayNodeAttrs<NoteTextBoxAttrs>({
          editor,
          nodeType: "noteTextBox",
          dom,
          getPos: typeof getPos === "function" ? getPos : undefined,
          fallbackObjectId: next.objectId,
          previousAttrs: persistedAttrs,
          nextAttrs: next,
          normalize: normalizeNoteTextBoxAttrs,
          equals: areNoteTextBoxAttrsEqual,
        });
        if (committed.result === "saved") {
          persistedAttrs = committed.normalizedNext;
        }
      };

      const bindPointerDrag = (
        startEvent: PointerEvent,
        onMove: (
          event: PointerEvent,
          startState: {
            attrs: NoteTextBoxAttrs;
            clientX: number;
            clientY: number;
          }
        ) => NoteTextBoxAttrs
      ) => {
        if (startEvent.button !== 0 && startEvent.button !== -1) {
          return;
        }
        if (activeDragFinalize) {
          activeDragFinalize();
        }
        startEvent.preventDefault();
        startEvent.stopPropagation();
        const startState = {
          attrs: currentAttrs,
          clientX: startEvent.clientX,
          clientY: startEvent.clientY,
        };
        let liveAttrs = startState.attrs;
        let finished = false;

        const handleMove = (moveEvent: PointerEvent) => {
          moveEvent.preventDefault();
          liveAttrs = onMove(moveEvent, startState);
          applyToDom(liveAttrs);
        };

        const handleVisibilityChange = () => {
          if (document.visibilityState === "hidden") {
            finish();
          }
        };

        const detach = () => {
          window.removeEventListener("pointermove", handleMove);
          window.removeEventListener("pointerup", handleUp);
          window.removeEventListener("pointercancel", handleUp);
          window.removeEventListener("blur", handleUp);
          document.removeEventListener("visibilitychange", handleVisibilityChange);
          if (activeDragFinalize === finish) {
            activeDragFinalize = null;
          }
        };

        const finish = () => {
          if (finished) {
            return;
          }
          finished = true;
          detach();
          commitNodeAttrs(liveAttrs);
        };

        const handleUp = () => finish();
        activeDragFinalize = finish;

        window.addEventListener("pointermove", handleMove);
        window.addEventListener("pointerup", handleUp);
        window.addEventListener("pointercancel", handleUp);
        window.addEventListener("blur", handleUp);
        document.addEventListener("visibilitychange", handleVisibilityChange);

        applyToDom(startState.attrs);
      };

      const bindMouseDrag = (
        startEvent: MouseEvent,
        onMove: (
          event: MouseEvent,
          startState: {
            attrs: NoteTextBoxAttrs;
            clientX: number;
            clientY: number;
          }
        ) => NoteTextBoxAttrs
      ) => {
        if (startEvent.button !== 0) {
          return;
        }
        if (activeDragFinalize) {
          activeDragFinalize();
        }
        startEvent.preventDefault();
        startEvent.stopPropagation();
        const startState = {
          attrs: currentAttrs,
          clientX: startEvent.clientX,
          clientY: startEvent.clientY,
        };
        let liveAttrs = startState.attrs;
        let finished = false;

        const handleMove = (moveEvent: MouseEvent) => {
          moveEvent.preventDefault();
          liveAttrs = onMove(moveEvent, startState);
          applyToDom(liveAttrs);
        };

        const handleVisibilityChange = () => {
          if (document.visibilityState === "hidden") {
            finish();
          }
        };

        const detach = () => {
          window.removeEventListener("mousemove", handleMove);
          window.removeEventListener("mouseup", handleUp);
          window.removeEventListener("blur", handleUp);
          document.removeEventListener("visibilitychange", handleVisibilityChange);
          if (activeDragFinalize === finish) {
            activeDragFinalize = null;
          }
        };

        const finish = () => {
          if (finished) {
            return;
          }
          finished = true;
          detach();
          commitNodeAttrs(liveAttrs);
        };

        const handleUp = () => finish();
        activeDragFinalize = finish;

        window.addEventListener("mousemove", handleMove);
        window.addEventListener("mouseup", handleUp);
        window.addEventListener("blur", handleUp);
        document.addEventListener("visibilitychange", handleVisibilityChange);

        applyToDom(startState.attrs);
      };

      let ignoreMouseDownUntil = 0;

      const handleDragPointerDown = (event: PointerEvent) => {
        ignoreMouseDownUntil = Date.now() + 320;
        bindPointerDrag(event, (moveEvent, startState) => {
          const deltaX = moveEvent.clientX - startState.clientX;
          const deltaY = moveEvent.clientY - startState.clientY;
          return normalizeNoteTextBoxAttrs({
            ...startState.attrs,
            x: startState.attrs.x + deltaX,
            y: startState.attrs.y + deltaY,
          });
        });
      };

      const handleDragMouseDown = (event: MouseEvent) => {
        if (Date.now() < ignoreMouseDownUntil) {
          return;
        }
        bindMouseDrag(event, (moveEvent, startState) => {
          const deltaX = moveEvent.clientX - startState.clientX;
          const deltaY = moveEvent.clientY - startState.clientY;
          return normalizeNoteTextBoxAttrs({
            ...startState.attrs,
            x: startState.attrs.x + deltaX,
            y: startState.attrs.y + deltaY,
          });
        });
      };

      const handleResizePointerDown = (event: PointerEvent) => {
        ignoreMouseDownUntil = Date.now() + 320;
        bindPointerDrag(event, (moveEvent, startState) => {
          const deltaX = moveEvent.clientX - startState.clientX;
          const deltaY = moveEvent.clientY - startState.clientY;
          return normalizeNoteTextBoxAttrs({
            ...startState.attrs,
            width: startState.attrs.width + deltaX,
            height: startState.attrs.height + deltaY,
          });
        });
      };

      const handleResizeMouseDown = (event: MouseEvent) => {
        if (Date.now() < ignoreMouseDownUntil) {
          return;
        }
        bindMouseDrag(event, (moveEvent, startState) => {
          const deltaX = moveEvent.clientX - startState.clientX;
          const deltaY = moveEvent.clientY - startState.clientY;
          return normalizeNoteTextBoxAttrs({
            ...startState.attrs,
            width: startState.attrs.width + deltaX,
            height: startState.attrs.height + deltaY,
          });
        });
      };

      dragHandle.addEventListener("pointerdown", handleDragPointerDown);
      dragHandle.addEventListener("mousedown", handleDragMouseDown);
      resizeHandle.addEventListener("pointerdown", handleResizePointerDown);
      resizeHandle.addEventListener("mousedown", handleResizeMouseDown);
      applyToDom(persistedAttrs);

      return {
        dom,
        contentDOM,
        update(updatedNode) {
          if (updatedNode.type.name !== "noteTextBox") {
            return false;
          }
          persistedAttrs = normalizeNoteTextBoxAttrs(
            updatedNode.attrs as Record<string, unknown>
          );
          applyToDom(persistedAttrs);
          return true;
        },
        stopEvent(event) {
          const target = event.target as HTMLElement | null;
          if (!target) {
            return false;
          }
          return Boolean(
            target.closest("[data-note-textbox-drag='1'], [data-note-textbox-resize='1']")
          );
        },
        ignoreMutation(mutation) {
          if (mutation.type !== "attributes") {
            return false;
          }
          return (
            mutation.target === dom ||
            mutation.target === dragHandle ||
            mutation.target === resizeHandle
          );
        },
        destroy() {
          if (activeDragFinalize) {
            activeDragFinalize();
            activeDragFinalize = null;
          }
          dragHandle.removeEventListener("pointerdown", handleDragPointerDown);
          dragHandle.removeEventListener("mousedown", handleDragMouseDown);
          resizeHandle.removeEventListener("pointerdown", handleResizePointerDown);
          resizeHandle.removeEventListener("mousedown", handleResizeMouseDown);
        },
      };
    };
  },
});

const mentionHighlightPluginKey = new PluginKey<DecorationSet>("noteMentionHighlight");
const MENTION_DECORATION_CLASS = "mention-highlight mention-highlight-editor";

function buildMentionDecorationSet(doc: ProseMirrorNode) {
  const decorations: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (!node.isText) {
      return true;
    }
    const text = String(node.text || "");
    if (!text || !text.includes("@")) {
      return true;
    }
    const mentionRanges = getMentionRanges(text);
    for (const range of mentionRanges) {
      if (range.end <= range.start) {
        continue;
      }
      decorations.push(
        Decoration.inline(pos + range.start, pos + range.end, {
          class: MENTION_DECORATION_CLASS,
        })
      );
    }
    return true;
  });
  return DecorationSet.create(doc, decorations);
}

const MentionHighlightExtension = Extension.create({
  name: "mentionHighlight",
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: mentionHighlightPluginKey,
        state: {
          init: (_, state) => buildMentionDecorationSet(state.doc),
          apply: (transaction, previousDecorations, _, state) => {
            if (transaction.docChanged) {
              return buildMentionDecorationSet(state.doc);
            }
            return previousDecorations.map(transaction.mapping, transaction.doc);
          },
        },
        props: {
          decorations(state) {
            return mentionHighlightPluginKey.getState(state) || null;
          },
        },
      }),
    ];
  },
});

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

function assertDataUrlSize(dataUrl: string, maxBytes: number) {
  const normalized = String(dataUrl || "");
  if (!normalized) {
    throw new Error("Unable to read image data");
  }
  const byteSize = new Blob([normalized]).size;
  if (byteSize > maxBytes) {
    throw new Error("Image is too large. Try a smaller image.");
  }
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
      src: {
        default: null,
      },
      alt: {
        default: null,
      },
      title: {
        default: null,
      },
      width: {
        default: null,
      },
      height: {
        default: null,
      },
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

function isOverlayNodeTypeName(name: string): name is OverlayNodeType {
  return name === "noteShape" || name === "noteTextBox";
}

function shouldLogOverlayCommitDebug() {
  if (process.env.NODE_ENV === "production" || typeof window === "undefined") {
    return false;
  }
  try {
    return window.localStorage.getItem(NOTE_OVERLAY_DEBUG_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function logOverlayCommitDebug(payload: {
  nodeType: OverlayNodeType;
  objectId: string;
  resolvedPos: number | null;
  previousAttrs: NoteShapeAttrs | NoteTextBoxAttrs;
  nextAttrs: NoteShapeAttrs | NoteTextBoxAttrs;
  result: OverlayCommitResult;
  strategy: OverlayResolveStrategy;
}) {
  if (!shouldLogOverlayCommitDebug()) {
    return;
  }
  logClientDebug("note_editor.overlay.commit", payload);
}

function getNodeObjectId(node: ProseMirrorNode | null | undefined) {
  const attrs = node?.attrs as Record<string, unknown> | null | undefined;
  return typeof attrs?.objectId === "string" ? attrs.objectId.trim() : "";
}

function findNearestNodePositionByType(
  editor: Editor,
  nodeType: OverlayNodeType,
  referencePos: number
) {
  const safeReference = Math.max(
    0,
    Math.min(referencePos, editor.state.doc.content.size)
  );
  let nearestPos: number | null = null;
  let nearestDistance = Number.POSITIVE_INFINITY;
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name !== nodeType) {
      return true;
    }
    const distance = Math.abs(pos - safeReference);
    if (
      distance < nearestDistance ||
      (distance === nearestDistance && (nearestPos === null || pos < nearestPos))
    ) {
      nearestDistance = distance;
      nearestPos = pos;
    }
    return true;
  });
  return nearestPos;
}

function resolveNodePositionByType(
  editor: Editor,
  getPos: (() => number | undefined) | undefined,
  dom: HTMLElement | null,
  nodeType: OverlayNodeType,
  fallbackObjectId?: string | null,
  options?: {
    knownPos?: number | null;
  }
): {
  pos: number | null;
  strategy: OverlayResolveStrategy;
} {
  const targetObjectId =
    typeof fallbackObjectId === "string" ? fallbackObjectId.trim() : "";
  const hasTargetObjectId = targetObjectId.length > 0;
  const doesNodeMatch = (
    node: ProseMirrorNode | null | undefined,
    allowTypeFallback: boolean
  ) => {
    if (!node || node.type.name !== nodeType) {
      return false;
    }
    if (!hasTargetObjectId) {
      return true;
    }
    const nodeObjectId = getNodeObjectId(node);
    if (nodeObjectId === targetObjectId) {
      return true;
    }
    return allowTypeFallback;
  };

  const resolveFromRawPos = (
    rawPos: number | null | undefined,
    allowTypeFallback: boolean
  ) => {
    if (typeof rawPos !== "number" || Number.isNaN(rawPos)) {
      return null;
    }

    const docSize = editor.state.doc.content.size;
    const safePos = Math.max(0, Math.min(rawPos, docSize));
    const directNode = editor.state.doc.nodeAt(safePos);
    if (doesNodeMatch(directNode, allowTypeFallback)) {
      return safePos;
    }

    const resolvedPos = editor.state.doc.resolve(safePos);
    for (let depth = resolvedPos.depth; depth > 0; depth -= 1) {
      const node = resolvedPos.node(depth);
      if (doesNodeMatch(node, allowTypeFallback)) {
        return resolvedPos.before(depth);
      }
    }

    return null;
  };

  const candidatePositions: Array<{ rawPos: number; strategy: OverlayResolveStrategy }> = [];
  if (typeof options?.knownPos === "number" && Number.isFinite(options.knownPos)) {
    candidatePositions.push({ rawPos: options.knownPos, strategy: "known_pos" });
  }

  if (typeof getPos === "function") {
    try {
      const rawPos = getPos();
      if (typeof rawPos === "number" && Number.isFinite(rawPos)) {
        candidatePositions.push({ rawPos, strategy: "get_pos" });
      }
    } catch {
      // Fall through to other lookup strategies.
    }
  }

  if (dom) {
    try {
      const rawPos = editor.view.posAtDOM(dom, 0);
      if (typeof rawPos === "number" && Number.isFinite(rawPos)) {
        candidatePositions.push({ rawPos, strategy: "dom" });
      }
    } catch {
      // Ignore DOM lookup errors and continue.
    }
  }

  for (const candidate of candidatePositions) {
    const pos = resolveFromRawPos(candidate.rawPos, false);
    if (typeof pos === "number") {
      return { pos, strategy: candidate.strategy };
    }
  }

  if (hasTargetObjectId) {
    let matchedPos: number | null = null;
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name !== nodeType || getNodeObjectId(node) !== targetObjectId) {
        return true;
      }
      matchedPos = pos;
      return false;
    });
    if (typeof matchedPos === "number") {
      return { pos: matchedPos, strategy: "object_id" };
    }
  }

  const referencePos =
    candidatePositions.length > 0
      ? candidatePositions[0].rawPos
      : editor.state.selection.from;
  const nearestTypePos = findNearestNodePositionByType(editor, nodeType, referencePos);
  if (typeof nearestTypePos === "number") {
    const pos = resolveFromRawPos(nearestTypePos, true);
    if (typeof pos === "number") {
      return { pos, strategy: "nearest_type" };
    }
  }

  return {
    pos: null,
    strategy: "unresolved",
  };
}

function commitOverlayNodeAttrs<T extends NoteShapeAttrs | NoteTextBoxAttrs>(params: {
  editor: Editor;
  nodeType: OverlayNodeType;
  dom: HTMLElement | null;
  getPos?: (() => number | undefined) | undefined;
  fallbackObjectId?: string | null;
  knownPos?: number | null;
  previousAttrs: T;
  nextAttrs: T;
  normalize: (attrs: Record<string, unknown> | null | undefined) => T;
  equals: (left: T, right: T) => boolean;
}) {
  const normalizedPrevious = params.normalize(
    params.previousAttrs as unknown as Record<string, unknown>
  );
  const normalizedNext = params.normalize(
    params.nextAttrs as unknown as Record<string, unknown>
  );
  const objectId = normalizedNext.objectId.trim();
  const resolution = resolveNodePositionByType(
    params.editor,
    params.getPos,
    params.dom,
    params.nodeType,
    params.fallbackObjectId ?? objectId,
    {
      knownPos: params.knownPos ?? null,
    }
  );
  const resolvedPos = resolution.pos;

  if (typeof resolvedPos !== "number") {
    params.editor.view.dispatch(
      params.editor.state.tr.setMeta(NOTE_OVERLAY_COMMIT_META_KEY, {
        nodeType: params.nodeType,
        objectId,
        result: "resolve_failed",
        resolvedPos: null,
      } satisfies OverlayCommitMeta)
    );
    logOverlayCommitDebug({
      nodeType: params.nodeType,
      objectId,
      resolvedPos: null,
      previousAttrs: normalizedPrevious,
      nextAttrs: normalizedNext,
      result: "resolve_failed",
      strategy: resolution.strategy,
    });
    return {
      result: "resolve_failed" as OverlayCommitResult,
      normalizedNext,
      resolvedPos: null,
    };
  }

  if (params.equals(normalizedNext, normalizedPrevious)) {
    logOverlayCommitDebug({
      nodeType: params.nodeType,
      objectId,
      resolvedPos,
      previousAttrs: normalizedPrevious,
      nextAttrs: normalizedNext,
      result: "no_change",
      strategy: resolution.strategy,
    });
    return {
      result: "no_change" as OverlayCommitResult,
      normalizedNext,
      resolvedPos,
    };
  }

  const tr = params.editor.state.tr
    .setNodeMarkup(resolvedPos, undefined, normalizedNext)
    .setMeta(NOTE_CRITICAL_SAVE_META_KEY, true)
    .setMeta(NOTE_OVERLAY_COMMIT_META_KEY, {
      nodeType: params.nodeType,
      objectId,
      result: "saved",
      resolvedPos,
    } satisfies OverlayCommitMeta);
  params.editor.view.dispatch(tr);
  logOverlayCommitDebug({
    nodeType: params.nodeType,
    objectId,
    resolvedPos,
    previousAttrs: normalizedPrevious,
    nextAttrs: normalizedNext,
    result: "saved",
    strategy: resolution.strategy,
  });

  return {
    result: "saved" as OverlayCommitResult,
    normalizedNext,
    resolvedPos,
  };
}

function resolveOverlayNodeFromContextMenuTarget(
  editor: Editor,
  target: Element | null,
  clientX: number,
  clientY: number
) {
  const findOverlayAtDocPos = (pos: number | null | undefined) => {
    if (typeof pos !== "number" || Number.isNaN(pos)) {
      return null;
    }

    const safePos = Math.max(0, Math.min(pos, editor.state.doc.content.size));
    const directNode = editor.state.doc.nodeAt(safePos);
    if (directNode && isOverlayNodeTypeName(directNode.type.name)) {
      return {
        overlayNodeType: directNode.type.name,
        overlayNodePos: safePos,
      };
    }

    const resolvedPos = editor.state.doc.resolve(safePos);
    for (let depth = resolvedPos.depth; depth > 0; depth -= 1) {
      const node = resolvedPos.node(depth);
      if (isOverlayNodeTypeName(node.type.name)) {
        return {
          overlayNodeType: node.type.name,
          overlayNodePos: resolvedPos.before(depth),
        };
      }
    }

    return null;
  };

  const overlayDom = target?.closest(".note-shape-node, .note-textbox-node");
  if (overlayDom) {
    try {
      const posFromDom = editor.view.posAtDOM(overlayDom, 0);
      const fromDom = findOverlayAtDocPos(posFromDom);
      if (fromDom) {
        return fromDom;
      }
    } catch {
      // Fallback to coordinate lookup.
    }
  }

  const posAtCoords = editor.view.posAtCoords({ left: clientX, top: clientY });
  if (posAtCoords) {
    const fromCoords = findOverlayAtDocPos(posAtCoords.pos);
    if (fromCoords) {
      return fromCoords;
    }
  }

  return {
    overlayNodeType: null,
    overlayNodePos: null,
  };
}

function resolveSelectedOverlayNode(editor: Editor) {
  const { $from } = editor.state.selection;
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    const node = $from.node(depth);
    if (!isOverlayNodeTypeName(node.type.name)) {
      continue;
    }
    return {
      nodeType: node.type.name,
      pos: $from.before(depth),
      node,
    };
  }
  return null;
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
  initialUpdatedAt = null,
  liveContentSnapshot = null,
  onLiveSnapshotApplied,
  title,
  placeholder,
  onSave,
  onUploadImageFile,
  onCreateTask,
  lastEditedAtLabel,
  lastEditedByLabel,
  showTopToolbar = true,
  adjacentToolbarTabs = [],
  toolbarPanel,
  suppressToolbarGroups = false,
  onRibbonTabSelect,
  enableZoomControls = false,
  disableHorizontalScroll = false,
  blockNavigationWhileSaving = true,
  contextMenuMode = "full",
  initialContextMenuFavorites = [],
  onSaveContextMenuFavorites,
  initialRibbonTab = "home",
  initialZoomPercent = 100,
  initialFocusMode = false,
  editorHeightMode = "default",
  onViewStateChange,
  onFocusModeChange,
  debugImagePersistence = false,
  enforceImageNodeIntegrity = false,
}: NoteEditorClientProps) {
  const [activeRibbonTab, setActiveRibbonTab] = useState<RibbonTabId>(() => {
    if (
      initialRibbonTab === "home" ||
      initialRibbonTab === "insert" ||
      initialRibbonTab === "layout" ||
      initialRibbonTab === "review" ||
      initialRibbonTab === "view"
    ) {
      return initialRibbonTab;
    }
    return "home";
  });
  const [, startTransition] = useTransition();
  const [isTaskPending, startTaskTransition] = useTransition();
  const [contextMenu, setContextMenu] = useState<ContextMenuState>({
    open: false,
    x: 0,
    y: 0,
    inTable: false,
    overlayNodeType: null,
    overlayNodePos: null,
  });
  const [contextMenuFavorites, setContextMenuFavorites] = useState<
    ContextMenuFavoriteActionId[]
  >(() => normalizeContextMenuFavoriteIds(initialContextMenuFavorites));
  const [contextMenuFavoritesPickerOpen, setContextMenuFavoritesPickerOpen] =
    useState(false);
  const [shapeMenuOpen, setShapeMenuOpen] = useState(false);
  const [shapeMenuPosition, setShapeMenuPosition] = useState<FloatingMenuPosition | null>(
    null
  );
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
  const shapeMenuRef = useRef<HTMLDivElement | null>(null);
  const shapeMenuPopupRef = useRef<HTMLDivElement | null>(null);
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
  const taskCreatorPanelRef = useRef<HTMLDivElement | null>(null);
  const [zoomPercent, setZoomPercent] = useState(() =>
    Math.min(1000, Math.max(20, Math.round(Number(initialZoomPercent) || 100)))
  );
  const [focusMode, setFocusMode] = useState(Boolean(initialFocusMode));
  const [showLayoutGrid, setShowLayoutGrid] = useState(false);
  const [showOutline, setShowOutline] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [saveWarning, setSaveWarning] = useState("");
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [defaultFontFamilyLabel, setDefaultFontFamilyLabel] = useState("Arial");
  const [defaultFontSizeLabel, setDefaultFontSizeLabel] = useState("14");
  const saveStatusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveChainRef = useRef<Promise<void>>(Promise.resolve());
  const saveRequestVersionRef = useRef(0);
  const lastCommittedVersionRef = useRef(0);
  const inFlightSaveCountRef = useRef(0);
  const navigationGuardInFlightRef = useRef(false);
  const viewStateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const restoredDraftRef = useRef(false);
  const restoredDraftContentRef = useRef(false);
  const pendingLiveSnapshotRef = useRef<NoteLiveContentSnapshot | null>(null);
  const lastAppliedLiveUpdatedAtRef = useRef<string | null>(initialUpdatedAt ?? null);
  const lastAppliedLiveContentJsonRef = useRef("");
  const persistedEphemeralImageSrcBySourceRef = useRef<Map<string, string>>(new Map());
  const uploadedImageSrcQueueRef = useRef<string[]>([]);
  const legacyMissingImageCleanupAppliedRef = useRef(false);
  const draftStorageKey = useMemo(() => `${DRAFT_STORAGE_PREFIX}${entityId}`, [entityId]);
  const normalizedInitialContent = useMemo(
    () => normalizeContent(initialContent),
    [initialContent]
  );
  const initialImageIntegrity = useMemo(() => {
    if (!enforceImageNodeIntegrity) {
      return { content: normalizedInitialContent, removedCount: 0 };
    }
    const cleaned = removeMissingSrcImageNodes(normalizedInitialContent);
    return {
      content: normalizeContent(cleaned.content),
      removedCount: cleaned.removedCount,
    };
  }, [enforceImageNodeIntegrity, normalizedInitialContent]);
  const initialUpdatedAtMs = useMemo(
    () => parseTimestampMs(initialUpdatedAt),
    [initialUpdatedAt]
  );
  const imageDebugEnabled =
    debugImagePersistence && process.env.NEXT_PUBLIC_NOTE_IMAGE_DEBUG === "1";

  useEffect(() => {
    pendingLiveSnapshotRef.current = null;
    lastAppliedLiveUpdatedAtRef.current = initialUpdatedAt ?? null;
    lastAppliedLiveContentJsonRef.current = JSON.stringify(initialImageIntegrity.content);
  }, [entityId, initialImageIntegrity.content, initialUpdatedAt]);

  useEffect(() => {
    uploadedImageSrcQueueRef.current = [];
    legacyMissingImageCleanupAppliedRef.current = false;
    restoredDraftContentRef.current = false;
  }, [entityId]);

  const logSaveDebug = useCallback(
    (event: string, payload?: Record<string, unknown>) => {
      if (
        process.env.NODE_ENV === "production" ||
        process.env.NEXT_PUBLIC_NOTE_SAVE_DEBUG !== "1"
      ) {
        return;
      }
      logClientDebug("note_editor.save", {
        event,
        entityId,
        latestScheduledVersion: saveRequestVersionRef.current,
        lastCommittedVersion: lastCommittedVersionRef.current,
        inFlightSaveCount: inFlightSaveCountRef.current,
        ...payload,
      });
    },
    [entityId]
  );

  const persistDraftSnapshot = useCallback(
    (json: unknown, dirty: boolean) => {
      try {
        if (typeof window === "undefined") {
          return;
        }
        window.sessionStorage.setItem(
          draftStorageKey,
          JSON.stringify({
            entityId,
            dirty,
            updatedAt: new Date().toISOString(),
            content: json,
          })
        );
      } catch {
        // Ignore session storage failures.
      }
    },
    [draftStorageKey, entityId]
  );

  const pushUploadedImageSrcToQueue = useCallback(
    (source: string, reason: "upload" | "inline") => {
      if (!enforceImageNodeIntegrity) {
        return;
      }
      const normalizedSource = String(source || "").trim();
      if (!normalizedSource) {
        return;
      }

      const queue = uploadedImageSrcQueueRef.current;
      queue.push(normalizedSource);
      if (queue.length > UPLOADED_IMAGE_SRC_QUEUE_LIMIT) {
        queue.splice(0, queue.length - UPLOADED_IMAGE_SRC_QUEUE_LIMIT);
      }

      if (imageDebugEnabled) {
        logClientInfo("note_editor.image.queue_push", {
          entityId,
          reason,
          queueSize: queue.length,
          src: normalizedSource.slice(0, 180),
        });
      }
    },
    [imageDebugEnabled, enforceImageNodeIntegrity, entityId]
  );

  const resolveImageSourceFromFile = useCallback(
    async (file: File) => {
      if (!isAllowedUploadImageMimeType(file.type)) {
        throw new Error(`Unsupported image type. Use ${ALLOWED_UPLOAD_IMAGE_TYPE_LABEL}.`);
      }
      if (file.size > MAX_UPLOADED_IMAGE_BYTES) {
        throw new Error("Image is too large. Use images up to 10 MB.");
      }
      if (imageDebugEnabled) {
        logClientInfo("note_editor.image.resolve_source_start", {
          entityId,
          name: file.name,
          type: file.type,
          size: file.size,
          hasUploadHandler: Boolean(onUploadImageFile),
        });
      }
      if (onUploadImageFile) {
        try {
          const uploadedSrc = String((await onUploadImageFile(file)) || "").trim();
          if (uploadedSrc) {
            pushUploadedImageSrcToQueue(uploadedSrc, "upload");
            if (imageDebugEnabled) {
              logClientInfo("note_editor.image.resolve_source_uploaded", {
                entityId,
                src: uploadedSrc.slice(0, 180),
              });
            }
            return uploadedSrc;
          }
        } catch (error) {
          if (imageDebugEnabled) {
            logClientWarn("note_editor.image.resolve_source_upload_failed", {
              entityId,
              message: error instanceof Error ? error.message : String(error),
            });
          }
          if (process.env.NODE_ENV !== "production") {
            logClientWarn("note_editor.image.upload_failed", {
              entityId,
              message: error instanceof Error ? error.message : String(error),
            });
          }
          // Fall back to inline insertion so users never lose pasted images if upload fails.
        }
      }

      const inlineSrc = await optimizeImageForInlineInsert(file);
      assertDataUrlSize(inlineSrc, MAX_INLINE_IMAGE_DATA_URL_BYTES);
      pushUploadedImageSrcToQueue(inlineSrc, "inline");
      if (imageDebugEnabled) {
        logClientInfo("note_editor.image.resolve_source_inline_fallback", {
          entityId,
          dataUrlLength: inlineSrc.length,
        });
      }
      return inlineSrc;
    },
    [
      imageDebugEnabled,
      entityId,
      onUploadImageFile,
      pushUploadedImageSrcToQueue,
    ]
  );

  const resolveEphemeralImageSourceForSave = useCallback(
    async (source: string) => {
      const normalizedSource = String(source || "").trim();
      if (!isEphemeralImageSource(normalizedSource)) {
        return { src: normalizedSource, warning: "" };
      }

      const cached = persistedEphemeralImageSrcBySourceRef.current.get(normalizedSource);
      if (cached) {
        return { src: cached, warning: "" };
      }

      try {
        const response = await fetch(normalizedSource);
        if (!response.ok) {
          throw new Error(`unable to read image source (${response.status})`);
        }
        const blob = await response.blob();
        if (!blob.size) {
          throw new Error("empty image source");
        }
        const imageFile = createImageFileFromBlob(blob);
        const persistedSrc = await resolveImageSourceFromFile(imageFile);
        persistedEphemeralImageSrcBySourceRef.current.set(normalizedSource, persistedSrc);
        return { src: persistedSrc, warning: "" };
      } catch {
        return {
          src: normalizedSource,
          warning:
            "One pasted image used a temporary source URL and could not be persisted. Re-paste that image directly from your clipboard.",
        };
      }
    },
    [resolveImageSourceFromFile]
  );

  const normalizeEphemeralImagesForSave = useCallback(
    async (content: unknown) => {
      if (!containsEphemeralImageSource(content)) {
        return {
          content,
          warnings: [] as string[],
        };
      }

      const warnings = new Set<string>();
      const normalizedContent = cloneJsonValue(content);

      const traverse = async (value: unknown): Promise<void> => {
        if (Array.isArray(value)) {
          for (const item of value) {
            await traverse(item);
          }
          return;
        }

        if (!isObjectRecord(value)) {
          return;
        }

        const nodeType = String(value.type || "")
          .trim()
          .toLowerCase();
        if (nodeType.includes("image") && isObjectRecord(value.attrs)) {
          const attrs = value.attrs as Record<string, unknown>;
          const source = String(attrs.src || "").trim();
          if (isEphemeralImageSource(source)) {
            const resolved = await resolveEphemeralImageSourceForSave(source);
            if (resolved.warning) {
              warnings.add(resolved.warning);
            }
            attrs.src = resolved.src;
          }
        }

        const entries = Object.values(value);
        for (const entry of entries) {
          await traverse(entry);
        }
      };

      await traverse(normalizedContent);
      return {
        content: normalizedContent,
        warnings: Array.from(warnings),
      };
    },
    [resolveEphemeralImageSourceForSave]
  );

  const persistEditorSaveNow = useCallback(
    async (json: unknown, requestVersion: number) => {
      setSaveState("saving");
      inFlightSaveCountRef.current += 1;
      logSaveDebug("request_start", { requestVersion });
      try {
        const normalizedSaveInput = await normalizeEphemeralImagesForSave(json);
        let savePayload = normalizedSaveInput.content;
        if (enforceImageNodeIntegrity) {
          const repairedMissingSources = fillMissingImageSrcFromQueue(
            savePayload,
            uploadedImageSrcQueueRef.current
          );
          savePayload = repairedMissingSources.content;
          uploadedImageSrcQueueRef.current = repairedMissingSources.remainingQueue.slice(
            -UPLOADED_IMAGE_SRC_QUEUE_LIMIT
          );
          if (imageDebugEnabled) {
            logClientInfo("note_editor.image.save_missing_src_repair", {
              entityId,
              requestVersion,
              fixedCount: repairedMissingSources.fixedCount,
              unresolvedCount: repairedMissingSources.unresolvedCount,
              remainingQueueCount: uploadedImageSrcQueueRef.current.length,
            });
          }
          if (repairedMissingSources.unresolvedCount > 0) {
            if (imageDebugEnabled) {
              logClientError("note_editor.image.blocked_missing_src_save", {
                entityId,
                unresolvedCount: repairedMissingSources.unresolvedCount,
              });
            }
            throw new Error(MISSING_IMAGE_SRC_SAVE_BLOCK_MESSAGE);
          }
        }
        if (imageDebugEnabled) {
          const payloadSummary = summarizeImageNodes(savePayload);
          if (payloadSummary.total > 0) {
            logClientInfo("note_editor.image.save_payload", {
              entityId,
              requestVersion,
              payloadSummary,
            });
          }
        }
        const saveResultRaw = await onSave(entityId, savePayload);
        const saveResult =
          saveResultRaw && typeof saveResultRaw === "object"
            ? (saveResultRaw as NoteSaveResult)
            : null;
        const hasCanonicalContent = Boolean(saveResult && isTiptapDocContent(saveResult.content));
        const canonicalContent =
          hasCanonicalContent
            ? normalizeContent((saveResult as NoteSaveResult).content)
            : savePayload;
        if (imageDebugEnabled) {
          const canonicalSummary = summarizeImageNodes(canonicalContent);
          if (canonicalSummary.total > 0) {
            logClientInfo("note_editor.image.save_canonical_content", {
              entityId,
              requestVersion,
              canonicalSummary,
            });
          }
        }
        const warnings = mergeSaveWarnings(normalizedSaveInput.warnings, saveResult?.warnings);

        const completion = resolveSaveCompletion({
          requestVersion,
          latestScheduledVersion: saveRequestVersionRef.current,
          lastCommittedVersion: lastCommittedVersionRef.current,
        });

        if (!completion.shouldAcknowledge) {
          logSaveDebug("request_success_stale_ignored", { requestVersion });
          return;
        }

        lastCommittedVersionRef.current = completion.nextLastCommittedVersion;
        setSaveError("");
        setSaveWarning(warnings.join(" "));
        setSaveState("saved");
        persistDraftSnapshot(canonicalContent, false);
        lastAppliedLiveContentJsonRef.current = JSON.stringify(canonicalContent);
        if (typeof saveResult?.updatedAt === "string" && saveResult.updatedAt.trim()) {
          lastAppliedLiveUpdatedAtRef.current = saveResult.updatedAt.trim();
        }
        if (saveStatusTimerRef.current) {
          clearTimeout(saveStatusTimerRef.current);
        }
        saveStatusTimerRef.current = setTimeout(() => {
          setSaveState((current) => (current === "saved" ? "idle" : current));
        }, 1400);
        logSaveDebug("request_success_acknowledged", {
          requestVersion,
          warningCount: warnings.length,
        });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unable to save your changes.";
        if (imageDebugEnabled) {
          const payloadSummary = summarizeImageNodes(json);
          if (payloadSummary.total > 0) {
            logClientError("note_editor.image.save_error_with_images", {
              entityId,
              requestVersion,
              message,
              payloadSummary,
            });
          }
        }
        const shouldShowError = shouldSurfaceSaveError({
          requestVersion,
          latestScheduledVersion: saveRequestVersionRef.current,
        });
        if (!shouldShowError) {
          logSaveDebug("request_error_stale_ignored", { requestVersion, message });
          return;
        }
        setSaveError(message);
        setSaveWarning("");
        setSaveState("error");
        logClientError("note_editor.save_failed", {
          entityId,
          message,
        });
        logSaveDebug("request_error_acknowledged", { requestVersion, message });
      } finally {
        inFlightSaveCountRef.current = Math.max(0, inFlightSaveCountRef.current - 1);
      }
    },
    [
      imageDebugEnabled,
      enforceImageNodeIntegrity,
      entityId,
      logSaveDebug,
      normalizeEphemeralImagesForSave,
      onSave,
      persistDraftSnapshot,
    ]
  );

  const persistEditorSave = useCallback(
    (json: unknown) => {
      const requestVersion = getNextSaveVersion(saveRequestVersionRef.current);
      saveRequestVersionRef.current = requestVersion;
      logSaveDebug("request_scheduled", { requestVersion, mode: "debounced" });
      saveChainRef.current = saveChainRef.current
        .catch(() => undefined)
        .then(async () => {
          if (requestVersion !== saveRequestVersionRef.current) {
            logSaveDebug("request_preempted", { requestVersion, mode: "debounced" });
            return;
          }
          await persistEditorSaveNow(json, requestVersion);
        });
    },
    [logSaveDebug, persistEditorSaveNow]
  );

  const persistEditorSaveImmediate = useCallback(
    (json: unknown) => {
      if (saveTimer.current) {
        clearTimeout(saveTimer.current);
        saveTimer.current = null;
      }
      const requestVersion = getNextSaveVersion(saveRequestVersionRef.current);
      saveRequestVersionRef.current = requestVersion;
      logSaveDebug("request_scheduled", { requestVersion, mode: "immediate" });
      // Keep immediate saves in-order with in-flight saves to prevent stale payloads
      // from finishing later and overwriting freshly inserted images.
      saveChainRef.current = saveChainRef.current
        .catch(() => undefined)
        .then(async () => {
          if (requestVersion !== saveRequestVersionRef.current) {
            logSaveDebug("request_preempted", { requestVersion, mode: "immediate" });
            return;
          }
          await persistEditorSaveNow(json, requestVersion);
        });
    },
    [logSaveDebug, persistEditorSaveNow]
  );

  const hasActiveSaveWork = useCallback(
    (options?: { hasDebounceTimer?: boolean }) =>
      hasActiveSaveCoordinatorWork({
        hasDebounceTimer:
          typeof options?.hasDebounceTimer === "boolean"
            ? options.hasDebounceTimer
            : Boolean(saveTimer.current),
        inFlightSaveCount: inFlightSaveCountRef.current,
      }),
    []
  );

  const applyPendingLiveSnapshot = useCallback(() => {
    const pending = pendingLiveSnapshotRef.current;
    if (!pending) {
      return;
    }
    if (saveState === "saving" || hasActiveSaveWork()) {
      return;
    }
    const currentEditor = editorRef.current;
    if (!currentEditor) {
      return;
    }

    const pendingUpdatedAt =
      typeof pending.updatedAt === "string" ? pending.updatedAt.trim() || null : null;
    const pendingUpdatedAtMs = parseTimestampMs(pendingUpdatedAt);
    const lastAppliedUpdatedAtMs = parseTimestampMs(lastAppliedLiveUpdatedAtRef.current);

    const normalizedPendingContent = normalizeContent(pending.content);
    const pendingJson = JSON.stringify(normalizedPendingContent);

    if (
      pendingUpdatedAtMs !== null
      && lastAppliedUpdatedAtMs !== null
      && pendingUpdatedAtMs <= lastAppliedUpdatedAtMs
    ) {
      pendingLiveSnapshotRef.current = null;
      return;
    }

    if (pendingUpdatedAtMs === null && pendingJson === lastAppliedLiveContentJsonRef.current) {
      pendingLiveSnapshotRef.current = null;
      return;
    }

    const currentJson = JSON.stringify(normalizeContent(currentEditor.getJSON()));
    if (currentJson !== pendingJson) {
      currentEditor.commands.setContent(normalizedPendingContent, { emitUpdate: false });
    }

    persistDraftSnapshot(normalizedPendingContent, false);
    lastAppliedLiveUpdatedAtRef.current = pendingUpdatedAt;
    lastAppliedLiveContentJsonRef.current = pendingJson;
    pendingLiveSnapshotRef.current = null;
    onLiveSnapshotApplied?.(pendingUpdatedAt);
    setSaveError("");
    setSaveWarning("");
    setSaveState("saved");
    if (saveStatusTimerRef.current) {
      clearTimeout(saveStatusTimerRef.current);
    }
    saveStatusTimerRef.current = setTimeout(() => {
      setSaveState((current) => (current === "saved" ? "idle" : current));
    }, 1400);
    logSaveDebug("live_snapshot_applied", {
      updatedAt: pendingUpdatedAt,
    });
  }, [hasActiveSaveWork, logSaveDebug, onLiveSnapshotApplied, persistDraftSnapshot, saveState]);

  const flushPendingSave = useCallback(
    (options?: { immediate?: boolean }) => {
      if (saveTimer.current) {
        clearTimeout(saveTimer.current);
        saveTimer.current = null;
      }
      const currentEditor = editorRef.current;
      if (!currentEditor) {
        return;
      }
      const json = currentEditor.getJSON();
      persistDraftSnapshot(json, true);
      if (options?.immediate) {
        void persistEditorSaveImmediate(json);
        return;
      }
      void persistEditorSave(json);
    },
    [persistDraftSnapshot, persistEditorSave, persistEditorSaveImmediate]
  );

  const flushPendingSaveAndWait = useCallback(
    async (options?: { timeoutMs?: number }) => {
      const timeoutMsRaw = Number(options?.timeoutMs ?? NAVIGATION_SAVE_TIMEOUT_MS);
      const timeoutMs = Number.isFinite(timeoutMsRaw)
        ? Math.max(400, Math.floor(timeoutMsRaw))
        : NAVIGATION_SAVE_TIMEOUT_MS;
      const hadDebounceTimer = Boolean(saveTimer.current);

      if (saveTimer.current) {
        clearTimeout(saveTimer.current);
        saveTimer.current = null;
      }

      const currentEditor = editorRef.current;
      const hadActiveWork = hasActiveSaveWork({ hasDebounceTimer: hadDebounceTimer });
      if (currentEditor && hadActiveWork) {
        const json = currentEditor.getJSON();
        persistDraftSnapshot(json, true);
        persistEditorSaveImmediate(json);
      }

      if (!hasActiveSaveWork({ hasDebounceTimer: false })) {
        logSaveDebug("flush_wait_not_needed");
        return true;
      }

      logSaveDebug("flush_wait_start", { timeoutMs });
      const waitForLatestSave = saveChainRef.current
        .catch(() => undefined)
        .then(() => !hasActiveSaveWork({ hasDebounceTimer: false }));

      const didCommitLatest = await new Promise<boolean>((resolve) => {
        let settled = false;
        const timeoutHandle = window.setTimeout(() => {
          if (settled) {
            return;
          }
          settled = true;
          resolve(false);
        }, timeoutMs);

        waitForLatestSave.then((result) => {
          if (settled) {
            return;
          }
          settled = true;
          window.clearTimeout(timeoutHandle);
          resolve(result);
        });
      });

      logSaveDebug(
        didCommitLatest ? "flush_wait_completed" : "flush_wait_timed_out",
        { timeoutMs }
      );
      return didCommitLatest;
    },
    [
      hasActiveSaveWork,
      logSaveDebug,
      persistDraftSnapshot,
      persistEditorSaveImmediate,
    ]
  );

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
  const contextMenuFavoritesHydratedRef = useRef(false);
  const contextMenuFavoritesSkipPersistRef = useRef(true);
  const prefersServerContextMenuFavorites = Boolean(onSaveContextMenuFavorites);

  useEffect(() => {
    slashMenuStateRef.current = slashMenu;
  }, [slashMenu]);

  useEffect(() => {
    mentionMenuStateRef.current = mentionMenu;
  }, [mentionMenu]);

  useEffect(() => {
    contextMenuFavoritesSkipPersistRef.current = true;
    if (contextMenuMode !== "favorites") {
      contextMenuFavoritesHydratedRef.current = false;
      setContextMenuFavorites([]);
      return;
    }
    if (prefersServerContextMenuFavorites) {
      contextMenuFavoritesHydratedRef.current = true;
      setContextMenuFavorites(normalizeContextMenuFavoriteIds(initialContextMenuFavorites));
      return;
    }
    try {
      const stored = window.localStorage.getItem(CONTEXT_MENU_FAVORITES_STORAGE_KEY);
      if (!stored) {
        contextMenuFavoritesHydratedRef.current = true;
        setContextMenuFavorites([]);
        return;
      }
      contextMenuFavoritesHydratedRef.current = true;
      setContextMenuFavorites(
        normalizeContextMenuFavoriteIds(JSON.parse(stored) as unknown)
      );
    } catch {
      contextMenuFavoritesHydratedRef.current = true;
      setContextMenuFavorites([]);
    }
  }, [contextMenuMode, initialContextMenuFavorites, prefersServerContextMenuFavorites]);

  useEffect(() => {
    if (contextMenuMode !== "favorites") {
      return;
    }
    if (!contextMenuFavoritesHydratedRef.current) {
      return;
    }
    if (contextMenuFavoritesSkipPersistRef.current) {
      contextMenuFavoritesSkipPersistRef.current = false;
      return;
    }
    if (prefersServerContextMenuFavorites && onSaveContextMenuFavorites) {
      void onSaveContextMenuFavorites(contextMenuFavorites).catch(() => null);
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
  }, [
    contextMenuFavorites,
    contextMenuMode,
    onSaveContextMenuFavorites,
    prefersServerContextMenuFavorites,
  ]);

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
    setContextMenu((prev) =>
      prev.open
        ? {
            ...prev,
            open: false,
            inTable: false,
            overlayNodeType: null,
            overlayNodePos: null,
          }
        : prev
    );
  }, []);

  const updateShapeMenuPosition = useCallback(() => {
    if (!shapeMenuRef.current) {
      return;
    }
    const anchor = shapeMenuRef.current.getBoundingClientRect();
    const estimatedMenuWidth = 144;
    const estimatedMenuHeight = 180;
    const gap = 6;
    const padding = 8;

    let nextX = anchor.left;
    if (nextX + estimatedMenuWidth + padding > window.innerWidth) {
      nextX = Math.max(padding, window.innerWidth - estimatedMenuWidth - padding);
    }

    let nextY = anchor.bottom + gap;
    if (nextY + estimatedMenuHeight + padding > window.innerHeight) {
      nextY = Math.max(padding, anchor.top - estimatedMenuHeight - gap);
    }

    setShapeMenuPosition({ x: Math.round(nextX), y: Math.round(nextY) });
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
          logClientError("note_editor.mentions_fetch_failed", {
            entityId,
            message: error instanceof Error ? error.message : String(error),
          });
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
  }, [entityId, mentionMenu.open, mentionMenu.query]);

  const insertImageWithCriticalSave = useCallback((src: string) => {
    const nextSrc = String(src || "").trim();
    if (!nextSrc) {
      return false;
    }
    if (imageDebugEnabled) {
      logClientInfo("note_editor.image.insert_image", {
        entityId,
        src: nextSrc.slice(0, 180),
      });
    }
    const currentEditor = editorRef.current;
    if (!currentEditor) {
      if (imageDebugEnabled) {
        logClientWarn("note_editor.image.insert_image_no_editor", { entityId });
      }
      return false;
    }

    const schemaNodeNames = Object.keys(currentEditor.state.schema.nodes);
    const imageNodeTypeName =
      schemaNodeNames.find((name) => name.toLowerCase() === "image") ||
      schemaNodeNames.find((name) => name.toLowerCase().includes("image")) ||
      null;

    if (imageDebugEnabled) {
      logClientInfo("note_editor.image.insert_image_node_type", {
        entityId,
        imageNodeTypeName,
      });
    }

    const repairTrailingMissingImageNode = () => {
      const missingPos = findTrailingMissingImageNodePos(currentEditor);
      if (missingPos === null) {
        return false;
      }
      const repaired = currentEditor
        .chain()
        .focus()
        .command(({ state, tr, dispatch }) => {
          const targetNode = state.doc.nodeAt(missingPos);
          if (!targetNode) {
            return false;
          }
          const targetAttrs = (targetNode.attrs || {}) as Record<string, unknown>;
          const nextAttrs: Record<string, unknown> = {
            ...targetAttrs,
            src: nextSrc,
          };
          const currentFloat = String(nextAttrs["float"] || "").trim();
          if (!currentFloat) {
            nextAttrs["float"] = "none";
          }
          tr.setMeta(NOTE_CRITICAL_SAVE_META_KEY, true);
          tr.setNodeMarkup(missingPos, undefined, nextAttrs);
          if (dispatch) {
            dispatch(tr.scrollIntoView());
          }
          return true;
        })
        .run();
      if (imageDebugEnabled) {
        logClientInfo("note_editor.image.repair_missing_src_attempt", {
          entityId,
          missingPos,
          repaired,
          nextSrc: nextSrc.slice(0, 180),
        });
      }
      return repaired;
    };

    const imageCountBeforeInsert = countImageNodesBySrc(currentEditor.getJSON(), nextSrc);
    const setImageOptions: SetImageOptions = {
      src: nextSrc,
    };

    let inserted = currentEditor
      .chain()
      .focus()
      .command(({ tr }) => {
        tr.setMeta(NOTE_CRITICAL_SAVE_META_KEY, true);
        return true;
      })
      .setImage(setImageOptions)
      .run();

    if (inserted) {
      const imageCountAfterSetImage = countImageNodesBySrc(currentEditor.getJSON(), nextSrc);
      if (imageCountAfterSetImage <= imageCountBeforeInsert) {
        const repaired = repairTrailingMissingImageNode();
        const imageCountAfterRepair = countImageNodesBySrc(currentEditor.getJSON(), nextSrc);
        if (repaired && imageCountAfterRepair > imageCountBeforeInsert) {
          inserted = true;
        } else {
          inserted = false;
          if (imageDebugEnabled) {
            logClientWarn("note_editor.image.set_image_no_matching_src", {
              entityId,
              nextSrc: nextSrc.slice(0, 180),
              imageCountBeforeInsert,
              imageCountAfterSetImage,
              repaired,
              imageCountAfterRepair,
            });
          }
        }
      }
    }

    if (!inserted) {
      const docEndPos = Math.max(0, currentEditor.state.doc.content.size);
      const baseImageNode = imageNodeTypeName
        ? {
            type: imageNodeTypeName,
            attrs: { src: nextSrc, float: "none" },
          }
        : {
            type: "image",
            attrs: { src: nextSrc, float: "none" },
          };
      inserted = currentEditor
        .chain()
        .focus()
        .command(({ tr }) => {
          tr.setMeta(NOTE_CRITICAL_SAVE_META_KEY, true);
          return true;
        })
        .insertContentAt(docEndPos, baseImageNode)
        .run();
      if (imageDebugEnabled) {
        logClientInfo("note_editor.image.insert_image_fallback", {
          entityId,
          docEndPos,
          inserted,
        });
      }

      if (inserted) {
        const imageCountAfterFallback = countImageNodesBySrc(
          currentEditor.getJSON(),
          nextSrc
        );
        if (imageCountAfterFallback <= imageCountBeforeInsert) {
          const repaired = repairTrailingMissingImageNode();
          const imageCountAfterRepair = countImageNodesBySrc(currentEditor.getJSON(), nextSrc);
          if (repaired && imageCountAfterRepair > imageCountBeforeInsert) {
            inserted = true;
          } else {
            inserted = false;
            if (imageDebugEnabled) {
              logClientWarn("note_editor.image.fallback_no_matching_src", {
                entityId,
                nextSrc: nextSrc.slice(0, 180),
                imageCountBeforeInsert,
                imageCountAfterFallback,
                repaired,
                imageCountAfterRepair,
              });
            }
          }
        }
      }
    }

    if (!inserted && imageDebugEnabled) {
      logClientError("note_editor.image.insert_image_failed", {
        entityId,
        src: nextSrc.slice(0, 180),
      });
    }
    return inserted;
  }, [imageDebugEnabled, entityId]);

  const insertImageFromFileWithSave = useCallback(
    async (file: File) => {
      const persistedSrc = await resolveImageSourceFromFile(file);
      const inserted = insertImageWithCriticalSave(persistedSrc);
      if (!inserted) {
        throw new Error("Unable to insert pasted image into this note.");
      }
    },
    [insertImageWithCriticalSave, resolveImageSourceFromFile]
  );

  const handlePaste = useCallback((_view: unknown, event: ClipboardEvent) => {
    const clipboard = event.clipboardData;
    if (!clipboard) {
      return false;
    }

    const pastedText = clipboard.getData("text/plain");
    const pastedHtml = clipboard.getData("text/html");
    const pastedLink = normalizePastedLink(pastedText) || extractSingleLinkFromHtml(pastedHtml);
    if (pastedLink) {
      event.preventDefault();
      editorRef.current
        ?.chain()
        .focus()
        .insertContent({
          type: "text",
          text: pastedLink,
          marks: [{ type: "link", attrs: { href: pastedLink } }],
        })
        .run();
      return true;
    }

    const imageItems = Array.from(clipboard.items || []).filter((item) =>
      item.type.startsWith("image/")
    );

    if (!imageItems.length) {
      const htmlSources = extractImageSourcesFromHtml(clipboard.getData("text/html"));
      const ephemeralSources = htmlSources.filter((source) => isEphemeralImageSource(source));
      if (!ephemeralSources.length) {
        return false;
      }

      event.preventDefault();

      void (async () => {
        let unresolvedCount = 0;
        for (const source of ephemeralSources) {
          const resolved = await resolveEphemeralImageSourceForSave(source);
          const persistedSrc = String(resolved.src || "").trim();
          if (persistedSrc && persistedSrc !== source) {
            const inserted = insertImageWithCriticalSave(persistedSrc);
            if (!inserted) {
              unresolvedCount += 1;
            }
            continue;
          }
          unresolvedCount += 1;
        }
        if (unresolvedCount > 0) {
          window.alert(
            "One or more pasted images could not be persisted. Re-paste those images directly from your clipboard."
          );
        }
      })();

      return true;
    }

    event.preventDefault();

    void (async () => {
      for (const item of imageItems) {
        const file = item.getAsFile();
        if (!file) {
          continue;
        }
        try {
          await insertImageFromFileWithSave(file);
        } catch (error) {
          const message =
            error instanceof Error ? error.message : "Unable to paste image.";
          window.alert(message);
        }
      }
    })();

    return true;
  }, [
    insertImageFromFileWithSave,
    insertImageWithCriticalSave,
    resolveEphemeralImageSourceForSave,
  ]);

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
      MentionHighlightExtension,
      TaskList,
      TaskItem.configure({ nested: true }),
      NoteShape,
      NoteTextBox,
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
    content: initialImageIntegrity.content,
    editorProps: {
      attributes: {
        class: "note-editor",
      },
      handleKeyDown: handleEditorKeyDown,
      handlePaste,
    },
    onUpdate: ({ editor, transaction }) => {
      updateSlashMenu(editor);
      updateMentionMenu(editor);
      const nextColType = getActiveTableColumnType(editor);
      setActiveTableColType((prev) => (prev === nextColType ? prev : nextColType));
      setSaveError((prev) => (prev ? "" : prev));
      setSaveWarning((prev) => (prev ? "" : prev));
      setSaveState("saving");
      if (saveTimer.current) {
        clearTimeout(saveTimer.current);
      }
      const json = editor.getJSON();
      persistDraftSnapshot(json, true);
      const isCriticalSave = Boolean(transaction.getMeta(NOTE_CRITICAL_SAVE_META_KEY));
      if (isCriticalSave) {
        void persistEditorSaveImmediate(json);
        return;
      }
      saveTimer.current = setTimeout(() => {
        saveTimer.current = null;
        void persistEditorSave(json);
      }, 600);
    },
    onTransaction: ({ transaction }) => {
      const overlayCommitMeta = transaction.getMeta(
        NOTE_OVERLAY_COMMIT_META_KEY
      ) as OverlayCommitMeta | null;
      if (!overlayCommitMeta || overlayCommitMeta.result !== "resolve_failed") {
        return;
      }
      if (saveTimer.current) {
        clearTimeout(saveTimer.current);
        saveTimer.current = null;
      }
      setSaveError(NOTE_OVERLAY_SAVE_ERROR_MESSAGE);
      setSaveState("error");
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
    if (!liveContentSnapshot) {
      return;
    }
    pendingLiveSnapshotRef.current = liveContentSnapshot;
    applyPendingLiveSnapshot();
  }, [applyPendingLiveSnapshot, liveContentSnapshot]);

  useEffect(() => {
    applyPendingLiveSnapshot();
  }, [applyPendingLiveSnapshot, saveState]);

  useEffect(() => {
    if (!editor || restoredDraftRef.current) {
      return;
    }
    restoredDraftRef.current = true;
    try {
      const raw = window.sessionStorage.getItem(draftStorageKey);
      if (!raw) {
        return;
      }
      const parsed = JSON.parse(raw) as {
        content?: unknown;
        dirty?: boolean;
        updatedAt?: unknown;
      };
      if (!parsed?.dirty || !parsed.content) {
        return;
      }
      const draftUpdatedAtMs = parseTimestampMs(parsed.updatedAt);
      if (
        initialUpdatedAtMs !== null
        && draftUpdatedAtMs !== null
        && draftUpdatedAtMs <= initialUpdatedAtMs
      ) {
        window.sessionStorage.removeItem(draftStorageKey);
        return;
      }
      const initialJson = JSON.stringify(initialImageIntegrity.content);
      const draftJson = JSON.stringify(parsed.content);
      if (initialJson === draftJson) {
        return;
      }
      const normalizedDraft = normalizeContent(parsed.content);
      const draftWithIntegrity = enforceImageNodeIntegrity
        ? removeMissingSrcImageNodes(normalizedDraft)
        : { content: normalizedDraft, removedCount: 0 };
      if (draftWithIntegrity.removedCount > 0) {
        setSaveWarning(
          `${draftWithIntegrity.removedCount} broken image placeholder${
            draftWithIntegrity.removedCount === 1 ? "" : "s"
          } removed from this draft. Re-paste images if needed.`
        );
      }
      restoredDraftContentRef.current = true;
      editor.commands.setContent(normalizeContent(draftWithIntegrity.content));
      setSaveState("saving");
    } catch {
      // Ignore malformed draft snapshots.
    }
  }, [draftStorageKey, editor, enforceImageNodeIntegrity, initialImageIntegrity.content, initialUpdatedAtMs]);

  useEffect(() => {
    if (!editor || !enforceImageNodeIntegrity) {
      return;
    }
    if (legacyMissingImageCleanupAppliedRef.current) {
      return;
    }
    if (restoredDraftContentRef.current) {
      legacyMissingImageCleanupAppliedRef.current = true;
      return;
    }
    if (initialImageIntegrity.removedCount <= 0) {
      legacyMissingImageCleanupAppliedRef.current = true;
      return;
    }

    legacyMissingImageCleanupAppliedRef.current = true;
    setSaveWarning(
      `${initialImageIntegrity.removedCount} broken image placeholder${
        initialImageIntegrity.removedCount === 1 ? "" : "s"
      } removed from this page. Re-paste images if needed.`
    );
    if (imageDebugEnabled) {
      logClientWarn("note_editor.image.load_removed_missing_src", {
        entityId,
        removedCount: initialImageIntegrity.removedCount,
      });
    }
    void persistEditorSaveImmediate(initialImageIntegrity.content);
  }, [
    imageDebugEnabled,
    editor,
    enforceImageNodeIntegrity,
    entityId,
    initialImageIntegrity.content,
    initialImageIntegrity.removedCount,
    persistEditorSaveImmediate,
  ]);

  useEffect(() => {
    if (!editor) {
      return;
    }
    const tr = editor.state.tr;
    let hasUpgradeChanges = false;
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === "noteShape") {
        const attrs = node.attrs as Record<string, unknown>;
        const hasObjectId =
          typeof attrs.objectId === "string" && attrs.objectId.trim().length > 0;
        const hasZIndex = Number.isFinite(Number(attrs.zIndex));
        if (!hasObjectId || !hasZIndex) {
          tr.setNodeMarkup(pos, undefined, normalizeNoteShapeAttrs(attrs));
          hasUpgradeChanges = true;
        }
      }
      if (node.type.name === "noteTextBox") {
        const attrs = node.attrs as Record<string, unknown>;
        const hasObjectId =
          typeof attrs.objectId === "string" && attrs.objectId.trim().length > 0;
        const hasZIndex = Number.isFinite(Number(attrs.zIndex));
        if (!hasObjectId || !hasZIndex) {
          tr.setNodeMarkup(pos, undefined, normalizeNoteTextBoxAttrs(attrs));
          hasUpgradeChanges = true;
        }
      }
      return true;
    });
    if (!hasUpgradeChanges || !tr.docChanged) {
      return;
    }
    tr.setMeta(NOTE_CRITICAL_SAVE_META_KEY, true);
    editor.view.dispatch(tr);
  }, [editor]);

  useEffect(() => {
    if (!onViewStateChange) {
      return;
    }
    if (viewStateTimerRef.current) {
      clearTimeout(viewStateTimerRef.current);
    }
    viewStateTimerRef.current = setTimeout(() => {
      startTransition(() => {
        void onViewStateChange({
          ribbonTab: activeRibbonTab,
          zoomPercent,
          focusMode,
        });
      });
    }, 450);
    return () => {
      if (viewStateTimerRef.current) {
        clearTimeout(viewStateTimerRef.current);
        viewStateTimerRef.current = null;
      }
    };
  }, [activeRibbonTab, focusMode, onViewStateChange, startTransition, zoomPercent]);

  useEffect(() => {
    if (!onFocusModeChange) {
      return;
    }
    onFocusModeChange(focusMode);
  }, [focusMode, onFocusModeChange]);

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
      flushPendingSave({ immediate: true });
      if (saveStatusTimerRef.current) {
        clearTimeout(saveStatusTimerRef.current);
      }
      if (viewStateTimerRef.current) {
        clearTimeout(viewStateTimerRef.current);
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
  }, [flushPendingSave]);

  useEffect(() => {
    const handlePageHide = () => flushPendingSave({ immediate: true });
    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        flushPendingSave({ immediate: true });
      }
    };

    window.addEventListener("pagehide", handlePageHide);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      window.removeEventListener("pagehide", handlePageHide);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [flushPendingSave]);

  useEffect(() => {
    if (!blockNavigationWhileSaving) {
      return;
    }
    const onDocumentClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0) {
        return;
      }
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
        return;
      }
      const target = event.target as Element | null;
      const link = target?.closest("a[href]") as HTMLAnchorElement | null;
      if (!link) {
        return;
      }
      if (link.target && link.target !== "_self") {
        return;
      }
      if (link.hasAttribute("download")) {
        return;
      }
      const href = String(link.getAttribute("href") || "").trim();
      if (
        !href ||
        href.startsWith("#") ||
        href.startsWith("mailto:") ||
        href.startsWith("tel:") ||
        href.startsWith("javascript:")
      ) {
        return;
      }

      const nextUrl = new URL(link.href, window.location.href);
      if (nextUrl.origin !== window.location.origin) {
        return;
      }

      if (
        nextUrl.pathname === window.location.pathname &&
        nextUrl.search === window.location.search
      ) {
        return;
      }

      if (!hasActiveSaveWork()) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      if (navigationGuardInFlightRef.current) {
        return;
      }
      navigationGuardInFlightRef.current = true;
      logSaveDebug("navigation_guard_wait_start", { href: nextUrl.toString() });
      void flushPendingSaveAndWait({ timeoutMs: NAVIGATION_SAVE_TIMEOUT_MS })
        .then((didCommitLatest) => {
          if (!didCommitLatest) {
            if (!hasActiveSaveWork()) {
              window.location.assign(nextUrl.toString());
              return;
            }
            logSaveDebug("navigation_guard_wait_timeout_blocked", {
              href: nextUrl.toString(),
            });
            const shouldLeaveWithoutSave = window.confirm(
              "Still saving your latest changes. Leave anyway? Your latest edits may be lost."
            );
            if (shouldLeaveWithoutSave) {
              window.location.assign(nextUrl.toString());
            }
            return;
          }
          window.location.assign(nextUrl.toString());
        })
        .finally(() => {
          navigationGuardInFlightRef.current = false;
        });
    };

    document.addEventListener("click", onDocumentClick, true);
    return () => {
      document.removeEventListener("click", onDocumentClick, true);
    };
  }, [
    blockNavigationWhileSaving,
    flushPendingSaveAndWait,
    hasActiveSaveWork,
    logSaveDebug,
  ]);

  useEffect(() => {
    if (!taskCreator.open) {
      return;
    }
    const timer = window.setTimeout(() => taskTitleRef.current?.focus(), 0);
    return () => window.clearTimeout(timer);
  }, [taskCreator.open]);

  useEffect(() => {
    if (!taskCreator.open) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") {
        return;
      }
      event.preventDefault();
      closeTaskCreator();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [closeTaskCreator, taskCreator.open]);

  useEffect(() => {
    if (!taskCreator.open) {
      return;
    }
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) {
        return;
      }
      if (taskCreatorPanelRef.current?.contains(target)) {
        return;
      }
      closeTaskCreator();
    };
    window.addEventListener("pointerdown", onPointerDown, true);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown, true);
    };
  }, [closeTaskCreator, taskCreator.open]);

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

    const handleClick = (event: MouseEvent) => {
      if (contextMenuRef.current?.contains(event.target as Node)) {
        return;
      }
      closeContextMenu();
    };
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
    if (!shapeMenuOpen) {
      setShapeMenuPosition(null);
      return;
    }

    updateShapeMenuPosition();

    const handleClick = (event: MouseEvent) => {
      const target = event.target as Node;
      if (
        shapeMenuRef.current?.contains(target) ||
        shapeMenuPopupRef.current?.contains(target)
      ) {
        return;
      }
      setShapeMenuOpen(false);
    };

    const handleEsc = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setShapeMenuOpen(false);
      }
    };

    const handleReposition = () => updateShapeMenuPosition();

    window.addEventListener("click", handleClick);
    window.addEventListener("keydown", handleEsc);
    window.addEventListener("resize", handleReposition);
    window.addEventListener("scroll", handleReposition, true);
    return () => {
      window.removeEventListener("click", handleClick);
      window.removeEventListener("keydown", handleEsc);
      window.removeEventListener("resize", handleReposition);
      window.removeEventListener("scroll", handleReposition, true);
    };
  }, [shapeMenuOpen, updateShapeMenuPosition]);

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

      const target = event.target instanceof Element ? event.target : null;
      const inTable = Boolean(target?.closest("table"));
      const overlayContext = editor
        ? resolveOverlayNodeFromContextMenuTarget(editor, target, event.clientX, event.clientY)
        : {
            overlayNodeType: null,
            overlayNodePos: null,
          };

      if (editor) {
        if (overlayContext.overlayNodePos !== null) {
          editor.commands.focus();
        } else {
          const pos = editor.view.posAtCoords({
            left: event.clientX,
            top: event.clientY,
          });
          if (pos) {
            editor.chain().focus().setTextSelection(pos.pos).run();
          } else {
            editor.commands.focus();
          }
        }
      }

      setShapeMenuOpen(false);
      setContextMenuFavoritesPickerOpen(false);
      setContextMenu({
        open: true,
        x: event.clientX,
        y: event.clientY,
        inTable,
        overlayNodeType: overlayContext.overlayNodeType,
        overlayNodePos: overlayContext.overlayNodePos,
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

  const deleteContextOverlayItem = useCallback(() => {
    if (!editor) {
      return;
    }
    const overlayNodePos = contextMenu.overlayNodePos;
    const overlayNodeType = contextMenu.overlayNodeType;
    if (overlayNodePos === null || overlayNodeType === null) {
      return;
    }

    const node = editor.state.doc.nodeAt(overlayNodePos);
    if (!node || node.type.name !== overlayNodeType) {
      return;
    }

    run(() => {
      const tr = editor.state.tr.delete(overlayNodePos, overlayNodePos + node.nodeSize);
      editor.view.dispatch(tr);
    });
  }, [contextMenu.overlayNodePos, contextMenu.overlayNodeType, editor, run]);

  const mutateSelectedOverlayAttrs = useCallback(
    (
      mutator: (
        attrs: NoteShapeAttrs | NoteTextBoxAttrs,
        nodeType: OverlayNodeType
      ) => NoteShapeAttrs | NoteTextBoxAttrs
    ) => {
      if (!editor) {
        return false;
      }
      const selected = resolveSelectedOverlayNode(editor);
      if (!selected || !isOverlayNodeTypeName(selected.node.type.name)) {
        return false;
      }
      const nodeType = selected.node.type.name;
      const normalizedCurrent =
        nodeType === "noteShape"
          ? normalizeNoteShapeAttrs(selected.node.attrs as Record<string, unknown>)
          : normalizeNoteTextBoxAttrs(selected.node.attrs as Record<string, unknown>);
      const next = mutator(normalizedCurrent, nodeType);
      if (nodeType === "noteShape") {
        const currentShapeAttrs = normalizedCurrent as NoteShapeAttrs;
        const committed = commitOverlayNodeAttrs<NoteShapeAttrs>({
          editor,
          nodeType: "noteShape",
          dom: null,
          knownPos: selected.pos,
          fallbackObjectId: currentShapeAttrs.objectId,
          previousAttrs: currentShapeAttrs,
          nextAttrs: next as NoteShapeAttrs,
          normalize: normalizeNoteShapeAttrs,
          equals: areNoteShapeAttrsEqual,
        });
        return committed.result !== "resolve_failed";
      }
      const currentTextBoxAttrs = normalizedCurrent as NoteTextBoxAttrs;
      const committed = commitOverlayNodeAttrs<NoteTextBoxAttrs>({
        editor,
        nodeType: "noteTextBox",
        dom: null,
        knownPos: selected.pos,
        fallbackObjectId: currentTextBoxAttrs.objectId,
        previousAttrs: currentTextBoxAttrs,
        nextAttrs: next as NoteTextBoxAttrs,
        normalize: normalizeNoteTextBoxAttrs,
        equals: areNoteTextBoxAttrsEqual,
      });
      return committed.result !== "resolve_failed";
    },
    [editor]
  );

  const bringOverlayForward = useCallback(() => {
    mutateSelectedOverlayAttrs((attrs) => ({
      ...attrs,
      zIndex: Math.min(200, Number(attrs.zIndex || 1) + 1),
    }));
  }, [mutateSelectedOverlayAttrs]);

  const sendOverlayBackward = useCallback(() => {
    mutateSelectedOverlayAttrs((attrs) => ({
      ...attrs,
      zIndex: Math.max(1, Number(attrs.zIndex || 1) - 1),
    }));
  }, [mutateSelectedOverlayAttrs]);

  const alignOverlay = useCallback(
    (direction: "left" | "center" | "right" | "top" | "middle" | "bottom") => {
      if (!editor) return;
      const editorElement = editor.view.dom as HTMLElement;
      const editorWidth = Math.max(320, editorElement.clientWidth || 0);
      const editorHeight = Math.max(300, editorElement.clientHeight || 0);
      mutateSelectedOverlayAttrs((attrs) => {
        const next = { ...attrs };
        if (direction === "left") next.x = 16;
        if (direction === "center") next.x = Math.max(0, Math.round((editorWidth - attrs.width) / 2));
        if (direction === "right") next.x = Math.max(0, editorWidth - attrs.width - 16);
        if (direction === "top") next.y = 16;
        if (direction === "middle") next.y = Math.max(0, Math.round((editorHeight - attrs.height) / 2));
        if (direction === "bottom") next.y = Math.max(0, editorHeight - attrs.height - 16);
        return next;
      });
    },
    [editor, mutateSelectedOverlayAttrs]
  );

  const resizeOverlayBy = useCallback(
    (delta: number) => {
      mutateSelectedOverlayAttrs((attrs, nodeType) => {
        const nextWidth = Math.max(80, attrs.width + delta);
        const nextHeight = Math.max(60, attrs.height + delta);
        if (nodeType === "noteShape") {
          const shapeAttrs = attrs as NoteShapeAttrs;
          if (shapeAttrs.kind === "square" || shapeAttrs.kind === "circle") {
            const squareSize = Math.max(nextWidth, nextHeight);
            return { ...shapeAttrs, width: squareSize, height: squareSize };
          }
        }
        return {
          ...attrs,
          width: nextWidth,
          height: nextHeight,
        };
      });
    },
    [mutateSelectedOverlayAttrs]
  );

  const snapOverlayToGrid = useCallback(() => {
    mutateSelectedOverlayAttrs((attrs, nodeType) => {
      const next = {
        ...attrs,
        x: Math.round(attrs.x / 12) * 12,
        y: Math.round(attrs.y / 12) * 12,
        width: Math.round(attrs.width / 12) * 12,
        height: Math.round(attrs.height / 12) * 12,
      };
      if (nodeType === "noteShape") {
        const shapeNext = next as NoteShapeAttrs;
        if (shapeNext.kind === "square" || shapeNext.kind === "circle") {
          const squareSize = Math.max(shapeNext.width, shapeNext.height);
          shapeNext.width = squareSize;
          shapeNext.height = squareSize;
        }
        return shapeNext;
      }
      return next;
    });
  }, [mutateSelectedOverlayAttrs]);

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

      if (actionId === "bold") {
        run(() => editor.chain().focus().toggleBold().run());
        return;
      }
      if (actionId === "italic") {
        run(() => editor.chain().focus().toggleItalic().run());
        return;
      }
      if (actionId === "underline") {
        run(() => editor.chain().focus().toggleUnderline().run());
        return;
      }
      if (actionId === "highlight") {
        run(() => editor.chain().focus().toggleHighlight().run());
        return;
      }
      if (actionId === "fontSizeUp" || actionId === "fontSizeDown") {
        const currentFontSize = String(editor.getAttributes("textStyle")?.fontSize || "");
        const nextFontSize = getNextFontSizeValue(
          currentFontSize,
          actionId === "fontSizeUp" ? "up" : "down"
        );
        if (nextFontSize) {
          run(() => editor.chain().focus().setFontSize(nextFontSize).run());
        } else {
          run(() => editor.chain().focus().unsetFontSize().run());
        }
        return;
      }
      if (actionId === "textColorSlate") {
        run(() => editor.chain().focus().setMark("textStyle", { color: "#0f172a" }).run());
        return;
      }
      if (actionId === "textColorBlue") {
        run(() => editor.chain().focus().setMark("textStyle", { color: "#1d4ed8" }).run());
        return;
      }
      if (actionId === "textColorRed") {
        run(() => editor.chain().focus().setMark("textStyle", { color: "#dc2626" }).run());
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
      if (actionId === "insertShape") {
        run(() => insertNoteShapeAtSelection(editor, "rectangle"));
        return;
      }
      if (actionId === "insertArrow") {
        run(() => insertNoteShapeAtSelection(editor, "arrow"));
        return;
      }
      if (actionId === "insertTextBox") {
        run(() => insertNoteTextBoxAtSelection(editor));
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
    insertImageWithCriticalSave(trimmedSrc);
  }, [editor, insertImageWithCriticalSave]);

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

  const insertShapeByKind = useCallback((kind: NoteShapeKind) => {
    if (!editor) {
      return;
    }
    insertNoteShapeAtSelection(editor, kind);
    setShapeMenuOpen(false);
  }, [editor]);

  const insertTextBoxTemplate = useCallback(() => {
    if (!editor) {
      return;
    }
    insertNoteTextBoxAtSelection(editor);
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
      const isImageFile = file.type.startsWith("image/");
      const maxAttachmentBytes = isImageFile ? MAX_UPLOADED_IMAGE_BYTES : 5 * 1024 * 1024;
      if (file.size > maxAttachmentBytes) {
        window.alert(
          isImageFile
            ? "Image is too large. Use images up to 10 MB."
            : "Attachment is too large. Use files up to 5 MB."
        );
        return;
      }
      void (async () => {
        if (isImageFile) {
          try {
            await insertImageFromFileWithSave(file);
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
    [editor, insertImageFromFileWithSave]
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

  const selectedOverlayNode = editor ? resolveSelectedOverlayNode(editor) : null;
  const canLayoutOverlay = Boolean(selectedOverlayNode);
  const reviewStats = editor
    ? (() => {
        const plainText = normalizeInlineText(editor.state.doc.textBetween(0, editor.state.doc.content.size, " "));
        const words = plainText ? plainText.split(/\s+/).filter(Boolean).length : 0;
        const readingMinutes = words ? Math.max(1, Math.ceil(words / 220)) : 0;
        const mentions = (plainText.match(/@[a-z0-9._-]+/gi) || []).length;
        const linkedTaskRefs = (plainText.match(/\/tasks\/[a-f0-9-]+/gi) || []).length;
        return {
          words,
          readingMinutes,
          mentions,
          linkedTaskRefs,
        };
      })()
    : { words: 0, readingMinutes: 0, mentions: 0, linkedTaskRefs: 0 };
  const outlineHeadings = editor
    ? (() => {
        const headings: Array<{ id: string; label: string; level: number }> = [];
        let headingIndex = 0;
        editor.state.doc.descendants((node, pos) => {
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
      })()
    : [];
  const isHomeTab = activeRibbonTab === "home";
  const isInsertTab = activeRibbonTab === "insert";
  const isLayoutTab = activeRibbonTab === "layout";
  const isReviewTab = activeRibbonTab === "review";
  const isViewTab = activeRibbonTab === "view";
  const editorRibbonTabIsActive = !suppressToolbarGroups;
  const selectedOverlayLabel = selectedOverlayNode
    ? selectedOverlayNode.node.type.name === "noteShape"
      ? "Shape selected"
      : "Text box selected"
    : "No shape or text box selected";

  if (!editor) {
    return (
      <div className="rounded-lg border border-slate-200 bg-white p-6">
        <div className="h-[240px] animate-pulse rounded-md bg-slate-100" />
      </div>
    );
  }

  const activeSlashItem = slashMenu.items[slashMenu.index];
  const activeMentionItem = mentionMenu.items[mentionMenu.index];
  const contextMenuOverlayDeleteLabel =
    contextMenu.overlayNodeType === "noteShape"
      ? "Delete shape"
      : contextMenu.overlayNodeType === "noteTextBox"
      ? "Delete text box"
      : "Delete item";
  const fillHeightEditor = editorHeightMode === "fill";
  const editorContentStyle = fillHeightEditor ? { minHeight: "100%" } : undefined;

  return (
    <section
      className={`rounded-lg border bg-white ${
        fillHeightEditor ? "flex h-full min-h-0 flex-col overflow-hidden p-1.5" : "p-2"
      } ${
        focusMode ? "border-slate-300 shadow-sm" : "border-slate-200"
      }`}
      aria-label={title}
    >

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

      {showTopToolbar ? null : (
        <div className={`mt-2 text-xs font-medium ${saveState === "error" ? "text-red-600" : "text-slate-500"}`}>
          {saveState === "saving"
            ? "Saving..."
            : saveState === "saved"
            ? "Saved"
            : saveState === "error"
            ? "Save failed"
            : "Ready"}
        </div>
      )}

      {showTopToolbar ? (
        <div
          className={`sticky top-0 z-20 shrink-0 rounded-md border border-slate-200 bg-white px-2 py-1 ${
            taskToast ? "mt-3" : ""
          }`}
        >
          <div className="mb-0.5 flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-1">
            <div className="flex min-w-0 flex-wrap items-center gap-1" role="tablist" aria-label="Editor tabs">
              {RIBBON_TABS.map((tab) => {
                const isActive = activeRibbonTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => {
                      setActiveRibbonTab(tab.id);
                      onRibbonTabSelect?.(tab.id);
                    }}
                    role="tab"
                    aria-selected={editorRibbonTabIsActive && isActive}
                    className={`rounded-t-md border border-b-0 px-3 py-1 text-xs font-semibold transition ${
                      editorRibbonTabIsActive && isActive
                        ? "border-slate-300 bg-white text-slate-900"
                        : "border-transparent bg-transparent text-slate-500 hover:text-slate-700"
                    }`}
                  >
                    {tab.label}
                  </button>
                );
              })}
              {adjacentToolbarTabs.length ? (
                <span className="mx-1 h-5 w-px bg-slate-200" aria-hidden="true" />
              ) : null}
              {adjacentToolbarTabs.map((tab) => (
                tab.onSelect ? (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={tab.onSelect}
                    role="tab"
                    aria-selected={Boolean(tab.active)}
                    className={`rounded-t-md border border-b-0 px-3 py-1 text-xs font-semibold transition ${
                      tab.active
                        ? "border-slate-300 bg-white text-slate-900"
                        : "border-transparent bg-transparent text-slate-500 hover:text-slate-700"
                    }`}
                  >
                    {tab.label}
                  </button>
                ) : (
                  <a
                    key={tab.id}
                    href={tab.href}
                    role="tab"
                    aria-selected={Boolean(tab.active)}
                    className={`rounded-t-md border border-b-0 px-3 py-1 text-xs font-semibold transition ${
                      tab.active
                        ? "border-slate-300 bg-white text-slate-900"
                        : "border-transparent bg-transparent text-slate-500 hover:text-slate-700"
                    }`}
                  >
                    {tab.label}
                  </a>
                )
              ))}
            </div>
            <div
              className={`shrink-0 text-xs font-medium ${
                saveState === "error" ? "text-red-600" : "text-slate-500"
              }`}
            >
              {saveState === "saving"
                ? "Saving..."
                : saveState === "saved"
                ? "Saved"
                : saveState === "error"
                ? "Save failed"
                : "Ready"}
            </div>
          </div>
          {suppressToolbarGroups ? (
            toolbarPanel ? (
              <div className="-mx-1 max-h-[32vh] overflow-y-auto px-1 pb-1 pr-2">
                {toolbarPanel}
              </div>
            ) : null
          ) : (
            <div
              className={`-mx-1 px-1 ${
                disableHorizontalScroll ? "overflow-x-hidden" : "overflow-x-auto"
              }`}
            >
              <div
                className={`flex items-start gap-1.5 ${
                  disableHorizontalScroll ? "flex-wrap" : "min-w-max"
                }`}
              >
                {isHomeTab ? (
                  <>
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
                </>
              ) : null}

              {isInsertTab ? (
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
                  <div className="relative" ref={shapeMenuRef}>
                    <RibbonIconButton
                      label="Shape"
                      title="Insert shape"
                      onClick={() => {
                        setShapeMenuOpen((prev) => {
                          const next = !prev;
                          if (next) {
                            window.requestAnimationFrame(() => updateShapeMenuPosition());
                          }
                          return next;
                        });
                      }}
                      active={shapeMenuOpen}
                      icon={<ShapeIcon />}
                    />
                  </div>
                  <RibbonIconButton
                    label="Text box"
                    onClick={insertTextBoxTemplate}
                    icon={<TextBoxIcon />}
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
              ) : null}

              {isLayoutTab ? (
                <>
                  <RibbonGroup title="Arrange">
                    <RibbonIconButton
                      label="Forward"
                      title="Bring selected object forward"
                      onClick={bringOverlayForward}
                      disabled={!canLayoutOverlay}
                      icon={<span className="text-[11px] leading-none">Z+</span>}
                    />
                    <RibbonIconButton
                      label="Backward"
                      title="Send selected object backward"
                      onClick={sendOverlayBackward}
                      disabled={!canLayoutOverlay}
                      icon={<span className="text-[11px] leading-none">Z-</span>}
                    />
                    <RibbonIconButton
                      label="Snap"
                      title="Snap selected object to grid"
                      onClick={snapOverlayToGrid}
                      disabled={!canLayoutOverlay}
                      icon={<span className="text-[11px] leading-none">#</span>}
                    />
                  </RibbonGroup>
                  <RibbonGroup title="Align">
                    <RibbonIconButton
                      label="Left"
                      onClick={() => alignOverlay("left")}
                      disabled={!canLayoutOverlay}
                      icon={<AlignIcon align="left" />}
                      iconOnly
                    />
                    <RibbonIconButton
                      label="Center"
                      onClick={() => alignOverlay("center")}
                      disabled={!canLayoutOverlay}
                      icon={<AlignIcon align="center" />}
                      iconOnly
                    />
                    <RibbonIconButton
                      label="Right"
                      onClick={() => alignOverlay("right")}
                      disabled={!canLayoutOverlay}
                      icon={<AlignIcon align="right" />}
                      iconOnly
                    />
                    <RibbonIconButton
                      label="Top"
                      onClick={() => alignOverlay("top")}
                      disabled={!canLayoutOverlay}
                      icon={<span className="text-[11px] leading-none">T</span>}
                      iconOnly
                    />
                    <RibbonIconButton
                      label="Middle"
                      onClick={() => alignOverlay("middle")}
                      disabled={!canLayoutOverlay}
                      icon={<span className="text-[11px] leading-none">M</span>}
                      iconOnly
                    />
                    <RibbonIconButton
                      label="Bottom"
                      onClick={() => alignOverlay("bottom")}
                      disabled={!canLayoutOverlay}
                      icon={<span className="text-[11px] leading-none">B</span>}
                      iconOnly
                    />
                  </RibbonGroup>
                  <RibbonGroup title="Size">
                    <RibbonIconButton
                      label="Bigger"
                      onClick={() => resizeOverlayBy(12)}
                      disabled={!canLayoutOverlay}
                      icon={<span className="text-[11px] leading-none">+</span>}
                    />
                    <RibbonIconButton
                      label="Smaller"
                      onClick={() => resizeOverlayBy(-12)}
                      disabled={!canLayoutOverlay}
                      icon={<span className="text-[11px] leading-none">-</span>}
                    />
                  </RibbonGroup>
                  <p className="self-center px-2 text-xs text-slate-500">
                    {selectedOverlayLabel}
                  </p>
                </>
              ) : null}

              {isReviewTab ? (
                <>
                  <RibbonGroup title="Document">
                    <p className="px-1 text-[11px] text-slate-700">
                      {reviewStats.words.toLocaleString()} words
                    </p>
                    <p className="px-1 text-[11px] text-slate-600">
                      {reviewStats.readingMinutes
                        ? `${reviewStats.readingMinutes} min read`
                        : "No reading time"}
                    </p>
                    <p className="px-1 text-[11px] text-slate-600">
                      {reviewStats.mentions} mentions
                    </p>
                    <p className="px-1 text-[11px] text-slate-600">
                      {reviewStats.linkedTaskRefs} linked tasks
                    </p>
                  </RibbonGroup>
                  {onCreateTask ? (
                    <RibbonGroup title="Tasks">
                      <RibbonIconButton
                        label="Create task"
                        onClick={() => openTaskCreator(getSuggestedTaskTitle(editor))}
                        icon={<span className="text-sm leading-none">+</span>}
                      />
                    </RibbonGroup>
                  ) : null}
                </>
              ) : null}

              {isViewTab ? (
                <>
                  <RibbonGroup title="Zoom">
                    <RibbonIconButton
                      label="Zoom out"
                      onClick={() => setZoomPercent((prev) => Math.max(20, prev - 10))}
                      icon={<span className="text-[11px] leading-none">-</span>}
                    />
                    <RibbonIconButton
                      label={`${zoomPercent}%`}
                      onClick={() => setZoomPercent(100)}
                      icon={<span className="text-[11px] leading-none">1:1</span>}
                    />
                    <RibbonIconButton
                      label="Zoom in"
                      onClick={() => setZoomPercent((prev) => Math.min(1000, prev + 10))}
                      icon={<span className="text-[11px] leading-none">+</span>}
                    />
                  </RibbonGroup>
                  <RibbonGroup title="View">
                    <RibbonIconButton
                      label={focusMode ? "Exit focus" : "Focus mode"}
                      onClick={() => setFocusMode((prev) => !prev)}
                      active={focusMode}
                      icon={<span className="text-[11px] leading-none">F</span>}
                    />
                    <RibbonIconButton
                      label={showOutline ? "Hide outline" : "Show outline"}
                      onClick={() => setShowOutline((prev) => !prev)}
                      active={showOutline}
                      icon={<span className="text-[11px] leading-none">O</span>}
                    />
                    <RibbonIconButton
                      label={showLayoutGrid ? "Hide grid" : "Show grid"}
                      onClick={() => setShowLayoutGrid((prev) => !prev)}
                      active={showLayoutGrid}
                      icon={<span className="text-[11px] leading-none">#</span>}
                    />
                  </RibbonGroup>
                </>
              ) : null}
              </div>
            </div>
          )}
        </div>
      ) : null}

      {saveError ? (
        <p className="mt-2 shrink-0 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {saveError}
        </p>
      ) : null}

      {saveWarning ? (
        <p className="mt-2 shrink-0 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {saveWarning}
        </p>
      ) : null}

      <div
        ref={editorSurfaceRef}
        className={`${
          fillHeightEditor
            ? `${showTopToolbar ? "mt-1.5" : "mt-3"} min-h-0 flex-1 overflow-y-auto overscroll-contain pr-1`
            : showTopToolbar
              ? "mt-2"
              : "mt-4"
        } ${focusMode ? "md:px-8" : ""}`}
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
        {showOutline ? (
          <div className="mb-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              Outline
            </p>
            {outlineHeadings.length ? (
              <div className="mt-2 space-y-1">
                {outlineHeadings.map((heading) => (
                  <button
                    key={heading.id}
                    type="button"
                    onClick={() => {
                      const headingText = normalizeInlineText(heading.label);
                      if (!headingText) {
                        return;
                      }
                      let matched = false;
                      editor.state.doc.descendants((node, pos) => {
                        if (node.type.name !== "heading") {
                          return true;
                        }
                        if (normalizeInlineText(node.textContent || "") === headingText) {
                          editor
                            .chain()
                            .focus()
                            .setTextSelection({ from: pos + 1, to: pos + 1 })
                            .run();
                          matched = true;
                          return false;
                        }
                        return true;
                      });
                      if (!matched) return;
                    }}
                    className="block w-full truncate rounded-md px-2 py-1 text-left text-xs text-slate-700 hover:bg-white"
                    style={{ paddingLeft: `${Math.max(0, heading.level - 1) * 12 + 8}px` }}
                  >
                    {heading.label}
                  </button>
                ))}
              </div>
            ) : (
              <p className="mt-2 text-xs text-slate-500">No headings in this page yet.</p>
            )}
          </div>
        ) : null}
        <div
          className={`${fillHeightEditor ? "min-h-full rounded-md p-3" : "rounded-lg p-4"} border bg-white ${
            disableHorizontalScroll ? "overflow-x-hidden" : "overflow-x-auto"
          } ${
            focusMode ? "border-slate-300 shadow-sm" : "border-slate-200"
          }`}
          style={
            showLayoutGrid
              ? {
                  backgroundImage:
                    "linear-gradient(to right, rgba(148,163,184,0.2) 1px, transparent 1px), linear-gradient(to bottom, rgba(148,163,184,0.2) 1px, transparent 1px)",
                  backgroundSize: "12px 12px",
                }
              : undefined
          }
        >
          <div
            className={fillHeightEditor ? "min-h-full" : undefined}
            style={{
              transform: `scale(${editorScale})`,
              transformOrigin: "top left",
              width: `${100 / editorScale}%`,
            }}
          >
            <EditorContent editor={editor} style={editorContentStyle} />
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

      {shapeMenuOpen && shapeMenuPosition
        ? createPortal(
            <div
              ref={shapeMenuPopupRef}
              className="fixed z-[75] w-36 rounded-md border border-slate-200 bg-white p-1 shadow-lg"
              style={{ left: shapeMenuPosition.x, top: shapeMenuPosition.y }}
            >
              {NOTE_SHAPE_INSERT_OPTIONS.map((option) => (
                <button
                  key={`shape-option-${option.kind}`}
                  type="button"
                  onClick={() => insertShapeByKind(option.kind)}
                  className="context-menu-item"
                >
                  {option.label}
                </button>
              ))}
            </div>,
            document.body
          )
        : null}

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

              {contextMenu.overlayNodePos !== null ? (
                <>
                  <button
                    type="button"
                    onClick={deleteContextOverlayItem}
                    className="context-menu-item font-semibold text-red-600 hover:text-red-700"
                  >
                    {contextMenuOverlayDeleteLabel}
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
                {contextMenuFavoritesPickerOpen ? "Close favorites picker" : "Add favorite..."}
              </button>

              {contextMenuFavoritesPickerOpen ? (
                <div className="mt-1 rounded-lg border border-slate-200 bg-white shadow-sm">
                  <div className="border-b border-slate-200 px-2.5 py-2">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                      My favorites
                    </p>
                    <p className="text-[11px] text-slate-500">
                      Add quick right-click actions like bold, font color, and size.
                    </p>
                  </div>
                  <div className="max-h-64 overflow-y-auto p-1.5">
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
                            className={`ml-2 inline-flex min-w-[3.1rem] items-center justify-center rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                              isFavorite
                                ? "bg-slate-900 text-white"
                                : "bg-slate-100 text-slate-700"
                            }`}
                          >
                            {isFavorite ? "Added" : "+ Add"}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ) : null}

              {contextMenu.inTable ? (
                <>
                  <div className="my-1 border-t border-slate-200" />
                  <p className="px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    Table actions
                  </p>
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
                </>
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
              {contextMenu.overlayNodePos !== null ? (
                <>
                  <button
                    type="button"
                    onClick={deleteContextOverlayItem}
                    className="context-menu-item font-semibold text-red-600 hover:text-red-700"
                  >
                    {contextMenuOverlayDeleteLabel}
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

      {taskCreator.open
        ? createPortal(
            <div className="fixed inset-x-4 top-20 z-[90] flex justify-center sm:justify-end pointer-events-none">
              <div
                ref={taskCreatorPanelRef}
                className="pointer-events-auto w-full max-w-md rounded-lg border border-slate-200 bg-white p-5 shadow-xl"
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
            </div>,
            document.body
          )
        : null}

      <style jsx global>{`
        .note-editor a[href^="/tasks/"] {
          font-weight: 600;
        }
      `}</style>
    </section>
  );
}
