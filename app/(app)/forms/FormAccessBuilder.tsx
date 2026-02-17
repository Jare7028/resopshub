"use client";

import { useMemo, useState } from "react";
import {
  formAccessLevelOptions,
  formatFormLabel,
  normalizeFormAccessLevel,
  type FormAccessAssignment,
} from "./types";

type UserOption = {
  id: string;
  label: string;
  secondaryLabel?: string;
};

type FormAccessRow = {
  rowId: string;
  user_id: string;
  access_level: "view" | "edit";
};

function createRow(seed: number): FormAccessRow {
  return {
    rowId: `access_${seed}`,
    user_id: "",
    access_level: "view",
  };
}

function normalizeAssignments(value: FormAccessAssignment[]) {
  const seen = new Set<string>();
  return value
    .map((entry) => ({
      user_id: String(entry.user_id || "").trim(),
      access_level: normalizeFormAccessLevel(entry.access_level),
    }))
    .filter((entry) => {
      if (!entry.user_id) return false;
      if (seen.has(entry.user_id)) return false;
      seen.add(entry.user_id);
      return true;
    });
}

export default function FormAccessBuilder({
  users,
  initialAssignments,
  name = "form_access_json",
  disabled = false,
}: {
  users: UserOption[];
  initialAssignments: FormAccessAssignment[];
  name?: string;
  disabled?: boolean;
}) {
  const initialRows = useMemo<FormAccessRow[]>(
    () =>
      normalizeAssignments(initialAssignments).map((entry, index) => ({
        rowId: `access_${index + 1}`,
        user_id: entry.user_id,
        access_level: entry.access_level,
      })),
    [initialAssignments]
  );

  const [rows, setRows] = useState<FormAccessRow[]>(initialRows);
  const [, setNextSeed] = useState(initialRows.length + 1);
  const serialized = useMemo(
    () =>
      JSON.stringify(
        normalizeAssignments(
          rows.map((row) => ({
            user_id: row.user_id,
            access_level: row.access_level,
          }))
        )
      ),
    [rows]
  );

  const updateRow = (rowId: string, patch: Partial<FormAccessRow>) => {
    setRows((previous) =>
      previous.map((row) => (row.rowId === rowId ? { ...row, ...patch } : row))
    );
  };

  const addRow = () => {
    setNextSeed((current) => {
      setRows((previous) => [...previous, createRow(current)]);
      return current + 1;
    });
  };

  const removeRow = (rowId: string) => {
    setRows((previous) => previous.filter((row) => row.rowId !== rowId));
  };

  return (
    <section className="rounded-md border border-slate-200 p-4">
      <input type="hidden" name={name} value={serialized} />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">Form access</h3>
          <p className="text-xs text-slate-600">
            Add people to this form and choose whether they can view or edit it.
          </p>
        </div>
        <button
          type="button"
          onClick={addRow}
          disabled={disabled}
          className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
        >
          Add person
        </button>
      </div>

      {rows.length ? (
        <div className="mt-3 space-y-2">
          {rows.map((row) => (
            <div key={row.rowId} className="grid gap-2 md:grid-cols-[2fr_1fr_auto]">
              <select
                value={row.user_id}
                disabled={disabled}
                onChange={(event) => updateRow(row.rowId, { user_id: event.currentTarget.value })}
                className="rounded-md border border-slate-300 px-3 py-2 text-sm"
              >
                <option value="">Select user</option>
                {users.map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.secondaryLabel ? `${user.label} (${user.secondaryLabel})` : user.label}
                  </option>
                ))}
              </select>

              <select
                value={row.access_level}
                disabled={disabled}
                onChange={(event) =>
                  updateRow(row.rowId, {
                    access_level: normalizeFormAccessLevel(event.currentTarget.value),
                  })
                }
                className="rounded-md border border-slate-300 px-3 py-2 text-sm"
              >
                {formAccessLevelOptions.map((level) => (
                  <option key={level} value={level}>
                    {formatFormLabel(level)}
                  </option>
                ))}
              </select>

              <button
                type="button"
                onClick={() => removeRow(row.rowId)}
                disabled={disabled}
                className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700 hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      ) : (
        <p className="mt-3 text-xs text-slate-500">Only the creator/admin can access this form right now.</p>
      )}
    </section>
  );
}
