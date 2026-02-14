"use client";

import { useMemo } from "react";

export type MultiSelectOption = { value: string; label: string };

export default function MultiSelect({
  options,
  selectedValues,
  placeholder,
  onChange,
  className,
  summaryClassName,
  menuClassName,
  showCount = true,
  headerLabel = "Select",
}: {
  options: readonly MultiSelectOption[];
  selectedValues: readonly string[];
  placeholder: string;
  onChange: (next: string[]) => void;
  className?: string;
  summaryClassName?: string;
  menuClassName?: string;
  showCount?: boolean;
  headerLabel?: string;
}) {
  const selectedSet = useMemo(() => new Set(selectedValues), [selectedValues]);

  const selectedLabels = useMemo(() => {
    if (!selectedValues.length) return [];
    const labelMap = new Map(options.map((option) => [option.value, option.label]));
    return selectedValues
      .map((value) => labelMap.get(value))
      .filter(Boolean) as string[];
  }, [options, selectedValues]);

  const summaryLabel = useMemo(() => {
    if (!selectedLabels.length) return placeholder;
    if (selectedLabels.length === 1) return selectedLabels[0];
    const first = selectedLabels[0] || placeholder;
    return `${first} +${selectedLabels.length - 1}`;
  }, [placeholder, selectedLabels]);

  const toggle = (value: string) => {
    const next = new Set(selectedSet);
    if (next.has(value)) {
      next.delete(value);
    } else {
      next.add(value);
    }
    onChange(Array.from(next));
  };

  return (
    <details className={["relative", className].filter(Boolean).join(" ")}>
      <summary
        className={[
          "flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700",
          summaryClassName,
        ]
          .filter(Boolean)
          .join(" ")}
      >
        <span className="truncate">{summaryLabel}</span>
        {showCount ? (
          <span className="text-xs text-slate-400">
            {selectedValues.length ? selectedValues.length : ""}
          </span>
        ) : null}
      </summary>
      <div
        className={[
          "absolute z-20 mt-2 w-full overflow-hidden rounded-md border border-slate-200 bg-white shadow-lg",
          menuClassName,
        ]
          .filter(Boolean)
          .join(" ")}
      >
        <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-3 py-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            {headerLabel}
          </p>
          <button
            type="button"
            className="text-xs font-semibold text-slate-600 hover:text-slate-900"
            onClick={() => onChange([])}
          >
            Clear
          </button>
        </div>
        <div className="max-h-64 overflow-auto p-2">
          {options.length ? (
            options.map((option) => (
            <label
              key={option.value}
              className="flex cursor-pointer items-start gap-2 rounded-md px-2 py-2 text-sm text-slate-700 hover:bg-slate-50"
            >
              <input
                type="checkbox"
                className="mt-0.5 h-5 w-5 rounded border-slate-300"
                checked={selectedSet.has(option.value)}
                onChange={() => toggle(option.value)}
              />
                <span className="leading-5">{option.label}</span>
              </label>
            ))
          ) : (
            <p className="px-2 py-1 text-sm text-slate-500">No options</p>
          )}
        </div>
      </div>
    </details>
  );
}
