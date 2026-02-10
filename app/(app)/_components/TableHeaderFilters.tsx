"use client";

import { useMemo, useState } from "react";

export type FilterOption = { value: string; label: string };

export function FilterIcon({ active }: { active: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={`inline-flex h-5 w-5 items-center justify-center rounded border text-[10px] leading-none ${
        active
          ? "border-slate-900 bg-slate-900 text-white"
          : "border-slate-200 bg-white text-slate-500 hover:bg-slate-100"
      }`}
      title={active ? "Filter applied" : "Filter"}
    >
      v
    </span>
  );
}

export function FilterMenuMulti({
  title,
  options,
  selectedValues,
  onChange,
  onClear,
}: {
  title: string;
  options: readonly FilterOption[];
  selectedValues: readonly string[];
  onChange: (next: string[]) => void;
  onClear: () => void;
}) {
  const [query, setQuery] = useState("");
  const selectedSet = useMemo(() => new Set(selectedValues), [selectedValues]);

  const filteredOptions = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((option) => option.label.toLowerCase().includes(q));
  }, [options, query]);

  const toggle = (value: string) => {
    const next = new Set(selectedSet);
    if (next.has(value)) {
      next.delete(value);
    } else {
      next.add(value);
    }
    onChange(Array.from(next));
  };

  const selectAll = () => {
    onChange(options.map((o) => o.value));
  };

  return (
    <div className="w-72 rounded-md border border-slate-200 bg-white shadow-lg">
      <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-3 py-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">
          {title}
        </p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="text-xs font-semibold text-slate-600 hover:text-slate-900"
            onClick={selectAll}
          >
            All
          </button>
          <button
            type="button"
            className="text-xs font-semibold text-slate-600 hover:text-slate-900"
            onClick={onClear}
          >
            Clear
          </button>
        </div>
      </div>
      <div className="border-b border-slate-100 px-3 py-2">
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search..."
          className="w-full rounded-md border border-slate-200 px-2 py-1.5 text-sm text-slate-700"
        />
      </div>
      <div className="max-h-72 overflow-auto p-2">
        {filteredOptions.length ? (
          filteredOptions.map((option) => (
            <label
              key={option.value}
              className="flex cursor-pointer items-start gap-2 rounded-md px-2 py-1 text-sm text-slate-700 hover:bg-slate-50"
            >
              <input
                type="checkbox"
                className="mt-1 h-4 w-4 rounded border-slate-300"
                checked={selectedSet.has(option.value)}
                onChange={() => toggle(option.value)}
              />
              <span className="leading-5">{option.label}</span>
            </label>
          ))
        ) : (
          <p className="px-2 py-2 text-sm text-slate-500">No matches</p>
        )}
      </div>
    </div>
  );
}

export function FilterMenuSingle({
  title,
  options,
  value,
  onChange,
  onClear,
}: {
  title: string;
  options: readonly FilterOption[];
  value: string;
  onChange: (next: string) => void;
  onClear: () => void;
}) {
  return (
    <div className="w-64 rounded-md border border-slate-200 bg-white shadow-lg">
      <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-3 py-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">
          {title}
        </p>
        <button
          type="button"
          className="text-xs font-semibold text-slate-600 hover:text-slate-900"
          onClick={onClear}
        >
          Clear
        </button>
      </div>
      <div className="p-2">
        {options.map((option) => (
          <label
            key={option.value}
            className="flex cursor-pointer items-start gap-2 rounded-md px-2 py-1 text-sm text-slate-700 hover:bg-slate-50"
          >
            <input
              type="radio"
              name={`filter-${title}`}
              className="mt-1 h-4 w-4 border-slate-300"
              checked={value === option.value}
              onChange={() => onChange(option.value)}
            />
            <span className="leading-5">{option.label}</span>
          </label>
        ))}
      </div>
    </div>
  );
}

export function FilterMenuText({
  title,
  value,
  placeholder,
  onApply,
  onClear,
}: {
  title: string;
  value: string;
  placeholder: string;
  onApply: (next: string) => void;
  onClear: () => void;
}) {
  const [draft, setDraft] = useState(value);

  return (
    <div className="w-72 rounded-md border border-slate-200 bg-white shadow-lg">
      <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-3 py-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">
          {title}
        </p>
        <button
          type="button"
          className="text-xs font-semibold text-slate-600 hover:text-slate-900"
          onClick={() => {
            setDraft("");
            onClear();
          }}
        >
          Clear
        </button>
      </div>
      <div className="p-3">
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder={placeholder}
          className="w-full rounded-md border border-slate-200 px-2 py-1.5 text-sm text-slate-700"
        />
        <div className="mt-3 flex items-center justify-end gap-2">
          <button
            type="button"
            className="rounded-md border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
            onClick={() => setDraft(value)}
          >
            Cancel
          </button>
          <button
            type="button"
            className="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800"
            onClick={() => onApply(draft)}
          >
            OK
          </button>
        </div>
      </div>
    </div>
  );
}

export function FilterMenuDateRange({
  title,
  from,
  to,
  onApply,
  onClear,
}: {
  title: string;
  from: string;
  to: string;
  onApply: (next: { from: string; to: string }) => void;
  onClear: () => void;
}) {
  const [draftFrom, setDraftFrom] = useState(from);
  const [draftTo, setDraftTo] = useState(to);

  return (
    <div className="w-80 rounded-md border border-slate-200 bg-white shadow-lg">
      <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-3 py-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">
          {title}
        </p>
        <button
          type="button"
          className="text-xs font-semibold text-slate-600 hover:text-slate-900"
          onClick={() => {
            setDraftFrom("");
            setDraftTo("");
            onClear();
          }}
        >
          Clear
        </button>
      </div>
      <div className="p-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="space-y-1 text-xs font-semibold text-slate-600">
            <span className="block">From</span>
            <input
              type="date"
              value={draftFrom}
              onChange={(event) => setDraftFrom(event.target.value)}
              className="w-full rounded-md border border-slate-200 px-2 py-1.5 text-sm text-slate-700"
            />
          </label>
          <label className="space-y-1 text-xs font-semibold text-slate-600">
            <span className="block">To</span>
            <input
              type="date"
              value={draftTo}
              onChange={(event) => setDraftTo(event.target.value)}
              className="w-full rounded-md border border-slate-200 px-2 py-1.5 text-sm text-slate-700"
            />
          </label>
        </div>
        <div className="mt-3 flex items-center justify-end gap-2">
          <button
            type="button"
            className="rounded-md border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
            onClick={() => {
              setDraftFrom(from);
              setDraftTo(to);
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            className="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800"
            onClick={() => onApply({ from: draftFrom, to: draftTo })}
          >
            OK
          </button>
        </div>
      </div>
    </div>
  );
}
