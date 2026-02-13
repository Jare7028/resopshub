"use client";

import { useMemo, useState } from "react";
import { normalizeFormFieldType, type FormField } from "./types";

type ValueMap = Record<string, string>;

function shouldShowField(field: FormField, values: ValueMap) {
  if (!field.condition?.fieldKey) return true;
  const expected = String(field.condition.equals || "").trim().toLowerCase();
  const actual = String(values[field.condition.fieldKey] || "").trim().toLowerCase();
  return actual === expected;
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
      })),
    [fields]
  );
  const [values, setValues] = useState<ValueMap>({});

  return (
    <div className="grid gap-4 md:grid-cols-2">
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
              className="md:col-span-2 text-xs font-semibold uppercase tracking-wide text-slate-600"
            >
              {field.label || field.key}
              <textarea
                {...commonProps}
                rows={4}
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
              className="text-xs font-semibold uppercase tracking-wide text-slate-600"
            >
              {field.label || field.key}
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
            <label key={field.id} className="text-sm text-slate-700">
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
            </label>
          );
        }

        return (
          <label
            key={field.id}
            className="text-xs font-semibold uppercase tracking-wide text-slate-600"
          >
            {field.label || field.key}
            <input
              {...commonProps}
              type={field.type === "number" || field.type === "date" ? field.type : "text"}
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
