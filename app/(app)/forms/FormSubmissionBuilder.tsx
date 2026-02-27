"use client";

import { useMemo, useState } from "react";
import {
  doesFormFieldVisibilityMatch,
  ensureUniqueFormFieldKeys,
  normalizeFormFieldType,
  type FormField,
} from "./types";

type FieldValue = string | string[];
type ValueMap = Record<string, FieldValue>;

function asScalarValue(value: FieldValue | undefined): string {
  if (Array.isArray(value)) {
    return value.join(", ").trim();
  }
  return String(value || "").trim();
}

function asMultiSelectValue(value: FieldValue | undefined): string[] {
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry || "").trim()).filter(Boolean);
  }
  const scalar = String(value || "").trim();
  return scalar ? [scalar] : [];
}

function toVisibilityValues(values: ValueMap): Record<string, string> {
  return Object.fromEntries(
    Object.entries(values).map(([key, value]) => [key, asScalarValue(value)])
  );
}

function shouldShowField(field: FormField, values: ValueMap) {
  return doesFormFieldVisibilityMatch(field, toVisibilityValues(values));
}

export default function FormSubmissionBuilder({
  fields,
}: {
  fields: FormField[];
}) {
  const normalizedFields = useMemo(
    () =>
      ensureUniqueFormFieldKeys(
        fields.map((field) => ({
        ...field,
        type: normalizeFormFieldType(field.type),
        options: Array.isArray(field.options) ? field.options.filter(Boolean) : [],
        placeholder: String(field.placeholder || "").trim(),
        helpText: String(field.helpText || "").trim(),
        minValue: String(field.minValue || "").trim(),
        maxValue: String(field.maxValue || "").trim(),
      }))
      ),
    [fields]
  );
  const [values, setValues] = useState<ValueMap>({});

  return (
    <div className="mx-auto w-full max-w-2xl space-y-4">
      {normalizedFields.map((field) => {
        if (!field.key) return null;
        const visible = shouldShowField(field, values);
        if (!visible) return null;
        const required = Boolean(field.required);
        const scalarValue = asScalarValue(values[field.key]);
        const commonProps = {
          name: `field_${field.key}`,
          required,
          className:
            "mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal",
        };

        if (field.type === "textarea") {
          return (
            <label
              key={field.id}
              className="block text-xs font-semibold uppercase tracking-wide text-slate-600"
            >
              {field.label || field.key}
              {field.helpText ? (
                <span className="mt-1 block text-xs font-normal normal-case tracking-normal text-slate-500">
                  {field.helpText}
                </span>
              ) : null}
              <textarea
                {...commonProps}
                rows={4}
                placeholder={field.placeholder || undefined}
                value={scalarValue}
                onChange={(event) =>
                  setValues((current) => ({ ...current, [field.key]: event.target.value }))
                }
              />
            </label>
          );
        }

        if (field.type === "select") {
          return (
            <label
              key={field.id}
              className="block text-xs font-semibold uppercase tracking-wide text-slate-600"
            >
              {field.label || field.key}
              {field.helpText ? (
                <span className="mt-1 block text-xs font-normal normal-case tracking-normal text-slate-500">
                  {field.helpText}
                </span>
              ) : null}
              <select
                {...commonProps}
                value={scalarValue}
                onChange={(event) =>
                  setValues((current) => ({ ...current, [field.key]: event.target.value }))
                }
              >
                <option value="">Select</option>
                {(field.options || []).map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>
          );
        }

        if (field.type === "multi_select") {
          const selectedOptions = new Set(asMultiSelectValue(values[field.key]));
          const options = Array.isArray(field.options) ? field.options : [];
          return (
            <fieldset
              key={field.id}
              className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2"
            >
              <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-slate-600">
                {field.label || field.key}
              </legend>
              {field.helpText ? (
                <p className="text-xs font-normal normal-case tracking-normal text-slate-500">
                  {field.helpText}
                </p>
              ) : null}
              <div className="mt-2 space-y-2">
                {options.length ? (
                  options.map((option) => (
                    <label
                      key={`${field.id}_${option}`}
                      className="flex items-start gap-2 text-sm font-normal text-slate-700"
                    >
                      <input
                        type="checkbox"
                        name={`field_${field.key}`}
                        value={option}
                        checked={selectedOptions.has(option)}
                        onChange={(event) =>
                          setValues((current) => {
                            const next = new Set(asMultiSelectValue(current[field.key]));
                            if (event.target.checked) {
                              next.add(option);
                            } else {
                              next.delete(option);
                            }
                            return {
                              ...current,
                              [field.key]: Array.from(next),
                            };
                          })
                        }
                        className="mt-0.5"
                      />
                      <span>{option}</span>
                    </label>
                  ))
                ) : (
                  <p className="text-xs text-slate-500">No options configured.</p>
                )}
              </div>
            </fieldset>
          );
        }

        if (field.type === "checkbox") {
          return (
            <label key={field.id} className="block text-sm text-slate-700">
              <input
                type="checkbox"
                name={`field_${field.key}`}
                value="true"
                checked={scalarValue === "true"}
                onChange={(event) =>
                  setValues((current) => ({
                    ...current,
                    [field.key]: event.target.checked ? "true" : "false",
                  }))
                }
                className="mr-2"
              />
              {field.label || field.key}
              {field.helpText ? (
                <span className="mt-1 block text-xs text-slate-500">{field.helpText}</span>
              ) : null}
            </label>
          );
        }

        return (
          <label
            key={field.id}
            className="block text-xs font-semibold uppercase tracking-wide text-slate-600"
          >
            {field.label || field.key}
            {field.helpText ? (
              <span className="mt-1 block text-xs font-normal normal-case tracking-normal text-slate-500">
                {field.helpText}
              </span>
            ) : null}
            <input
              {...commonProps}
              type={field.type === "number" || field.type === "date" ? field.type : "text"}
              placeholder={field.placeholder || undefined}
              min={field.minValue || undefined}
              max={field.maxValue || undefined}
              value={scalarValue}
              onChange={(event) =>
                setValues((current) => ({ ...current, [field.key]: event.target.value }))
              }
            />
          </label>
        );
      })}
    </div>
  );
}
