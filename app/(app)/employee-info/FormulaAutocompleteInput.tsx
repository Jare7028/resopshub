"use client";

import { useMemo, useRef, useState, type KeyboardEvent } from "react";

export type FormulaSuggestion = {
  token: string;
  label: string;
};

type SuggestionRange = {
  start: number;
  end: number;
  query: string;
};

function resolveSuggestionRange(value: string, caret: number): SuggestionRange | null {
  const safeCaret = Number.isFinite(caret) ? Math.max(0, Math.min(caret, value.length)) : value.length;
  let start = safeCaret;
  while (start > 0 && /[A-Za-z0-9_]/.test(value[start - 1])) {
    start -= 1;
  }

  let end = safeCaret;
  while (end < value.length && /[A-Za-z0-9_]/.test(value[end])) {
    end += 1;
  }

  const before = start > 0 ? value[start - 1] : "";
  const canSuggest = start === 0 || /[=+\-*/(,\s]/.test(before);
  if (!canSuggest) return null;

  return {
    start,
    end,
    query: value.slice(start, safeCaret),
  };
}

export default function FormulaAutocompleteInput({
  name,
  defaultValue,
  placeholder,
  className,
  required,
  suggestions,
}: {
  name: string;
  defaultValue?: string;
  placeholder: string;
  className: string;
  required?: boolean;
  suggestions: FormulaSuggestion[];
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const blurTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [value, setValue] = useState(defaultValue || "");
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [range, setRange] = useState<SuggestionRange | null>(null);

  const filteredSuggestions = useMemo(() => {
    if (!range) return [] as FormulaSuggestion[];
    const query = range.query.trim().toLowerCase();
    const ranked = suggestions
      .filter((suggestion) => {
        if (!query) return true;
        const token = suggestion.token.toLowerCase();
        const label = suggestion.label.toLowerCase();
        return token.startsWith(query) || label.includes(query);
      })
      .sort((a, b) => {
        const aStarts = a.token.toLowerCase().startsWith(query) ? 0 : 1;
        const bStarts = b.token.toLowerCase().startsWith(query) ? 0 : 1;
        if (aStarts !== bStarts) return aStarts - bStarts;
        return a.token.localeCompare(b.token);
      });
    return ranked.slice(0, 10);
  }, [range, suggestions]);

  const refreshSuggestions = (nextValue: string, caret: number) => {
    const nextRange = resolveSuggestionRange(nextValue, caret);
    setRange(nextRange);
    if (!nextRange) {
      setIsOpen(false);
      setActiveIndex(0);
      return;
    }

    setIsOpen(true);
    setActiveIndex(0);
  };

  const closeSuggestions = () => {
    setIsOpen(false);
    setActiveIndex(0);
  };

  const applySuggestion = (suggestion: FormulaSuggestion) => {
    if (!range) return;
    const nextValue = `${value.slice(0, range.start)}${suggestion.token}${value.slice(range.end)}`;
    const nextCaret = range.start + suggestion.token.length;
    setValue(nextValue);
    closeSuggestions();
    requestAnimationFrame(() => {
      if (!inputRef.current) return;
      inputRef.current.focus();
      inputRef.current.setSelectionRange(nextCaret, nextCaret);
    });
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (!isOpen || !filteredSuggestions.length) return;

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((prev) => (prev + 1) % filteredSuggestions.length);
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((prev) =>
        prev <= 0 ? filteredSuggestions.length - 1 : prev - 1
      );
      return;
    }

    if (event.key === "Enter" || event.key === "Tab") {
      event.preventDefault();
      applySuggestion(filteredSuggestions[activeIndex] || filteredSuggestions[0]);
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      closeSuggestions();
    }
  };

  return (
    <div className="relative">
      <input
        ref={inputRef}
        name={name}
        value={value}
        placeholder={placeholder}
        required={required}
        className={className}
        onChange={(event) => {
          const nextValue = event.currentTarget.value;
          const caret = event.currentTarget.selectionStart ?? nextValue.length;
          setValue(nextValue);
          refreshSuggestions(nextValue, caret);
        }}
        onClick={(event) => {
          refreshSuggestions(event.currentTarget.value, event.currentTarget.selectionStart ?? 0);
        }}
        onKeyUp={(event) => {
          const target = event.currentTarget;
          refreshSuggestions(target.value, target.selectionStart ?? target.value.length);
        }}
        onFocus={(event) => {
          if (blurTimeoutRef.current) {
            clearTimeout(blurTimeoutRef.current);
            blurTimeoutRef.current = null;
          }
          refreshSuggestions(event.currentTarget.value, event.currentTarget.selectionStart ?? event.currentTarget.value.length);
        }}
        onBlur={() => {
          blurTimeoutRef.current = setTimeout(() => {
            closeSuggestions();
          }, 120);
        }}
        onKeyDown={handleKeyDown}
      />

      {isOpen && filteredSuggestions.length ? (
        <div className="absolute left-0 right-0 z-30 mt-1 max-h-52 overflow-auto rounded-md border border-slate-200 bg-white py-1 shadow-lg">
          {filteredSuggestions.map((suggestion, index) => (
            <button
              key={`${suggestion.token}-${suggestion.label}`}
              type="button"
              className={`flex w-full items-center justify-between px-2 py-1.5 text-left text-xs ${
                index === activeIndex ? "bg-slate-100 text-slate-900" : "text-slate-700 hover:bg-slate-50"
              }`}
              onMouseDown={(event) => {
                event.preventDefault();
                applySuggestion(suggestion);
              }}
            >
              <span className="font-semibold">={suggestion.token}</span>
              <span className="pl-2 text-[10px] text-slate-500">{suggestion.label}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
