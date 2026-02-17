"use client";

import { useTransition, type ChangeEvent } from "react";

type ClientRow = {
  id: string;
  name: string;
};

type EmployeeInfoRecordRow = {
  id: string;
  full_name: string;
  client_id: string | null;
};

type EmployeeInfoColumnRow = {
  id: string;
  key: string;
  label: string;
  column_kind: "text" | "dropdown" | "formula";
  formula: string | null;
  options_json: unknown;
  position: number;
};

type EmployeeInfoValueRow = {
  text_value: string | null;
  option_value: string | null;
};

function parseOptionsJson(value: unknown) {
  if (!Array.isArray(value)) return [] as string[];
  return value
    .map((item) => String(item || "").trim())
    .filter(Boolean);
}

export default function EmployeeInfoTable({
  records,
  clients,
  columns,
  valuesByRecordId,
  formulaValueByRecordIdAndColumnId,
  onUpdateCell,
}: {
  records: EmployeeInfoRecordRow[];
  clients: ClientRow[];
  columns: EmployeeInfoColumnRow[];
  valuesByRecordId: Record<string, Record<string, EmployeeInfoValueRow>>;
  formulaValueByRecordIdAndColumnId: Record<string, Record<string, string>>;
  onUpdateCell: (formData: FormData) => Promise<unknown> | void;
}) {
  const [, startTransition] = useTransition();

  const submitChange = (event: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const form = event.currentTarget.form;
    if (!form) return;
    const formData = new FormData(form);
    startTransition(() => {
      void onUpdateCell(formData);
    });
  };

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-slate-200 text-sm">
        <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
          <tr>
            <th className="px-4 py-3">Full Name</th>
            <th className="px-4 py-3">Client</th>
            {columns.map((column) => (
              <th key={column.id} className="px-4 py-3">
                <div className="flex flex-col gap-0.5">
                  <span>{column.label}</span>
                  {column.column_kind === "formula" && column.formula ? (
                    <span className="text-[10px] normal-case text-slate-400">{column.formula}</span>
                  ) : null}
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-200 bg-white">
          {records.length ? (
            records.map((record) => {
              const valuesByColumnId = valuesByRecordId[record.id] || {};
              const formulasByColumnId = formulaValueByRecordIdAndColumnId[record.id] || {};
              return (
                <tr key={record.id}>
                  <td className="px-4 py-3">
                    <form>
                      <input type="hidden" name="record_id" value={record.id} />
                      <input type="hidden" name="base_field" value="full_name" />
                      <input
                        name="value"
                        defaultValue={record.full_name}
                        aria-label="Full name"
                        className="w-full min-w-[14rem] rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-700"
                        onChange={submitChange}
                      />
                    </form>
                  </td>
                  <td className="px-4 py-3">
                    <form>
                      <input type="hidden" name="record_id" value={record.id} />
                      <input type="hidden" name="base_field" value="client_id" />
                      <select
                        name="value"
                        defaultValue={record.client_id || ""}
                        aria-label="Client"
                        className="w-full min-w-[12rem] rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-700"
                        onChange={submitChange}
                      >
                        <option value="">N/A</option>
                        {clients.map((client) => (
                          <option key={client.id} value={client.id}>
                            {client.name}
                          </option>
                        ))}
                      </select>
                    </form>
                  </td>
                  {columns.map((column) => {
                    if (column.column_kind === "formula") {
                      return (
                        <td key={column.id} className="px-4 py-3 text-slate-700">
                          {formulasByColumnId[column.id] || "-"}
                        </td>
                      );
                    }

                    const valueRow = valuesByColumnId[column.id];
                    if (column.column_kind === "dropdown") {
                      const options = parseOptionsJson(column.options_json);
                      return (
                        <td key={column.id} className="px-4 py-3">
                          <form>
                            <input type="hidden" name="record_id" value={record.id} />
                            <input type="hidden" name="column_id" value={column.id} />
                            <input type="hidden" name="column_kind" value={column.column_kind} />
                            <select
                              name="value"
                              defaultValue={valueRow?.option_value || ""}
                              aria-label={column.label}
                              className="w-full min-w-[12rem] rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-700"
                              onChange={submitChange}
                            >
                              <option value="">N/A</option>
                              {options.map((option) => (
                                <option key={option} value={option}>
                                  {option}
                                </option>
                              ))}
                            </select>
                          </form>
                        </td>
                      );
                    }

                    return (
                      <td key={column.id} className="px-4 py-3">
                        <form>
                          <input type="hidden" name="record_id" value={record.id} />
                          <input type="hidden" name="column_id" value={column.id} />
                          <input type="hidden" name="column_kind" value={column.column_kind} />
                          <input
                            name="value"
                            defaultValue={valueRow?.text_value || ""}
                            aria-label={column.label}
                            className="w-full min-w-[12rem] rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-700"
                            onChange={submitChange}
                          />
                        </form>
                      </td>
                    );
                  })}
                </tr>
              );
            })
          ) : (
            <tr>
              <td className="px-4 py-6 text-slate-500" colSpan={2 + columns.length}>
                No employee records yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

