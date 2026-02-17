"use client";

import { useState } from "react";

type FormulaSuggestion = {
  token: string;
  label: string;
};

type EmployeeInfoColumnKind = "text" | "number" | "dropdown" | "formula";

export default function AddColumnPopover({
  formulaSuggestionListId,
  formulaSuggestions,
  onCreateColumn,
}: {
  formulaSuggestionListId: string;
  formulaSuggestions: FormulaSuggestion[];
  onCreateColumn: (formData: FormData) => Promise<void> | void;
}) {
  const [columnKind, setColumnKind] = useState<EmployeeInfoColumnKind>("text");

  return (
    <details className="relative">
      <summary
        className="inline-flex h-9 w-9 cursor-pointer list-none items-center justify-center rounded-md border border-slate-300 bg-white text-lg font-semibold leading-none text-slate-700 hover:bg-slate-100 [&::-webkit-details-marker]:hidden"
        aria-label="Add column"
        title="Add column"
      >
        +
      </summary>
      <div className="absolute right-0 z-10 mt-2 w-[min(92vw,36rem)] rounded-lg border border-slate-200 bg-white p-4 shadow-lg">
        <p className="text-xs text-slate-500">
          Formula columns support letters (A=Full Name, B=Client, C onward custom columns) and
          column keys (for example <code>=salary + bonus</code>).
        </p>
        <form action={onCreateColumn} className="mt-3 grid gap-3">
          <input
            name="label"
            placeholder="Column label"
            className="h-11 rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-700"
            required
          />
          <select
            name="column_kind"
            value={columnKind}
            onChange={(event) =>
              setColumnKind(event.currentTarget.value as EmployeeInfoColumnKind)
            }
            className="h-11 rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-700"
          >
            <option value="text">Text</option>
            <option value="number">Number</option>
            <option value="dropdown">Dropdown</option>
            <option value="formula">Formula</option>
          </select>
          {columnKind === "dropdown" ? (
            <input
              name="dropdown_options"
              placeholder="Dropdown options (comma separated)"
              className="h-11 rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-700"
              required
            />
          ) : null}
          {columnKind === "formula" ? (
            <input
              name="formula"
              placeholder="Formula (e.g. =(C * D))"
              list={formulaSuggestionListId}
              className="h-11 rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-700"
              required
            />
          ) : null}
          <button
            type="submit"
            className="h-11 rounded-md border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-100"
          >
            Add column
          </button>
        </form>
        <datalist id={formulaSuggestionListId}>
          {formulaSuggestions.map((suggestion) => (
            <option key={suggestion.token} value={`=${suggestion.token}`} label={suggestion.label} />
          ))}
        </datalist>
      </div>
    </details>
  );
}
