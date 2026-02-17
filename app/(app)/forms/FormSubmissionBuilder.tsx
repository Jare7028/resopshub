"use client";

import { useMemo, useState } from "react";
import {
  doesFormFieldVisibilityMatch,
  normalizeFormFieldType,
  type FormField,
} from "./types";

type ValueMap = Record<string, string>;

function shouldShowField(field: FormField, values: ValueMap) {
  return doesFormFieldVisibilityMatch(field, values);
}

export default function FormSubmissionBuilder({
  fields,
}: {
  fields: FormField[];
}) {
  const normalizedFields = useMemo(
    () =>
      fields.map((field) => ({
        ...field,
        type: normalizeFormFieldType(field.type),
        options: Array.isArray(field.options) ? field.options.filter(Boolean) : [],
        placeholder: String(field.placeholder || "").trim(),
        helpText: String(field.helpText || "").trim(),
        minValue: String(field.minValue || "").trim(),
        maxValue: String(field.maxValue || "").trim(),
        pattern: String(field.pattern || "").trim(),
      })),
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
                value={values[field.key] || ""}
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
                value={values[field.key] || ""}
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

        if (field.type === "checkbox") {
          return (
            <label key={field.id} className="block text-sm text-slate-700">
              <input
                type="checkbox"
                name={`field_${field.key}`}
                value="true"
                checked={values[field.key] === "true"}
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
              pattern={field.pattern || undefined}
              value={values[field.key] || ""}
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
