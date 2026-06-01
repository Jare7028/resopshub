"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";

type SubtaskRow = {
  id: string;
  title: string;
};

const initialRows: SubtaskRow[] = [{ id: "subtask-0", title: "" }];

type QuickSubtasksFieldProps = {
  className?: string;
  defaultOpen?: boolean;
};

export default function QuickSubtasksField({
  className = "md:col-span-6 rounded-xl border border-slate-200 bg-white p-4 md:p-5",
  defaultOpen = false,
}: QuickSubtasksFieldProps) {
  const [rows, setRows] = useState<SubtaskRow[]>(initialRows);
  const [pendingFocusId, setPendingFocusId] = useState<string | null>(null);
  const fieldIdPrefix = useId();
  const detailsRef = useRef<HTMLDetailsElement | null>(null);
  const nextRowIndex = useRef(1);
  const inputRefs = useRef(new Map<string, HTMLInputElement>());

  const filledCount = useMemo(
    () => rows.filter((row) => row.title.trim()).length,
    [rows]
  );

  useEffect(() => {
    if (!pendingFocusId) return;
    inputRefs.current.get(pendingFocusId)?.focus();
    setPendingFocusId(null);
  }, [pendingFocusId]);

  useEffect(() => {
    if (defaultOpen && detailsRef.current) {
      detailsRef.current.open = true;
    }
  }, [defaultOpen]);

  const addRow = () => {
    const nextId = `subtask-${nextRowIndex.current}`;
    nextRowIndex.current += 1;
    setRows((currentRows) => [...currentRows, { id: nextId, title: "" }]);
    setPendingFocusId(nextId);
  };

  const updateRow = (rowId: string, title: string) => {
    setRows((currentRows) =>
      currentRows.map((row) => (row.id === rowId ? { ...row, title } : row))
    );
  };

  const removeRow = (rowId: string) => {
    setRows((currentRows) => {
      const nextRows = currentRows.filter((row) => row.id !== rowId);
      return nextRows.length ? nextRows : initialRows;
    });
  };

  return (
    <details ref={detailsRef} className={className}>
      <summary className="flex cursor-pointer select-none items-center gap-2 text-sm font-semibold text-slate-800">
        <span>Subtasks</span>
        {filledCount ? (
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600">
            {filledCount}
          </span>
        ) : null}
      </summary>

      <div className="mt-4 space-y-3">
        {rows.map((row, index) => (
          <div key={row.id} className="flex gap-2">
            <label htmlFor={`${fieldIdPrefix}-${row.id}`} className="sr-only">
              Subtask {index + 1}
            </label>
            <input
              ref={(node) => {
                if (node) {
                  inputRefs.current.set(row.id, node);
                } else {
                  inputRefs.current.delete(row.id);
                }
              }}
              id={`${fieldIdPrefix}-${row.id}`}
              name="subtask_titles"
              value={row.title}
              onChange={(event) => updateRow(row.id, event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== "Enter") return;
                event.preventDefault();
                if (row.title.trim()) {
                  addRow();
                }
              }}
              placeholder="Subtask title"
              className="h-11 min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-3 text-sm leading-5 text-slate-700 outline-none transition focus:border-slate-300 focus:ring-2 focus:ring-slate-200"
            />
            {rows.length > 1 ? (
              <button
                type="button"
                onClick={() => removeRow(row.id)}
                className="rounded-lg border border-slate-200 px-3 text-sm font-medium text-slate-600 transition hover:bg-slate-50"
              >
                Remove
              </button>
            ) : null}
          </div>
        ))}

        <button
          type="button"
          onClick={addRow}
          className="inline-flex h-10 items-center rounded-lg border border-slate-200 px-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
        >
          Add subtask
        </button>
      </div>
    </details>
  );
}
