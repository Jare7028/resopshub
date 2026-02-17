"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  buildFieldKey,
  conditionOperatorUsesValue,
  doesFormFieldVisibilityMatch,
  formFieldConditionModeOptions,
  formFieldConditionOperatorOptions,
  formatFormLabel,
  normalizeFormFieldConditionMode,
  normalizeFormFieldConditionOperator,
  normalizeFormFieldMetadata,
  normalizeFormFieldVisibility,
  normalizeFormFieldType,
  type FormFieldCondition,
  type FormField,
} from "./types";

type BuilderFieldType = "text" | "textarea" | "number" | "date" | "select" | "checkbox";

const builderFieldTypes: Array<{ value: BuilderFieldType; label: string }> = [
  { value: "text", label: "Text" },
  { value: "textarea", label: "Long text" },
  { value: "number", label: "Number" },
  { value: "date", label: "Date" },
  { value: "select", label: "Dropdown" },
  { value: "checkbox", label: "Checkbox" },
];

function createField(seed: number, type: BuilderFieldType = "text"): FormField {
  return {
    id: `field_${seed}`,
    key: `field_${seed}`,
    label: "",
    type,
    required: false,
    options: [],
    placeholder: "",
    helpText: "",
    minValue: "",
    maxValue: "",
    pattern: "",
    conditionMode: "all",
    conditions: [],
    condition: null,
  };
}

