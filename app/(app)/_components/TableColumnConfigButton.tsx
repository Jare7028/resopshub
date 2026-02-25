"use client";

import { useEffect, useMemo, useRef, useState } from "react";

export type TableColumnOption = {
  id: string;
  label: string;
  required?: boolean;
};

export default function TableColumnConfigButton({
  columns,
  visibleColumnIds,
  onVisibleColumnIdsChange,
  className = "",
}: {
  columns: TableColumnOption[];
  visibleColumnIds: string[];
  onVisibleColumnIdsChange: (nextVisibleColumnIds: string[]) => void;
  className?: string;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const visibleColumnIdSet = useMemo(() => new Set(visibleColumnIds), [visibleColumnIds]);
  const requiredColumnIdSet = useMemo(
    () => new Set(columns.filter((column) => column.required).map((column) => column.id)),
    [columns]
  );

  useEffect(() => {
    if (!isOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (!rootRef.current?.contains(target)) {
        setIsOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    };

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  const toggleColumn = (columnId: string) => {
    if (requiredColumnIdSet.has(columnId)) return;

    onVisibleColumnIdsChange(
      visibleColumnIdSet.has(columnId)
        ? visibleColumnIds.filter((id) => id !== columnId)
        : [...visibleColumnIds, columnId]
    );
  };

  const showAllColumns = () => {
    onVisibleColumnIdsChange(columns.map((column) => column.id));
  };

  return (
    <div className={`relative ${className}`.trim()} ref={rootRef}>
      <button
        type="button"
        onClick={() => setIsOpen((current) => !current)}
        className={`inline-flex min-h-11 items-center rounded-md border border-slate-300 px-2.5 py-1.5 text-slate-700 hover:border-slate-400 hover:text-slate-900 ${
          isOpen ? "bg-slate-100" : "bg-white"
        }`}
        aria-label="Customize table columns"
        aria-expanded={isOpen}
        aria-haspopup="dialog"
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="h-4 w-4"
        >
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1 1 0 0 0 .2 1.1l.1.1a1 1 0 0 1 0 1.4l-1.4 1.4a1 1 0 0 1-1.4 0l-.1-.1a1 1 0 0 0-1.1-.2 1 1 0 0 0-.6.9V20a1 1 0 0 1-1 1h-2a1 1 0 0 1-1-1v-.2a1 1 0 0 0-.6-.9 1 1 0 0 0-1.1.2l-.1.1a1 1 0 0 1-1.4 0l-1.4-1.4a1 1 0 0 1 0-1.4l.1-.1a1 1 0 0 0 .2-1.1 1 1 0 0 0-.9-.6H4a1 1 0 0 1-1-1v-2a1 1 0 0 1 1-1h.2a1 1 0 0 0 .9-.6 1 1 0 0 0-.2-1.1l-.1-.1a1 1 0 0 1 0-1.4l1.4-1.4a1 1 0 0 1 1.4 0l.1.1a1 1 0 0 0 1.1.2 1 1 0 0 0 .6-.9V4a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v.2a1 1 0 0 0 .6.9 1 1 0 0 0 1.1-.2l.1-.1a1 1 0 0 1 1.4 0l1.4 1.4a1 1 0 0 1 0 1.4l-.1.1a1 1 0 0 0-.2 1.1 1 1 0 0 0 .9.6H20a1 1 0 0 1 1 1v2a1 1 0 0 1-1 1h-.2a1 1 0 0 0-.9.6Z" />
        </svg>
      </button>

      {isOpen ? (
        <div
          role="dialog"
          aria-label="Customize table columns"
          className="absolute left-0 top-full z-40 mt-2 w-72 rounded-md border border-slate-200 bg-white p-3 shadow-lg"
        >
          <p className="mb-2 text-[11px] text-slate-500">
            Choose which columns are visible in table view.
          </p>
          <div className="max-h-56 overflow-auto">
            {columns.map((column) => {
              const isRequired = Boolean(column.required);
              return (
                <label
                  key={column.id}
                  className={`mb-1 flex items-center gap-2 rounded px-1 py-1 text-xs ${
                    isRequired
                      ? "cursor-default text-slate-400"
                      : "cursor-pointer text-slate-700 hover:bg-slate-50"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={visibleColumnIdSet.has(column.id)}
                    onChange={() => toggleColumn(column.id)}
                    disabled={isRequired}
                  />
                  <span>{column.label}</span>
                  {isRequired ? (
                    <span className="text-[10px] uppercase tracking-wide text-slate-400">
                      Required
                    </span>
                  ) : null}
                </label>
              );
            })}
          </div>
          <div className="mt-2 flex items-center justify-between gap-2">
            <button
              type="button"
              className="h-8 rounded-md border border-slate-300 bg-white px-2 text-[11px] font-semibold text-slate-700 hover:bg-slate-100"
              onClick={showAllColumns}
            >
              Show all
            </button>
            <button
              type="button"
              className="h-8 rounded-md border border-slate-300 bg-white px-2 text-[11px] font-semibold text-slate-700 hover:bg-slate-100"
              onClick={() => setIsOpen(false)}
            >
              Done
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
