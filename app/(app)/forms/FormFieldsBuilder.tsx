"use client";

import { useMemo, useState } from "react";
import {
  buildFieldKey,
  formFieldTypeOptions,
  formatFormLabel,
  normalizeFormFieldType,
  type FormField,
} from "./types";

function createField(seed: number): FormField {
  return {
    id: `field_${seed}`,
    key: `field_${seed}`,
    label: "",
    type: "text",
    required: false,
    options: [],
    condition: null,
  };
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

  const serialized = useMemo(() => JSON.stringify(fields), [fields]);

  return (
    <div className="space-y-4">
      <input type="hidden" name={name} value={serialized} />
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-base font-semibold text-slate-900">Form fields</h3>
        <button
          type="button"
          onClick={() =>
            setFields((current) => [...current, createField(current.length + 1)])
          }
          className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:border-slate-400 hover:text-slate-900"
        >
          Add field
        </button>
      </div>
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