function TypeIcon({ type }: { type: BuilderFieldType }) {
  const cls = "h-4 w-4 text-slate-500";
  if (type === "textarea") {
    return (
      <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" className={cls}>
        <path d="M4 6h12M4 10h12M4 14h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    );
  }
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
  if (type === "checkbox") {
    return (
      <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" className={cls}>
        <rect x="3.5" y="3.5" width="13" height="13" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
        <path d="m7 10 2 2 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
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
    return initialFields.map((field, index) => {
      const visibility = normalizeFormFieldVisibility(field);
      const metadata = normalizeFormFieldMetadata(field);
      return {
        ...field,
        id: field.id || `field_${index + 1}`,
        key: field.key || `field_${index + 1}`,
        label: field.label || "",
        type: normalizeFormFieldType(field.type),
        required: Boolean(field.required),
        options: Array.isArray(field.options) ? field.options.filter(Boolean) : [],
        placeholder: metadata.placeholder,
        helpText: metadata.helpText,
        minValue: metadata.minValue,
        maxValue: metadata.maxValue,
        pattern: metadata.pattern,
        conditionMode: visibility.conditionMode,
        conditions: visibility.conditions,
        condition: visibility.condition,
      };
    });
  }, [initialFields]);

  const [fields, setFields] = useState<FormField[]>(normalizedInitialFields);
  const [isAddFieldModalOpen, setIsAddFieldModalOpen] = useState(false);
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [previewValues, setPreviewValues] = useState<Record<string, string>>({});
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

  const withVisibility = (
    field: FormField,
    visibility: { conditionMode?: string | null; conditions: FormFieldCondition[] }
  ): FormField => {
    const conditionMode = normalizeFormFieldConditionMode(visibility.conditionMode || field.conditionMode);
    const normalizedConditions = visibility.conditions;
    const firstValidCondition =
      normalizedConditions.find((condition) => Boolean(condition?.fieldKey)) || null;
    return {
      ...field,
      conditionMode,
      conditions: normalizedConditions,
      condition: firstValidCondition,
    };
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
        {fields.map((field, index) => {
          const visibility = normalizeFormFieldVisibility(field);
          const conditions = visibility.conditions;
          const conditionMode = visibility.conditionMode;
          const conditionFieldOptions = fields
            .filter((candidate, candidateIndex) => candidateIndex !== index && Boolean(candidate.key))
            .map((candidate, candidateIndex) => ({
              key: candidate.key,
              label: candidate.label || formatFormLabel(candidate.key) || `Field ${candidateIndex + 1}`,
            }));
          const canAddCondition = conditionFieldOptions.length > 0;

          return (
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
                <div className="md:col-span-12 space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                    Dropdown options
                  </p>
                  {[
                    ...(field.options || []),
                    ...((field.options || []).length === 0 ||
                    (field.options || [])[Math.max((field.options || []).length - 1, 0)]?.trim()
                      ? [""]
                      : []),
                  ].map((value, optionIndex) => (
                    <input
                      key={`${field.id}_option_${optionIndex}`}
                      value={value}
                      onChange={(event) =>
                        updateField(index, (item) => {
                          const existing = [...(item.options || [])];
                          if (optionIndex >= existing.length) {
                            existing.push(event.target.value);
                          } else {
                            existing[optionIndex] = event.target.value;
                          }
                          return {
                            ...item,
                            options: existing.filter((option) => option.trim().length > 0),
                          };
                        })
                      }
                      className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
                      placeholder={`Dropdown ${optionIndex + 1}`}
                    />
                  ))}
                </div>
              ) : null}

              {openAdvancedByFieldId[field.id] ? (
                <>
                  <label className="md:col-span-6 text-xs font-semibold uppercase tracking-wide text-slate-600">
                    Placeholder
                    <input
                      value={field.placeholder || ""}
                      onChange={(event) =>
                        updateField(index, (item) => ({
                          ...item,
                          placeholder: event.target.value,
                        }))
                      }
                      className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
                      placeholder="e.g. Enter response"
                    />
                  </label>
                  <label className="md:col-span-6 text-xs font-semibold uppercase tracking-wide text-slate-600">
                    Help text
                    <input
                      value={field.helpText || ""}
                      onChange={(event) =>
                        updateField(index, (item) => ({
                          ...item,
                          helpText: event.target.value,
                        }))
                      }
                      className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
                      placeholder="Short guidance shown under label"
                    />
                  </label>
                  {(field.type === "number" || field.type === "date") ? (
                    <>
                      <label className="md:col-span-2 text-xs font-semibold uppercase tracking-wide text-slate-600">
                        Min value
                        <input
                          type={field.type === "date" ? "date" : "number"}
                          value={field.minValue || ""}
                          onChange={(event) =>
                            updateField(index, (item) => ({
                              ...item,
                              minValue: event.target.value,
                            }))
                          }
                          className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
                          placeholder={field.type === "date" ? "YYYY-MM-DD" : "0"}
                        />
                      </label>
                      <label className="md:col-span-2 text-xs font-semibold uppercase tracking-wide text-slate-600">
                        Max value
                        <input
                          type={field.type === "date" ? "date" : "number"}
                          value={field.maxValue || ""}
                          onChange={(event) =>
                            updateField(index, (item) => ({
                              ...item,
                              maxValue: event.target.value,
                            }))
                          }
                          className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
                          placeholder={field.type === "date" ? "YYYY-MM-DD" : "100"}
                        />
                      </label>
                    </>
                  ) : null}
                  <div className="md:col-span-12 text-xs font-semibold uppercase tracking-wide text-slate-600">
                    <p>Visibility rules</p>
                    <div className="mt-1 space-y-3 rounded-md border border-slate-200 bg-slate-50 p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        {conditions.length > 1 ? (
                          <label className="text-[11px] font-semibold uppercase tracking-wide text-slate-600">
                            Match
                            <select
                              value={conditionMode}
                              onChange={(event) =>
                                updateField(index, (item) =>
                                  withVisibility(item, {
                                    conditionMode: event.target.value,
                                    conditions,
                                  })
                                )
                              }
                              className="mt-1 rounded-md border border-slate-300 bg-white px-2 py-1 text-xs font-medium text-slate-700"
                            >
                              {formFieldConditionModeOptions.map((mode) => (
                                <option key={mode} value={mode}>
                                  {mode === "all" ? "All rules (AND)" : "Any rule (OR)"}
                                </option>
                              ))}
                            </select>
                          </label>
                        ) : (
                          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                            {conditions.length ? "1 rule" : "Always visible"}
                          </p>
                        )}
                        <button
                          type="button"
                          onClick={() =>
                            updateField(index, (item) =>
                              withVisibility(item, {
                                conditionMode,
                                conditions: [
                                  ...conditions,
                                  {
                                    fieldKey: conditionFieldOptions[0]?.key || "",
                                    operator: "equals",
                                    value: "",
                                  },
                                ],
                              })
                            )
                          }
                          className="rounded-md border border-slate-300 px-2.5 py-1 text-[11px] font-semibold text-slate-700 hover:border-slate-400 disabled:cursor-not-allowed disabled:opacity-50"
                          disabled={!canAddCondition}
                        >
                          Add rule
                        </button>
                      </div>

                      {!canAddCondition ? (
                        <p className="text-xs font-normal normal-case text-slate-500">
                          Add another field first to build visibility rules.
                        </p>
                      ) : null}

                      {conditions.map((condition, conditionIndex) => {
                        const conditionOperator = normalizeFormFieldConditionOperator(
                          condition.operator
                        );
                        const showConditionValue = conditionOperatorUsesValue(conditionOperator);
                        return (
                          <div
                            key={`${field.id}_condition_${conditionIndex}`}
                            className="grid gap-2 rounded-md border border-slate-200 bg-white p-2 md:grid-cols-12"
                          >
                            <label className="md:col-span-5 text-[11px] font-semibold uppercase tracking-wide text-slate-600">
                              Field
                              <select
                                value={condition.fieldKey}
                                onChange={(event) =>
                                  updateField(index, (item) => {
                                    const nextConditions = [...conditions];
                                    nextConditions[conditionIndex] = {
                                      ...nextConditions[conditionIndex],
                                      fieldKey: event.target.value,
                                    };
                                    return withVisibility(item, {
                                      conditionMode,
                                      conditions: nextConditions,
                                    });
                                  })
                                }
                                className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-xs font-normal"
                              >
                                <option value="">Select field</option>
                                {conditionFieldOptions.map((option) => (
                                  <option key={option.key} value={option.key}>
                                    {option.label}
                                  </option>
                                ))}
                              </select>
                            </label>

                            <label className="md:col-span-3 text-[11px] font-semibold uppercase tracking-wide text-slate-600">
                              Condition
                              <select
                                value={conditionOperator}
                                onChange={(event) =>
                                  updateField(index, (item) => {
                                    const nextOperator = normalizeFormFieldConditionOperator(
                                      event.target.value
                                    );
                                    const nextConditions = [...conditions];
                                    nextConditions[conditionIndex] = {
                                      ...nextConditions[conditionIndex],
                                      operator: nextOperator,
                                      value: conditionOperatorUsesValue(nextOperator)
                                        ? nextConditions[conditionIndex]?.value || ""
                                        : "",
                                    };
                                    return withVisibility(item, {
                                      conditionMode,
                                      conditions: nextConditions,
                                    });
                                  })
                                }
                                className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-xs font-normal"
                              >
                                {formFieldConditionOperatorOptions.map((operator) => (
                                  <option key={operator} value={operator}>
                                    {formatFormLabel(operator)}
                                  </option>
                                ))}
                              </select>
                            </label>

                            <label className="md:col-span-3 text-[11px] font-semibold uppercase tracking-wide text-slate-600">
                              Value
                              <input
                                value={condition.value || ""}
                                onChange={(event) =>
                                  updateField(index, (item) => {
                                    const nextConditions = [...conditions];
                                    nextConditions[conditionIndex] = {
                                      ...nextConditions[conditionIndex],
                                      value: event.target.value,
                                    };
                                    return withVisibility(item, {
                                      conditionMode,
                                      conditions: nextConditions,
                                    });
                                  })
                                }
                                className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-xs font-normal disabled:bg-slate-100 disabled:text-slate-400"
                                placeholder="Expected value"
                                disabled={!showConditionValue}
                              />
                            </label>

                            <div className="md:col-span-1 flex items-end justify-end">
                              <button
                                type="button"
                                onClick={() =>
                                  updateField(index, (item) =>
                                    withVisibility(item, {
                                      conditionMode,
                                      conditions: conditions.filter(
                                        (_entry, entryIndex) => entryIndex !== conditionIndex
                                      ),
                                    })
                                  )
                                }
                                className="rounded-md border border-red-200 px-2 py-1 text-[11px] font-semibold text-red-700 hover:border-red-300 hover:text-red-800"
                                aria-label="Remove condition"
                              >
                                x
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </>
              ) : null}
              </div>
            </div>
          );
        })}
      </div>

      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h4 className="text-sm font-semibold text-slate-900">Visibility preview</h4>
            <p className="text-xs text-slate-500">
              Enter sample answers to test visibility rules instantly.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setIsPreviewOpen((current) => !current)}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:border-slate-400"
          >
            {isPreviewOpen ? "Hide preview" : "Open preview"}
          </button>
        </div>

        {isPreviewOpen ? (
          <div className="mt-4 space-y-4">
            <div className="grid gap-3 md:grid-cols-2">
              {fields
                .filter((field) => Boolean(field.key))
                .map((field) => {
                  const fieldLabel = field.label || formatFormLabel(field.key) || field.key;
                  const value = previewValues[field.key] || "";
                  if (field.type === "select") {
                    return (
                      <label
                        key={`${field.id}_preview`}
                        className="text-xs font-semibold uppercase tracking-wide text-slate-600"
                      >
                        {fieldLabel}
                        <select
                          value={value}
                          onChange={(event) =>
                            setPreviewValues((current) => ({
                              ...current,
                              [field.key]: event.target.value,
                            }))
                          }
                          className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
                        >
                          <option value="">(blank)</option>
                          {(field.options || []).map((option) => (
                            <option key={`${field.id}_preview_option_${option}`} value={option}>
                              {option}
                            </option>
                          ))}
                        </select>
                      </label>
                    );
                  }
                  if (field.type === "checkbox") {
                    return (
                      <label
                        key={`${field.id}_preview`}
                        className="inline-flex items-center gap-2 text-sm text-slate-700"
                      >
                        <input
                          type="checkbox"
                          checked={value === "true"}
                          onChange={(event) =>
                            setPreviewValues((current) => ({
                              ...current,
                              [field.key]: event.target.checked ? "true" : "false",
                            }))
                          }
                        />
                        {fieldLabel}
                      </label>
                    );
                  }
                  if (field.type === "textarea") {
                    return (
                      <label
                        key={`${field.id}_preview`}
                        className="text-xs font-semibold uppercase tracking-wide text-slate-600"
                      >
                        {fieldLabel}
                        <textarea
                          rows={2}
                          value={value}
                          onChange={(event) =>
                            setPreviewValues((current) => ({
                              ...current,
                              [field.key]: event.target.value,
                            }))
                          }
                          className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
                        />
                      </label>
                    );
                  }
                  return (
                    <label
                      key={`${field.id}_preview`}
                      className="text-xs font-semibold uppercase tracking-wide text-slate-600"
                    >
                      {fieldLabel}
                      <input
                        type={field.type === "number" || field.type === "date" ? field.type : "text"}
                        value={value}
                        onChange={(event) =>
                          setPreviewValues((current) => ({
                            ...current,
                            [field.key]: event.target.value,
                          }))
                        }
                        className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
                      />
                    </label>
                  );
                })}
            </div>

            <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                Current visibility
              </p>
              <div className="mt-2 space-y-1">
                {fields.map((field) => {
                  const fieldLabel = field.label || formatFormLabel(field.key) || field.key || field.id;
                  const visible = doesFormFieldVisibilityMatch(field, previewValues);
                  return (
                    <p key={`${field.id}_visibility`} className="flex items-center justify-between gap-3 text-sm">
                      <span className="text-slate-700">{fieldLabel}</span>
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                          visible
                            ? "bg-emerald-100 text-emerald-700"
                            : "bg-slate-200 text-slate-600"
                        }`}
                      >
                        {visible ? "Visible" : "Hidden"}
                      </span>
                    </p>
                  );
                })}
              </div>
            </div>
          </div>
        ) : null}
      </section>
    </div>
  );
}
