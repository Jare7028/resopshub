"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import FormulaAutocompleteInput, { type FormulaSuggestion } from "./FormulaAutocompleteInput";

export default function FormulaEditorDialog({
  open,
  title,
  value,
  onValueChange,
  onClose,
  suggestions,
}: {
  open: boolean;
  title: string;
  value: string;
  onValueChange: (nextValue: string) => void;
  onClose: () => void;
  suggestions: FormulaSuggestion[];
}) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open) return;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [open, onClose]);

  if (!open || !mounted) return null;

  const content = (
    <div
      className="fixed inset-0 z-[1000] flex items-center justify-center bg-slate-900/35 p-4"
      onMouseDown={onClose}
    >
      <div
        className="w-[min(96vw,60rem)] rounded-xl border border-slate-200 bg-white p-4 shadow-2xl"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between gap-3">
          <h3 className="text-sm font-semibold text-slate-800">{title}</h3>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-8 items-center rounded-md border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-100"
          >
            Done
          </button>
        </div>
        <FormulaAutocompleteInput
          value={value}
          onValueChange={onValueChange}
          placeholder='Formula (e.g. =IF(OR(client="Resolvable",client="Dusk"),500,0))'
          className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700"
          suggestions={suggestions}
          multiline
          rows={14}
          autoFocus
        />
        <p className="mt-2 text-xs text-slate-500">
          Tip: Use <code>Tab</code> or <code>Enter</code> to accept autocomplete suggestions.
        </p>
      </div>
    </div>
  );

  return createPortal(content, document.body);
}
