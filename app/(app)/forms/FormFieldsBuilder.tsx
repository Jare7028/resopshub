"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { buildFieldKey, normalizeFormFieldType, type FormField } from "./types";

type BuilderFieldType = "text" | "number" | "date" | "select";

const builderFieldTypes: Array<{ value: BuilderFieldType; label: string }> = [
  { value: "text", label: "Text" },
  { value: "number", label: "Number" },
  { value: "date", label: "Date" },
  { value: "select", label: "Dropdown" },
];

function createField(seed: number, type: BuilderFieldType = "text"): FormField {
  return {
    id: `field_${seed}`,
    key: `field_${seed}`,
    label: "",
    type,
    required: false,
    options: [],
    condition: null,
  };
}

function TypeIcon({ type }: { type: BuilderFieldType }) {
  const cls = "h-4 w-4 text-slate-500";
  if (type === "number") {
    return (
      <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" className={cls}>
        <path d="M7 4 5 16M14 4l-2 12M4 8h12M3 12h12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    );
  }
  if (type === "date") {
    return (
      <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" className={cls}>
        <rect x="3.5" y="5.5" width="13" height="11" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
        <path d="M6.5 3.5v3M13.5 3.5v3M3.5 8h13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    );
  }
  if (type === "select") {
    return (
      <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" className={cls}>
        <path d="M7 6h8M7 10h8M7 14h8M4 6h.01M4 10h.01M4 14h.01" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    );
  }
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" className={cls}>
      <path d="M4 6h12M4 10h12M4 14h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

export default function FormFieldsBuilder({
  name = "fields_json",
  initialFields,
}: {
  name?: string;
  initialFields: FormField[];
}) {
  const normalizedInitialFields = useMemo(() => {
    if (!initialFields.length) return [createField(1)];
    return initialFields.map((field, index) => ({
      ...field,
      id: field.id || `field_${index + 1}`,
      key: field.key || `field_${index + 1}`,
      label: field.label || "",
      type: normalizeFormFieldType(field.type),
      required: Boolean(field.required),
      options: Array.isArray(field.options) ? field.options.filter(Boolean) : [],
      condition:
        field.condition && field.condition.fieldKey
          ? {
              fieldKey: field.condition.fieldKey,
              equals: field.condition.equals || "",
            }
          : null,
    }));
  }, [initialFields]);

  const [fields, setFields] = useState<FormField[]>(normalizedInitialFields);
  const [isAddFieldModalOpen, setIsAddFieldModalOpen] = useState(false);
  const [openAdvancedByFieldId, setOpenAdvancedByFieldId] = useState<Record<string, boolean>>({});
  const modalRef = useRef<HTMLDivElement | null>(null);

  const serialized = useMemo(() => JSON.stringify(fields), [fields]);

  const addField = (type: BuilderFieldType) => {
    setFields((current) => [...current, createField(current.length + 1, type)]);
    setIsAddFieldModalOpen(false);
  };

  const updateField = (index: number, updater: (field: FormField) => FormField) => {
    setFields((current) =>
      current.map((item, itemIndex) => (itemIndex === index ? updater(item) : item))
    );
  };

  useEffect(() => {
    if (!isAddFieldModalOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsAddFieldModalOpen(false);
    };
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (modalRef.current && !modalRef.current.contains(target)) {
        setIsAddFieldModalOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("mousedown", onPointerDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("mousedown", onPointerDown);
    };
  }, [isAddFieldModalOpen]);

  return (
    <div className="space-y-4">
      <input type="hidden" name={name} value={serialized} />

      <div className="flex items-center justify-between gap-3">
        <h3 className="text-base font-semibold text-slate-900">Form fields</h3>
        <button
          type="button"
          onClick={() => setIsAddFieldModalOpen(true)}
          className="inline-flex items-center gap-2 rounded-full bg-sky-500 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-600"
        >
          Add field
          <svg
            aria-hidden="true"
            viewBox="0 0 20 20"
            fill="currentColor"
            className={`h-3 w-3 transition-transform ${isAddFieldModalOpen ? "rotate-180" : ""}`}
          >
            <path d="M5.23 7.21a.75.75 0 0 1 1.06.02L10 10.94l3.71-3.71a.75.75 0 1 1 1.06 1.06l-4.24 4.24a.75.75 0 0 1-1.06 0L5.21 8.29a.75.75 0 0 1 .02-1.08Z" />
          </svg>
        </button>
      </div>

      {isAddFieldModalOpen ? (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-slate-900/30 px-4 pt-20">
          <div
            ref={modalRef}
            className="w-full max-w-2xl rounded-2xl border border-slate-200 bg-white p-4 shadow-2xl"
          >
            <p className="mb-3 text-sm font-medium text-slate-500">Add field type</p>
            <div className="grid gap-2 sm:grid-cols-2">
              {builderFieldTypes.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => addField(option.value)}
                  className="flex items-center gap-2 rounded-md border border-slate-200 px-3 py-2 text-left text-sm font-medium text-slate-700 hover:border-slate-300 hover:bg-slate-50"
                >
                  <TypeIcon type={option.value} />
                  {option.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : null}

      <div className="space-y-3">
        {fields.map((field, index) => (
          <div key={field.id} className="rounded-lg border border-slate-200 p-4">
            <div className="grid gap-3 md:grid-cols-12">
              <label className="md:col-span-5 text-xs font-semibold uppercase tracking-wide text-slate-600">
                Label
                <input
                  value={field.label}
                  onChange={(event) =>
                    updateField(index, (item) => ({
                      ...item,
                      label: event.target.value,
                      key:
                        item.key.startsWith("field_") || !item.key
                          ? buildFieldKey(event.target.value, `field_${index + 1}`)
                          : item.key,
                    }))
                  }
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
                  placeholder="Field label"
                />
              </label>

              <label className="md:col-span-3 text-xs font-semibold uppercase tracking-wide text-slate-600">
                Type
                <select
                  value={field.type}
                  onChange={(event) =>
                    updateField(index, (item) => ({
                      ...item,
                      type: normalizeFormFieldType(event.target.value),
                    }))
                  }
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
                >
                  {builderFieldTypes.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                  {!builderFieldTypes.some((option) => option.value === field.type) ? (
                    <option value={field.type}>{field.type}</option>
                  ) : null}
                </select>
              </label>

              <div className="md:col-span-4 flex items-end justify-end gap-2">
                <label className="inline-flex items-center gap-2 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    checked={field.required}
                    onChange={(event) =>
                      updateField(index, (item) => ({ ...item, required: event.target.checked }))
                    }
                  />
                  Required
                </label>
                <button
                  type="button"
                  onClick={() =>
                    setOpenAdvancedByFieldId((current) => ({
                      ...current,
                      [field.id]: !current[field.id],
                    }))
                  }
                  className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:border-slate-400"
                >
                  {openAdvancedByFieldId[field.id] ? "Hide advanced" : "Advanced"}
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setFields((current) =>
                      current.length > 1
                        ? current.filter((_, itemIndex) => itemIndex !== index)
                        : current
                    )
                  }
                  className="rounded-md border border-red-200 px-3 py-1.5 text-xs font-semibold text-red-700 hover:border-red-300 hover:text-red-800 disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={fields.length === 1}
                >
                  Remove
                </button>
              </div>

              {field.type === "select" ? (
                <label className="md:col-span-12 text-xs font-semibold uppercase tracking-wide text-slate-600">
                  Dropdown options (comma separated)
                  <input
                    value={(field.options || []).join(", ")}
                    onChange={(event) =>
                      updateField(index, (item) => ({
                        ...item,
                        options: event.target.value
                          .split(",")
                          .map((value) => value.trim())
                          .filter(Boolean),
                      }))
                    }
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
                    placeholder="Option A, Option B"
                  />
                </label>
              ) : null}

              {openAdvancedByFieldId[field.id] ? (
                <>
                  <label className="md:col-span-4 text-xs font-semibold uppercase tracking-wide text-slate-600">
                    Key
                    <input
                      value={field.key}
                      onChange={(event) =>
                        updateField(index, (item) => ({
                          ...item,
                          key: event.target.value
                            .toLowerCase()
                            .replace(/[^a-z0-9_]/g, "_")
                            .replace(/^_+|_+$/g, ""),
                        }))
                      }
                      className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
                      placeholder="field_key"
                    />
                  </label>
                  <label className="md:col-span-4 text-xs font-semibold uppercase tracking-wide text-slate-600">
                    Show only when field equals
                    <input
                      value={field.condition?.fieldKey || ""}
                      onChange={(event) =>
                        updateField(index, (item) => ({
                          ...item,
                          condition: event.target.value
                            ? {
                                fieldKey: event.target.value,
                                equals: item.condition?.equals || "",
                              }
                            : null,
                        }))
                      }
                      className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
                      placeholder="other_field_key"
                    />
                  </label>
                  <label className="md:col-span-4 text-xs font-semibold uppercase tracking-wide text-slate-600">
                    Expected value
                    <input
                      value={field.condition?.equals || ""}
                      onChange={(event) =>
                        updateField(index, (item) => ({
                          ...item,
                          condition: item.condition
                            ? {
                                fieldKey: item.condition.fieldKey,
                                equals: event.target.value,
                              }
                            : null,
                        }))
                      }
                      className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
                      placeholder="expected value"
                      disabled={!field.condition}
                    />
                  </label>
                </>
              ) : null}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

