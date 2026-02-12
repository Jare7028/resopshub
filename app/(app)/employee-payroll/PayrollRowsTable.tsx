"use client";

import { useMemo, useRef, useState } from "react";

type PayrollColumn = {
  id: string;
  key: string;
  label: string;
  kind: "number" | "formula";
  formula: string | null;
};

type PayrollRow = {
  id: string;
  employee_name: string;
  job_title: string | null;
  client_id: string | null;
  contract_type: string | null;
  billable: string | null;
};

type DropdownOption = {
  id: string;
  value: string;
};

type ClientOption = {
  id: string;
  name: string;
};

function evaluateFormula(formula: string | null, valuesByColumnKey: Record<string, number>) {
  if (!formula) return null;

  const normalized = formula
    .trim()
    .replace(/^=\s*/, "")
    .replace(/\b([A-Za-z_][A-Za-z0-9_]*)\b/g, (token: string) => {
      const key = token.toLowerCase();
      return key in valuesByColumnKey ? `{${key}}` : token;
    });

  const expression = normalized.replace(/\{([a-zA-Z0-9_]+)\}/g, (_, key: string) => {
    const value = valuesByColumnKey[key] ?? 0;
    return Number.isFinite(value) ? String(value) : "0";
  });

  if (/[^0-9+\-*/().\s]/.test(expression)) {
    return null;
  }

  try {
    const result = Function(`"use strict"; return (${expression});`)();
    if (typeof result !== "number" || !Number.isFinite(result)) {
      return null;
    }
    return result;
  } catch {
    return null;
  }
}

function formatMoneyLike(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "-";
  }
  return value.toFixed(2);
}

