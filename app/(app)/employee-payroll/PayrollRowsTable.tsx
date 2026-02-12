"use client";

import { useRef, useState } from "react";

type PayrollColumn = {
  id: string;
  key: string;
  label: string;
  kind: "number" | "formula";
  formula: string | null;
  position: number;
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

type NewColumnResponse = {
  column: PayrollColumn;
};

export default function PayrollRowsTable({
  rows,
  columns,
  cellValueByKey,
  clients,
  jobTitleOptions,
  contractTypeOptions,
  billableOptions,
  onDeleteRow,
}: {
  rows: PayrollRow[];
  columns: PayrollColumn[];
  cellValueByKey: Record<string, string>;
  clients: ClientOption[];
  jobTitleOptions: DropdownOption[];
  contractTypeOptions: DropdownOption[];
  billableOptions: DropdownOption[];
  onDeleteRow: (formData: FormData) => Promise<void>;
}) {
  const [rowsState, setRowsState] = useState(rows);
  const [columnsState, setColumnsState] = useState(columns);
  const [cellsState, setCellsState] = useState(cellValueByKey);
  const [isAddingColumn, setIsAddingColumn] = useState(false);
  const rowTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const cellTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const columnTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const selectBaseClass = "w-56 rounded-md border px-2 py-1 text-sm";

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

  const queueCellSave = (rowId: string, columnId: string, value: string) => {
    const key = `${rowId}:${columnId}`;
    if (cellTimers.current[key]) {
      clearTimeout(cellTimers.current[key]);
    }
    cellTimers.current[key] = setTimeout(async () => {
      await fetch("/api/employee-payroll/cells", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          row_id: rowId,
          column_id: columnId,
          value,
        }),
      });
    }, 350);
  };

  const queueColumnSave = (columnId: string, label: string) => {
    if (columnTimers.current[columnId]) {
      clearTimeout(columnTimers.current[columnId]);
    }
    columnTimers.current[columnId] = setTimeout(async () => {
      await fetch(`/api/employee-payroll/columns/${columnId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label }),
      });
    }, 400);
  };

  const addColumn = async () => {
    if (isAddingColumn) return;
    setIsAddingColumn(true);
    try {
      const response = await fetch("/api/employee-payroll/columns", { method: "POST" });
      const payload = (await response.json()) as NewColumnResponse | { error?: string };
      if (!response.ok || !("column" in payload) || !payload.column) return;
      setColumnsState((prev) => [...prev, payload.column].sort((a, b) => a.position - b.position));
    } finally {
      setIsAddingColumn(false);
    }
  };

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-left text-sm">
        <thead className="bg-slate-50 text-xs uppercase text-slate-500">
          <tr>
            <th className="sticky left-0 top-0 z-30 border-r border-slate-200 bg-slate-50 px-6 py-3">
              Name
            </th>
            <th className="sticky top-0 z-20 bg-slate-50 px-6 py-3">Job Title</th>
            <th className="sticky top-0 z-20 bg-slate-50 px-6 py-3">Billable</th>
            <th className="sticky top-0 z-20 bg-slate-50 px-6 py-3">Client</th>
            <th className="sticky top-0 z-20 bg-slate-50 px-6 py-3">Contract Type</th>
            {columnsState.map((column) => (
              <th key={column.id} className="sticky top-0 z-20 bg-slate-50 px-6 py-3">
                <input
                  value={column.label}
                  className="w-44 rounded-md border border-slate-300 bg-white px-2 py-1 text-xs font-semibold uppercase text-slate-700"
                  onChange={(event) => {
                    const next = event.target.value;
                    setColumnsState((prev) =>
                      prev.map((item) => (item.id === column.id ? { ...item, label: next } : item))
                    );
                    if (next.trim()) {
                      queueColumnSave(column.id, next.trim());
                    }
                  }}
                />
              </th>
            ))}
            <th className="sticky top-0 z-20 bg-slate-50 px-6 py-3">
              <button
                type="button"
                onClick={addColumn}
                disabled={isAddingColumn}
                className="flex h-8 w-8 items-center justify-center rounded-md border border-slate-300 text-lg font-semibold text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
              >
                +
              </button>
            </th>
            <th className="sticky top-0 z-20 bg-slate-50 px-6 py-3">Actions</th>
          </tr>
        </thead>
        <tbody>
          {rowsState.length ? (
            rowsState.map((row) => (
              <tr key={row.id} className="border-t border-slate-200 align-top">
                <td className="sticky left-0 z-10 border-r border-slate-200 bg-white px-6 py-3">
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
                      if (next.trim()) queueRowSave(row.id, { employee_name: next });
                    }}
                  />
                </td>
                <td className="px-6 py-3">
                  <select
                    value={row.job_title || ""}
                    className={`${selectBaseClass} ${
                      row.job_title ? "border-slate-300" : "border-red-200 bg-red-50 text-red-700"
                    }`}
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
                    className={`${selectBaseClass} ${
                      row.billable ? "border-slate-300" : "border-red-200 bg-red-50 text-red-700"
                    }`}
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
                    className={`${selectBaseClass} ${
                      row.client_id ? "border-slate-300" : "border-red-200 bg-red-50 text-red-700"
                    }`}
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

                {columnsState.map((column) => {
                  const mapKey = `${row.id}:${column.id}`;
                  const rawValue = cellsState[mapKey] ?? "";
                  return (
                    <td key={column.id} className="px-6 py-3">
                      <input
                        type="text"
                        value={rawValue}
                        className="w-44 rounded-md border border-slate-300 px-2 py-1 text-sm"
                        placeholder={column.label}
                        onChange={(event) => {
                          const next = event.target.value;
                          setCellsState((prev) => ({ ...prev, [mapKey]: next }));
                          queueCellSave(row.id, column.id, next);
                        }}
                      />
                    </td>
                  );
                })}

                <td className="px-6 py-3" />
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
              <td className="px-6 py-6 text-slate-500" colSpan={columnsState.length + 8}>
                No payroll rows yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

