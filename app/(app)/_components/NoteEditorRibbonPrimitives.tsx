import type { ReactNode } from "react";
import {
  NOTE_TABLE_COLUMN_TYPES,
  type NoteTableColumnType,
} from "@/lib/noteEditorTableColumns";

export const TABLE_COLUMN_TYPES = NOTE_TABLE_COLUMN_TYPES;

export type TableColumnType = NoteTableColumnType;
export type WordTextAlign = "left" | "center" | "right" | "justify";
export type WordBlockStyle = "paragraph" | "h1" | "h2" | "h3" | "quote";
export type RibbonTabId = "home" | "insert" | "layout" | "review" | "view";

export const RIBBON_TABS: ReadonlyArray<{ id: RibbonTabId; label: string }> = [
  { id: "home", label: "Home" },
  { id: "insert", label: "Insert" },
  { id: "layout", label: "Layout" },
  { id: "review", label: "Review" },
  { id: "view", label: "View" },
];

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

export function RibbonGroup({ title, children }: RibbonGroupProps) {
  return (
    <div
      className="rounded-md border border-slate-200 bg-slate-50 px-1.5 py-1.5"
      aria-label={title}
    >
      <div className="flex flex-wrap items-center gap-1">{children}</div>
    </div>
  );
}

export function RibbonIconButton({
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

export function AlignIcon({ align }: { align: WordTextAlign }) {
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

export function ListBulletedIcon() {
  return (
    <svg viewBox="0 0 14 14" className="h-3.5 w-3.5" aria-hidden="true">
      <path d="M5 3.5h7M5 7h7M5 10.5h7" stroke="currentColor" strokeWidth="1.2" />
      <circle cx="2.4" cy="3.5" r="0.8" fill="currentColor" />
      <circle cx="2.4" cy="7" r="0.8" fill="currentColor" />
      <circle cx="2.4" cy="10.5" r="0.8" fill="currentColor" />
    </svg>
  );
}

export function ListNumberedIcon() {
  return (
    <svg viewBox="0 0 14 14" className="h-3.5 w-3.5" aria-hidden="true">
      <path d="M5 3.5h7M5 7h7M5 10.5h7" stroke="currentColor" strokeWidth="1.2" />
      <path d="M1.4 3h1v1.4M1.2 6.6h1.6M1.2 8.9l1.4-.8-1.4-.8" stroke="currentColor" strokeWidth="1.1" />
    </svg>
  );
}

export function ChecklistIcon() {
  return (
    <svg viewBox="0 0 14 14" className="h-3.5 w-3.5" aria-hidden="true">
      <path d="M5 3.5h7M5 7h7M5 10.5h7" stroke="currentColor" strokeWidth="1.2" />
      <path d="M1.5 2.8h2v2h-2zM1.5 6.3h2v2h-2zM1.5 9.8h2v2h-2z" stroke="currentColor" strokeWidth="1" fill="none" />
    </svg>
  );
}

export function PaintIcon() {
  return (
    <svg viewBox="0 0 14 14" className="h-3.5 w-3.5" aria-hidden="true">
      <path d="M2.5 8.5 7.2 3.8l3 3-4.7 4.7H2.5zM8.2 2.8l1-1a1.3 1.3 0 0 1 1.8 0l1.2 1.2a1.3 1.3 0 0 1 0 1.8l-1 1" stroke="currentColor" strokeWidth="1.1" fill="none" />
    </svg>
  );
}

export function ApplyIcon() {
  return (
    <svg viewBox="0 0 14 14" className="h-3.5 w-3.5" aria-hidden="true">
      <path d="M3 2.5h8v9H3zM4.8 6.8l1.3 1.3 3-3" stroke="currentColor" strokeWidth="1.1" fill="none" />
    </svg>
  );
}

export function ClearIcon() {
  return (
    <svg viewBox="0 0 14 14" className="h-3.5 w-3.5" aria-hidden="true">
      <path d="m3 9 3.2-3.2 3.2 3.2L6.8 11.6H4.2zM7.8 11.6H12" stroke="currentColor" strokeWidth="1.1" fill="none" />
    </svg>
  );
}

export function LinkIcon() {
  return (
    <svg viewBox="0 0 14 14" className="h-3.5 w-3.5" aria-hidden="true">
      <path d="M5.3 8.7 3.8 10.2a1.9 1.9 0 0 1-2.7-2.7l1.5-1.5a1.9 1.9 0 0 1 2.7 0M8.7 5.3l1.5-1.5a1.9 1.9 0 0 1 2.7 2.7l-1.5 1.5a1.9 1.9 0 0 1-2.7 0M4.8 9.2l4.4-4.4" stroke="currentColor" strokeWidth="1.1" fill="none" />
    </svg>
  );
}

export function ImageIcon() {
  return (
    <svg viewBox="0 0 14 14" className="h-3.5 w-3.5" aria-hidden="true">
      <path d="M2 2.5h10v9H2zM4 9l2-2 1.5 1.5L9.8 6 12 8.4" stroke="currentColor" strokeWidth="1.1" fill="none" />
      <circle cx="4.5" cy="5" r="0.8" fill="currentColor" />
    </svg>
  );
}

export function AttachmentIcon() {
  return (
    <svg viewBox="0 0 14 14" className="h-3.5 w-3.5" aria-hidden="true">
      <path d="M9.8 4.4 6 8.2a1.9 1.9 0 1 1-2.7-2.7l4-4a2.8 2.8 0 0 1 4 4l-4.1 4.1a3.6 3.6 0 0 1-5.1-5.1l3.8-3.8" stroke="currentColor" strokeWidth="1.1" fill="none" />
    </svg>
  );
}

export function TableIcon() {
  return (
    <svg viewBox="0 0 14 14" className="h-3.5 w-3.5" aria-hidden="true">
      <path d="M2 2.5h10v9H2zM2 5.5h10M2 8.5h10M5.3 2.5v9M8.7 2.5v9" stroke="currentColor" strokeWidth="1.1" fill="none" />
    </svg>
  );
}

export function SectionIcon() {
  return (
    <svg viewBox="0 0 14 14" className="h-3.5 w-3.5" aria-hidden="true">
      <path d="M2.5 2.5h9v9h-9zM4.5 4.5h5M4.5 6.8h3.5M4.5 9h4.2" stroke="currentColor" strokeWidth="1.1" fill="none" />
    </svg>
  );
}

export function ShapeIcon() {
  return (
    <svg viewBox="0 0 14 14" className="h-3.5 w-3.5" aria-hidden="true">
      <rect x="1.8" y="2.2" width="5.2" height="4.4" rx="0.8" stroke="currentColor" strokeWidth="1" fill="none" />
      <circle cx="10.3" cy="9.2" r="2.1" stroke="currentColor" strokeWidth="1" fill="none" />
      <path d="M6.8 5.2h2.2M8.5 4.2l1.2 1-1.2 1" stroke="currentColor" strokeWidth="1" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function TextBoxIcon() {
  return (
    <svg viewBox="0 0 14 14" className="h-3.5 w-3.5" aria-hidden="true">
      <rect x="1.5" y="2.2" width="11" height="9.6" rx="1.1" stroke="currentColor" strokeWidth="1" fill="none" />
      <path d="M4.2 5.1h5.6M7 5.1v3.6" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
    </svg>
  );
}

export function UndoIcon() {
  return (
    <svg viewBox="0 0 14 14" className="h-3.5 w-3.5" aria-hidden="true">
      <path d="M5.2 4 2.6 6.5 5.2 9M3 6.5h4.5a3.5 3.5 0 1 1 0 7" stroke="currentColor" strokeWidth="1.1" fill="none" />
    </svg>
  );
}

export function RedoIcon() {
  return (
    <svg viewBox="0 0 14 14" className="h-3.5 w-3.5" aria-hidden="true">
      <path d="m8.8 4 2.6 2.5-2.6 2.5M11 6.5H6.5a3.5 3.5 0 1 0 0 7" stroke="currentColor" strokeWidth="1.1" fill="none" />
    </svg>
  );
}