export default function PayrollRowsTable({
  rows,
  columns,
  numberColumns,
  cellValueByKey,
  clients,
  jobTitleOptions,
  contractTypeOptions,
  billableOptions,
  onDeleteRow,
}: {
  rows: PayrollRow[];
  columns: PayrollColumn[];
  numberColumns: PayrollColumn[];
  cellValueByKey: Record<string, number | null>;
  clients: ClientOption[];
  jobTitleOptions: DropdownOption[];
  contractTypeOptions: DropdownOption[];
  billableOptions: DropdownOption[];
  onDeleteRow: (formData: FormData) => Promise<void>;
}) {
  const [rowsState, setRowsState] = useState(rows);
  const [cellsState, setCellsState] = useState(cellValueByKey);
  const rowTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const cellTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const formulaByRowId = useMemo(() => {
    return rowsState.reduce<Record<string, Record<string, number>>>((acc, row) => {
      const valuesByKey = numberColumns.reduce<Record<string, number>>((map, column) => {
        const value = cellsState[`${row.id}:${column.id}`];
        map[column.key] = Number(value || 0);
        return map;
      }, {});
      acc[row.id] = valuesByKey;
      return acc;
    }, {});
  }, [rowsState, numberColumns, cellsState]);

  const queueRowSave = (rowId: string, payload: Partial<PayrollRow>) => {
    if (rowTimers.current[rowId]) {
      clearTimeout(rowTimers.current[rowId]);
    }
    rowTimers.current[rowId] = setTimeout(async () => {
      await fetch(`/api/employee-payroll/rows/${rowId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    }, 350);
  };

  const queueCellSave = (rowId: string, columnId: string, rawValue: string) => {
    const key = `${rowId}:${columnId}`;
    if (cellTimers.current[key]) {
      clearTimeout(cellTimers.current[key]);
    }
    cellTimers.current[key] = setTimeout(async () => {
      const trimmed = rawValue.trim();
      const numberValue = trimmed === "" ? null : Number(trimmed);
      if (trimmed !== "" && !Number.isFinite(numberValue)) return;
      await fetch("/api/employee-payroll/cells", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          row_id: rowId,
          column_id: columnId,
          number_value: numberValue,
        }),
      });
    }, 350);
  };

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-left text-sm">
        <thead className="bg-slate-50 text-xs uppercase text-slate-500">
          <tr>
            <th className="px-6 py-3">Name</th>
            <th className="px-6 py-3">Job Title</th>
            <th className="px-6 py-3">Client</th>
            <th className="px-6 py-3">Client</th>
            <th className="px-6 py-3">Billable</th>
            {columns.map((column) => (
              <th key={column.id} className="px-6 py-3">
                <div className="flex flex-col">
                  <span>{column.label}</span>
                  {column.kind === "formula" ? (
                    <span className="normal-case text-[11px] text-slate-400">{column.formula}</span>
                  ) : null}
                </div>
              </th>
            ))}
            <th className="px-6 py-3">Actions</th>
          </tr>
        </thead>
        <tbody>
          {rowsState.length ? (
            rowsState.map((row) => (
              <tr key={row.id} className="border-t border-slate-200 align-top">
                <td className="px-6 py-3">
                  <input
                    value={row.employee_name}
                    className="w-56 rounded-md border border-slate-300 px-2 py-1 text-sm"
                    onChange={(event) => {
                      const next = event.target.value;
                      setRowsState((prev) =>
                        prev.map((item) =>
                          item.id === row.id ? { ...item, employee_name: next } : item
                        )
                      );
                      if (next.trim()) {
                        queueRowSave(row.id, { employee_name: next });
                      }
                    }}
                  />
                </td>
                <td className="px-6 py-3">
                  <select
                    value={row.job_title || ""}
                    className="w-56 rounded-md border border-slate-300 px-2 py-1 text-sm"
                    onChange={(event) => {
                      const next = event.target.value;
                      setRowsState((prev) =>
                        prev.map((item) => (item.id === row.id ? { ...item, job_title: next } : item))
                      );
                      queueRowSave(row.id, { job_title: next || null });
                    }}
                  >
                    <option value="">N/A</option>
                    {jobTitleOptions.map((option) => (
                      <option key={option.id} value={option.value}>
                        {option.value}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="px-6 py-3">
                  <select
                    value={row.billable || ""}
                    className="w-56 rounded-md border border-slate-300 px-2 py-1 text-sm"
                    onChange={(event) => {
                      const next = event.target.value;
                      setRowsState((prev) =>
                        prev.map((item) => (item.id === row.id ? { ...item, billable: next } : item))
                      );
                      queueRowSave(row.id, { billable: next || null });
                    }}
                  >
                    <option value="">N/A</option>
                    {billableOptions.map((option) => (
                      <option key={option.id} value={option.value}>
                        {option.value}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="px-6 py-3">
                  <select
                    value={row.client_id || ""}
                    className="w-56 rounded-md border border-slate-300 px-2 py-1 text-sm"
                    onChange={(event) => {
                      const next = event.target.value;
                      setRowsState((prev) =>
                        prev.map((item) => (item.id === row.id ? { ...item, client_id: next } : item))
                      );
                      queueRowSave(row.id, { client_id: next || null });
                    }}
                  >
                    <option value="">N/A</option>
                    {clients.map((client) => (
                      <option key={client.id} value={client.id}>
                        {client.name}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="px-6 py-3">
                  <select
                    value={row.contract_type || ""}
                    className="w-56 rounded-md border border-slate-300 px-2 py-1 text-sm"
                    onChange={(event) => {
                      const next = event.target.value;
                      setRowsState((prev) =>
                        prev.map((item) =>
                          item.id === row.id ? { ...item, contract_type: next } : item
                        )
                      );
                      queueRowSave(row.id, { contract_type: next || null });
                    }}
                  >
                    <option value="">N/A</option>
                    {contractTypeOptions.map((option) => (
                      <option key={option.id} value={option.value}>
                        {option.value}
                      </option>
                    ))}
                  </select>
                </td>

                {columns.map((column) => {
                  if (column.kind === "formula") {
                    const formulaValue = evaluateFormula(
                      column.formula,
                      formulaByRowId[row.id] || {}
                    );
                    return (
                      <td key={column.id} className="px-6 py-3 text-slate-700">
                        {formatMoneyLike(formulaValue)}
                      </td>
                    );
                  }

                  const mapKey = `${row.id}:${column.id}`;
                  return (
                    <td key={column.id} className="px-6 py-3">
                      <input
                        type="number"
                        step="0.01"
                        value={cellsState[mapKey] ?? ""}
                        className="w-36 rounded-md border border-slate-300 px-2 py-1 text-sm"
                        placeholder={column.label}
                        onChange={(event) => {
                          const next = event.target.value;
                          setCellsState((prev) => ({
                            ...prev,
                            [mapKey]: next === "" ? null : Number(next),
                          }));
                          queueCellSave(row.id, column.id, next);
                        }}
                      />
                    </td>
                  );
                })}

                <td className="px-6 py-3">
                  <form action={onDeleteRow}>
                    <input type="hidden" name="row_id" value={row.id} />
                    <button
                      type="submit"
                      className="rounded-md border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-100"
                    >
                      Delete
                    </button>
                  </form>
                </td>
              </tr>
            ))
          ) : (
            <tr>
              <td className="px-6 py-6 text-slate-500" colSpan={columns.length + 6}>
                No payroll rows yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
