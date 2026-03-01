"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { normalizeStatusColorHex, type StatusEntityType } from "@/lib/statusOptions";

type StatusUpdateResult = { ok: boolean; error?: string } | void;

type StatusOptionAutoRowProps = {
  entityType: StatusEntityType;
  id: string;
  value: string;
  position: number;
  maxPosition: number;
  isVisible: boolean;
  countsAsCompleted: boolean;
  colorHex: string | null;
  isCore: boolean;
  onUpdate: (formData: FormData) => Promise<StatusUpdateResult>;
  onDelete: (formData: FormData) => Promise<void>;
};

function formatValueLabel(value: string) {
  return value.replace(/_/g, " ");
}

export default function StatusOptionAutoRow({
  entityType,
  id,
  value,
  position,
  maxPosition,
  isVisible,
  countsAsCompleted,
  colorHex,
  isCore,
  onUpdate,
  onDelete,
}: StatusOptionAutoRowProps) {
  const normalizedInitialColor = normalizeStatusColorHex(colorHex) || "#64748b";
  const [colorValue, setColorValue] = useState(normalizedInitialColor);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const saveStateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const submitDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const formRef = useRef<HTMLFormElement | null>(null);
  const [, startTransition] = useTransition();

  useEffect(() => {
    return () => {
      if (saveStateTimerRef.current) {
        clearTimeout(saveStateTimerRef.current);
      }
      if (submitDebounceRef.current) {
        clearTimeout(submitDebounceRef.current);
      }
    };
  }, []);

  const setSavedState = (state: "saved" | "error") => {
    setSaveState(state);
    if (saveStateTimerRef.current) {
      clearTimeout(saveStateTimerRef.current);
    }
    saveStateTimerRef.current = setTimeout(() => {
      setSaveState("idle");
      saveStateTimerRef.current = null;
    }, 1800);
  };

  const submitUpdate = (providedColor?: string) => {
    const form = formRef.current;
    if (!form) return;
    if (submitDebounceRef.current) {
      clearTimeout(submitDebounceRef.current);
      submitDebounceRef.current = null;
    }

    const normalizedColor = normalizeStatusColorHex(providedColor ?? colorValue);
    if (!normalizedColor) {
      setSavedState("error");
      return;
    }

    setColorValue(normalizedColor);
    const formData = new FormData(form);
    formData.set("color_hex", normalizedColor);
    setSaveState("saving");

    startTransition(() => {
      void Promise.resolve(onUpdate(formData))
        .then((result) => {
          if (result && typeof result === "object" && "ok" in result && result.ok === false) {
            setSavedState("error");
            return;
          }
          setSavedState("saved");
        })
        .catch(() => {
          setSavedState("error");
        });
    });
  };

  const scheduleSubmit = (nextColor: string) => {
    if (submitDebounceRef.current) {
      clearTimeout(submitDebounceRef.current);
    }
    const normalizedCandidate = normalizeStatusColorHex(nextColor);
    if (!normalizedCandidate) {
      return;
    }
    submitDebounceRef.current = setTimeout(() => {
      submitUpdate(nextColor);
      submitDebounceRef.current = null;
    }, 260);
  };

  const positionOptions = Array.from(
    { length: Math.max(1, maxPosition) },
    (_, index) => index + 1
  );

  return (
    <div className="rounded-md border border-slate-200 bg-white px-2 py-1.5">
      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_88px_88px_88px_144px_auto] sm:items-center">
        <form ref={formRef} className="contents">
          <input type="hidden" name="entity_type" value={entityType} />
          <input type="hidden" name="id" value={id} />
          <input type="hidden" name="value" value={value} />
          <input type="hidden" name="autosave" value="1" />

          <span className="inline-flex min-w-0 items-center gap-2 text-sm font-semibold text-slate-800">
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: normalizeStatusColorHex(colorValue) || "#64748b" }}
            />
            <span className="truncate">{formatValueLabel(value)}</span>
            {isCore ? (
              <span className="shrink-0 text-[11px] font-semibold text-slate-500">(core)</span>
            ) : null}
          </span>

          <label className="inline-flex items-center gap-2 text-xs text-slate-700 sm:justify-center">
            <span className="sm:hidden">Order</span>
            <select
              key={`${id}-position-${position}`}
              name="position"
              defaultValue={String(position)}
              onChange={() => submitUpdate()}
              className="h-7 rounded-md border border-slate-300 bg-white px-2 text-xs"
            >
              {positionOptions.map((optionPosition) => (
                <option key={`${id}-position-${optionPosition}`} value={optionPosition}>
                  {optionPosition}
                </option>
              ))}
            </select>
          </label>

          <label className="inline-flex items-center gap-1.5 text-xs text-slate-700 sm:justify-center">
            <input
              type="checkbox"
              name="is_visible"
              defaultChecked={isVisible}
              onChange={() => submitUpdate()}
              className="h-4 w-4 rounded border-slate-300"
            />
            Open
          </label>

          <label className="inline-flex items-center gap-1.5 text-xs text-slate-700 sm:justify-center">
            <input
              type="checkbox"
              name="counts_as_completed"
              defaultChecked={countsAsCompleted}
              onChange={() => submitUpdate()}
              className="h-4 w-4 rounded border-slate-300"
            />
            Closed
          </label>

          <div className="inline-flex items-center gap-2 sm:justify-end">
            <input
              type="color"
              value={normalizeStatusColorHex(colorValue) || "#64748b"}
              onChange={(event) => {
                const nextColor = event.currentTarget.value;
                setColorValue(nextColor);
                submitUpdate(nextColor);
              }}
              className="h-7 w-7 rounded border border-slate-300 bg-white p-0.5"
              aria-label={`${value} color picker`}
            />
            <input
              name="color_hex"
              value={colorValue}
              onChange={(event) => {
                const nextColor = event.currentTarget.value;
                setColorValue(nextColor);
                scheduleSubmit(nextColor);
              }}
              onBlur={(event) => submitUpdate(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  submitUpdate(event.currentTarget.value);
                }
              }}
              className="h-7 w-24 rounded-md border border-slate-300 px-2 py-1 text-xs font-mono uppercase"
              aria-label={`${value} color hex`}
            />
          </div>
        </form>

        <div className="ml-auto inline-flex items-center justify-end gap-2">
          <span className="text-[11px] font-medium text-slate-500">
            {saveState === "saving"
              ? "Saving..."
              : saveState === "saved"
              ? "Saved"
              : saveState === "error"
              ? "Save failed"
              : ""}
          </span>

          {!isCore ? (
            <form action={onDelete}>
              <input type="hidden" name="entity_type" value={entityType} />
              <input type="hidden" name="value" value={value} />
              <input type="hidden" name="id" value={id} />
              <button
                type="submit"
                className="rounded-md border border-red-200 bg-red-50 px-2 py-1 text-xs font-semibold text-red-700 hover:bg-red-100"
              >
                Delete
              </button>
            </form>
          ) : null}
        </div>
      </div>
    </div>
  );
}
