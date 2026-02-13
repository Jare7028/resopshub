"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  buildFieldKey,
  formFieldTypeOptions,
  formatFormLabel,
  normalizeFormFieldType,
  type FormField,
} from "./types";

function createField(seed: number, type: FormField["type"] = "text"): FormField {
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

const pickerOptions: Array<{ label: string; type: FormField["type"]; icon: string }> = [
  { label: "Description", type: "textarea", icon: "doc" },
  { label: "Formula", type: "text", icon: "fx" },
  { label: "Group", type: "text", icon: "layers" },
  { label: "Dropdown", type: "select", icon: "list" },
  { label: "Number", type: "number", icon: "hash" },
  { label: "Open ended", type: "text", icon: "align" },
  { label: "Yes/No", type: "checkbox", icon: "check" },
  { label: "Image selection", type: "select", icon: "image" },
  { label: "Location", type: "text", icon: "pin" },
  { label: "Audio recording", type: "text", icon: "mic" },
  { label: "Task", type: "text", icon: "task" },
  { label: "Date", type: "date", icon: "calendar" },
  { label: "Rating", type: "number", icon: "star" },
  { label: "Signature", type: "text", icon: "pen" },
  { label: "Image upload", type: "text", icon: "image_upload" },
  { label: "Video upload", type: "text", icon: "video" },
  { label: "File upload", type: "text", icon: "clip" },
  { label: "Numbers slider", type: "number", icon: "slider" },
  { label: "Phone", type: "text", icon: "phone" },
  { label: "Email", type: "text", icon: "at" },
];

function FieldIcon({ kind }: { kind: string }) {
  const cls = "h-4 w-4 text-slate-500";
  if (kind === "doc") {
    return (
      <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" className={cls}>
        <path d="M5 3h7l3 3v11H5V3Z" stroke="currentColor" strokeWidth="1.5" />
        <path d="M8 9h4M8 12h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    );
  }
  if (kind === "fx") {
    return (
      <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" className={cls}>
        <path d="M6 5h7M6 15h7M9 5l-4 10M15 5l-4 10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    );
  }
  if (kind === "layers") {
    return (
      <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" className={cls}>
        <path d="m10 4 6 3-6 3-6-3 6-3Zm-6 6 6 3 6-3M4 13l6 3 6-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (kind === "list") {
    return (
      <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" className={cls}>
        <path d="M7 6h8M7 10h8M7 14h8M4 6h.01M4 10h.01M4 14h.01" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    );
  }
  if (kind === "hash") {
    return (
      <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" className={cls}>
        <path d="M7 4 5 16M14 4l-2 12M4 8h12M3 12h12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    );
  }
  if (kind === "align") {
    return (
      <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" className={cls}>
        <path d="M4 6h12M4 10h12M4 14h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    );
  }
  if (kind === "check") {
    return (
      <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" className={cls}>
        <path d="m5 10 3 3 7-7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (kind === "image") {
    return (
      <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" className={cls}>
        <rect x="3.5" y="4.5" width="13" height="11" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
        <path d="m6 13 2.5-2.5L11 13l2-2 1 2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (kind === "pin") {
    return (
      <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" className={cls}>
        <path d="M10 17s5-5.1 5-8.5A5 5 0 1 0 5 8.5C5 11.9 10 17 10 17Z" stroke="currentColor" strokeWidth="1.5" />
        <circle cx="10" cy="8.5" r="1.8" stroke="currentColor" strokeWidth="1.5" />
      </svg>
    );
  }
  if (kind === "mic") {
    return (
      <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" className={cls}>
        <rect x="8" y="3.5" width="4" height="8" rx="2" stroke="currentColor" strokeWidth="1.5" />
        <path d="M6 9.5a4 4 0 0 0 8 0M10 13.5V16M7.5 16h5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    );
  }
  if (kind === "task") {
    return (
      <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" className={cls}>
        <circle cx="10" cy="10" r="6.5" stroke="currentColor" strokeWidth="1.5" />
        <path d="m7.5 10 1.7 1.7 3.3-3.3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (kind === "calendar") {
    return (
      <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" className={cls}>
        <rect x="3.5" y="5.5" width="13" height="11" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
        <path d="M6.5 3.5v3M13.5 3.5v3M3.5 8h13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    );
  }
  if (kind === "star") {
    return (
      <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" className={cls}>
        <path d="m10 3 2 4 4.5.7-3.2 3.1.8 4.5-4.1-2.2-4.1 2.2.8-4.5L3.5 7.7 8 7l2-4Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      </svg>
    );
  }
  if (kind === "pen") {
    return (
      <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" className={cls}>
        <path d="m4 14 8.8-8.8 2 2L6 16H4v-2Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      </svg>
    );
  }
  if (kind === "image_upload") {
    return (
      <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" className={cls}>
        <rect x="3.5" y="4.5" width="13" height="11" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
        <path d="M10 7v5M8 9l2-2 2 2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (kind === "video") {
    return (
      <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" className={cls}>
        <rect x="3.5" y="5.5" width="10" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
        <path d="m13.5 8 3-1v6l-3-1V8Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      </svg>
    );
  }
  if (kind === "clip") {
    return (
      <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" className={cls}>
        <path d="M7 10.5 11.5 6a2.5 2.5 0 1 1 3.5 3.5L9.5 15a4 4 0 0 1-5.7-5.7L9 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    );
  }
  if (kind === "slider") {
    return (
      <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" className={cls}>
        <path d="M4 6h12M4 10h12M4 14h12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        <circle cx="8" cy="6" r="1.5" fill="currentColor" />
        <circle cx="12" cy="10" r="1.5" fill="currentColor" />
        <circle cx="6" cy="14" r="1.5" fill="currentColor" />
      </svg>
    );
  }
  if (kind === "phone") {
    return (
      <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" className={cls}>
        <path d="M6 4h2l1 3-1.5 1.5a10 10 0 0 0 4 4L13 11l3 1v2a2 2 0 0 1-2 2C8.5 16 4 11.5 4 6a2 2 0 0 1 2-2Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      </svg>
    );
  }
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" className={cls}>
      <path d="M4 10h12M10 4v12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
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
  const modalRef = useRef<HTMLDivElement | null>(null);

  const serialized = useMemo(() => JSON.stringify(fields), [fields]);

  const addField = (type: FormField["type"]) => {
    setFields((current) => [...current, createField(current.length + 1, type)]);
    setIsAddFieldModalOpen(false);
  };

  useEffect(() => {
    if (!isAddFieldModalOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsAddFieldModalOpen(false);
      }
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
            className={`h-3 w-3 transition-transform ${
              isAddFieldModalOpen ? "rotate-180" : ""
            }`}
          >
            <path d="M5.23 7.21a.75.75 0 0 1 1.06.02L10 10.94l3.71-3.71a.75.75 0 1 1 1.06 1.06l-4.24 4.24a.75.75 0 0 1-1.06 0L5.21 8.29a.75.75 0 0 1 .02-1.08Z" />
          </svg>
        </button>
      </div>
      {isAddFieldModalOpen ? (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-slate-900/30 px-4 pt-20">
          <div
            ref={modalRef}
            className="w-full max-w-5xl rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-2xl"
          >
            <div className="grid gap-0 md:grid-cols-4">
              <div className="border-slate-200 md:border-r">
                <p className="px-2 pb-2 text-sm font-medium text-slate-400">Elements</p>
                <div className="space-y-1">
                  {pickerOptions.slice(0, 3).map((option) => (
                    <button
                      key={option.label}
                      type="button"
                      onClick={() => addField(option.type)}
                      className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-[22px] font-medium text-slate-700 hover:bg-slate-50"
                    >
                      <FieldIcon kind={option.icon} />
                      <span className="text-[24px] leading-none">{option.label}</span>
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <p className="px-2 pb-2 text-sm font-medium text-slate-400">Elements</p>
                <div className="space-y-1">
                  {pickerOptions.slice(3, 8).map((option) => (
                    <button
                      key={option.label}
                      type="button"
                      onClick={() => addField(option.type)}
                      className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-[22px] font-medium text-slate-700 hover:bg-slate-50"
                    >
                      <FieldIcon kind={option.icon} />
                      <span className="text-[24px] leading-none">{option.label}</span>
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <p className="px-2 pb-2 text-sm font-medium text-transparent">Elements</p>
                <div className="space-y-1">
                  {pickerOptions.slice(8, 14).map((option) => (
                    <button
                      key={option.label}
                      type="button"
                      onClick={() => addField(option.type)}
                      className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-[22px] font-medium text-slate-700 hover:bg-slate-50"
                    >
                      <FieldIcon kind={option.icon} />
                      <span className="text-[24px] leading-none">{option.label}</span>
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <p className="px-2 pb-2 text-sm font-medium text-transparent">Elements</p>
                <div className="space-y-1">
                  {pickerOptions.slice(14).map((option) => (
                    <button
                      key={option.label}
                      type="button"
                      onClick={() => addField(option.type)}
                      className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-[22px] font-medium text-slate-700 hover:bg-slate-50"
                    >
                      <FieldIcon kind={option.icon} />
                      <span className="text-[24px] leading-none">{option.label}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}
      <div className="space-y-3">
        {fields.map((field, index) => (
          <div key={field.id} className="rounded-md border border-slate-200 p-4">
            <div className="grid gap-3 md:grid-cols-6">
              <label className="md:col-span-2 text-xs font-semibold uppercase tracking-wide text-slate-600">
                Label
                <input
                  value={field.label}
                  onChange={(event) =>
                    setFields((current) =>
                      current.map((item, itemIndex) =>
                        itemIndex === index
                          ? {
                              ...item,
                              label: event.target.value,
                              key:
                                item.key.startsWith("field_") || !item.key
                                  ? buildFieldKey(event.target.value, `field_${index + 1}`)
                                  : item.key,
                            }
                          : item
                      )
                    )
                  }
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
                  placeholder="Field label"
                />
              </label>
              <label className="md:col-span-2 text-xs font-semibold uppercase tracking-wide text-slate-600">
                Key
                <input
                  value={field.key}
                  onChange={(event) =>
                    setFields((current) =>
                      current.map((item, itemIndex) =>
                        itemIndex === index
                          ? {
                              ...item,
                              key: event.target.value
                                .toLowerCase()
                                .replace(/[^a-z0-9_]/g, "_")
                                .replace(/^_+|_+$/g, ""),
                            }
                          : item
                      )
                    )
                  }
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
                  placeholder="field_key"
                />
              </label>
              <label className="md:col-span-2 text-xs font-semibold uppercase tracking-wide text-slate-600">
                Type
                <select
                  value={field.type}
                  onChange={(event) =>
                    setFields((current) =>
                      current.map((item, itemIndex) =>
                        itemIndex === index
                          ? {
                              ...item,
                              type: normalizeFormFieldType(event.target.value),
                            }
                          : item
                      )
                    )
                  }
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
                >
                  {formFieldTypeOptions.map((type) => (
                    <option key={type} value={type}>
                      {formatFormLabel(type)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="md:col-span-3 text-xs font-semibold uppercase tracking-wide text-slate-600">
                Show only when field equals (optional)
                <div className="mt-1 grid gap-2 md:grid-cols-2">
                  <input
                    value={field.condition?.fieldKey || ""}
                    onChange={(event) =>
                      setFields((current) =>
                        current.map((item, itemIndex) =>
                          itemIndex === index
                            ? {
                                ...item,
                                condition: event.target.value
                                  ? {
                                      fieldKey: event.target.value,
                                      equals: item.condition?.equals || "",
                                    }
                                  : null,
                              }
                            : item
                        )
                      )
                    }
                    className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
                    placeholder="other_field_key"
                  />
                  <input
                    value={field.condition?.equals || ""}
                    onChange={(event) =>
                      setFields((current) =>
                        current.map((item, itemIndex) =>
                          itemIndex === index
                            ? {
                                ...item,
                                condition: item.condition
                                  ? {
                                      fieldKey: item.condition.fieldKey,
                                      equals: event.target.value,
                                    }
                                  : null,
                              }
                            : item
                        )
                      )
                    }
                    className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
                    placeholder="expected value"
                    disabled={!field.condition}
                  />
                </div>
              </label>
              <label className="md:col-span-2 text-xs font-semibold uppercase tracking-wide text-slate-600">
                Select options (comma separated)
                <input
                  value={(field.options || []).join(", ")}
                  onChange={(event) =>
                    setFields((current) =>
                      current.map((item, itemIndex) =>
                        itemIndex === index
                          ? {
                              ...item,
                              options: event.target.value
                                .split(",")
                                .map((value) => value.trim())
                                .filter(Boolean),
                            }
                          : item
                      )
                    )
                  }
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
                  placeholder="Option A, Option B"
                  disabled={field.type !== "select"}
                />
              </label>
              <div className="md:col-span-1 flex items-end">
                <label className="inline-flex items-center gap-2 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    checked={field.required}
                    onChange={(event) =>
                      setFields((current) =>
                        current.map((item, itemIndex) =>
                          itemIndex === index
                            ? {
                                ...item,
                                required: event.target.checked,
                              }
                            : item
                        )
                      )
                    }
                  />
                  Required
                </label>
              </div>
              <div className="md:col-span-6 flex justify-end">
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
                  Remove field
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
