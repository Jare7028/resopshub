"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  persistEmployeeInfoVisibility,
  readEmployeeInfoVisibility,
} from "./inventoryVisibility";

type EmployeeInfoColumnRow = {
  id: string;
  label: string;
};

export default function CustomizeFieldsPopover({
  columns,
}: {
  columns: EmployeeInfoColumnRow[];
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [showClientColumn, setShowClientColumn] = useState(true);
  const [visibleColumnIds, setVisibleColumnIds] = useState<string[]>(() => columns.map((c) => c.id));
  const hasLoadedRef = useRef(false);
  const knownColumnIdsRef = useRef(new Set(columns.map((column) => column.id)));

  const knownColumnIds = useMemo(() => new Set(columns.map((column) => column.id)), [columns]);
  const visibleColumnIdSet = useMemo(() => new Set(visibleColumnIds), [visibleColumnIds]);

  useEffect(() => {
    if (hasLoadedRef.current) return;
    hasLoadedRef.current = true;

    const loaded = readEmployeeInfoVisibility(knownColumnIds, {
      showClientColumn: true,
      visibleColumnIds: columns.map((column) => column.id),
    });
    setShowClientColumn(loaded.showClientColumn);
    setVisibleColumnIds(loaded.visibleColumnIds);
  }, [columns, knownColumnIds]);

  useEffect(() => {
    setVisibleColumnIds((previous) => {
      const previousVisibleSet = new Set(previous);
      const previouslyKnownColumnIds = knownColumnIdsRef.current;
      const next = previous.filter((columnId) => knownColumnIds.has(columnId));
      columns.forEach((column) => {
        if (!previouslyKnownColumnIds.has(column.id) && !previousVisibleSet.has(column.id)) {
          next.push(column.id);
        }
      });
      knownColumnIdsRef.current = new Set(columns.map((column) => column.id));
      return next;
    });
  }, [columns, knownColumnIds]);

  useEffect(() => {
    if (!hasLoadedRef.current) return;
    persistEmployeeInfoVisibility({
      showClientColumn,
      visibleColumnIds,
      knownColumnIds: columns.map((column) => column.id),
    });
  }, [columns, showClientColumn, visibleColumnIds]);

  const toggleColumnVisibility = (columnId: string) => {
    setVisibleColumnIds((previous) => {
      if (previous.includes(columnId)) {
        return previous.filter((id) => id !== columnId);
      }
      return [...previous, columnId];
    });
  };

  const showAllFields = () => {
    setShowClientColumn(true);
    setVisibleColumnIds(columns.map((column) => column.id));
  };

  return (
    <details
      className="relative"
      data-inventory-popover="true"
      open={isOpen}
      onToggle={(event) => setIsOpen(event.currentTarget.open)}
    >
      <summary className="inline-flex h-9 cursor-pointer list-none items-center rounded-md border border-slate-300 bg-white px-3 text-xs font-semibold uppercase tracking-wide text-slate-600 hover:bg-slate-100 [&::-webkit-details-marker]:hidden">
        Customize fields
      </summary>
      <div className="absolute left-0 z-30 mt-2 w-72 rounded-md border border-slate-200 bg-white p-3 shadow-lg">
        <p className="mb-2 text-[11px] text-slate-500">Choose which columns are visible.</p>
        <label className="mb-1 flex items-center gap-2 rounded px-1 py-1 text-xs text-slate-700 hover:bg-slate-50">
          <input
            type="checkbox"
            checked={showClientColumn}
            onChange={(event) => setShowClientColumn(event.currentTarget.checked)}
          />
          <span>Client</span>
        </label>
        <div className="max-h-56 overflow-auto">
          {columns.map((column) => (
            <label
              key={column.id}
              className="mb-1 flex items-center gap-2 rounded px-1 py-1 text-xs text-slate-700 hover:bg-slate-50"
            >
              <input
                type="checkbox"
                checked={visibleColumnIdSet.has(column.id)}
                onChange={() => toggleColumnVisibility(column.id)}
              />
              <span>{column.label}</span>
            </label>
          ))}
        </div>
        <div className="mt-2 flex items-center justify-between gap-2">
          <button
            type="button"
            className="h-8 rounded-md border border-slate-300 bg-white px-2 text-[11px] font-semibold text-slate-700 hover:bg-slate-100"
            onClick={showAllFields}
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
    </details>
  );
}

