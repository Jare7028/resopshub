"use client";

import { useEffect, useRef, useState, useTransition, type ChangeEvent } from "react";
import FormulaAutocompleteInput, {
  type FormulaSuggestion,
} from "./FormulaAutocompleteInput";

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
  column_kind: "text" | "dropdown" | "formula" | "number";
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

function formatOptionsInput(value: unknown) {
  return parseOptionsJson(value).join(", ");
}

function ColumnEditPanel({
  column,
  columnIndex,
  totalColumns,
  formulaSuggestions,
  onUpdateColumn,
  onDeleteColumn,
  onMoveColumn,
}: {
  column: EmployeeInfoColumnRow;
  columnIndex: number;
  totalColumns: number;
  formulaSuggestions: FormulaSuggestion[];
  onUpdateColumn: (formData: FormData) => Promise<void> | void;
  onDeleteColumn: (formData: FormData) => Promise<void> | void;
  onMoveColumn: (formData: FormData) => Promise<void> | void;
}) {
  const [columnKind, setColumnKind] = useState<EmployeeInfoColumnRow["column_kind"]>(
    column.column_kind
  );
  const detailsRef = useRef<HTMLDetailsElement | null>(null);
  const updateFormRef = useRef<HTMLFormElement | null>(null);
  const initialLabel = column.label;
  const initialKind = column.column_kind;
  const initialDropdownOptions = formatOptionsInput(column.options_json);
  const initialFormula = column.formula || "";

  useEffect(() => {
    const onDocumentMouseDown = (event: MouseEvent) => {
      const details = detailsRef.current;
      const updateForm = updateFormRef.current;
      if (!details?.open || !updateForm) return;

      const target = event.target as Node | null;
      if (target && details.contains(target)) return;

      const formData = new FormData(updateForm);
      const nextLabel = String(formData.get("label") || "");
      const nextKind = String(formData.get("column_kind") || "");
      const nextDropdownOptions = String(formData.get("dropdown_options") || "");
      const nextFormula = String(formData.get("formula") || "");

      const hasChanges =
        nextLabel !== initialLabel ||
        nextKind !== initialKind ||
        nextDropdownOptions !== initialDropdownOptions ||
        nextFormula !== initialFormula;

      if (hasChanges) {
        if (!updateForm.reportValidity()) {
          return;
        }
        updateForm.requestSubmit();
      }

      details.open = false;
    };

    document.addEventListener("mousedown", onDocumentMouseDown);
    return () => {
      document.removeEventListener("mousedown", onDocumentMouseDown);
    };
  }, [initialDropdownOptions, initialFormula, initialKind, initialLabel]);

  return (
    <details ref={detailsRef} className="relative shrink-0">
      <summary
        className="flex h-6 items-center rounded border border-slate-300 bg-white px-2 text-[10px] font-semibold tracking-normal text-slate-600 hover:bg-slate-100 [&::-webkit-details-marker]:hidden"
        aria-label={`Edit ${column.label}`}
        title={`Edit ${column.label}`}
      >
        Edit
      </summary>
      <div className="absolute right-0 z-20 mt-1 w-72 rounded-md border border-slate-200 bg-white p-3 text-left normal-case shadow-lg">
        <div className="mb-2 grid grid-cols-2 gap-2">
          <form action={onMoveColumn}>
            <input type="hidden" name="column_id" value={column.id} />
            <input type="hidden" name="direction" value="left" />
            <button
              type="submit"
              disabled={columnIndex === 0}
              className="h-8 w-full rounded-md border border-slate-300 bg-white px-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Move left
            </button>
          </form>
          <form action={onMoveColumn}>
            <input type="hidden" name="column_id" value={column.id} />
            <input type="hidden" name="direction" value="right" />
            <button
              type="submit"
              disabled={columnIndex === totalColumns - 1}
              className="h-8 w-full rounded-md border border-slate-300 bg-white px-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Move right
            </button>
          </form>
        </div>
        <form ref={updateFormRef} action={onUpdateColumn} className="grid gap-2">
          <input type="hidden" name="column_id" value={column.id} />
          <input
            name="label"
            defaultValue={column.label}
            placeholder="Column label"
            className="h-9 rounded-md border border-slate-300 bg-white px-2 text-xs text-slate-700"
            required
          />
          <select
            name="column_kind"
            value={columnKind}
            onChange={(event) =>
              setColumnKind(event.currentTarget.value as EmployeeInfoColumnRow["column_kind"])
            }
            className="h-9 rounded-md border border-slate-300 bg-white px-2 text-xs text-slate-700"
          >
            <option value="text">Text</option>
            <option value="number">Number</option>
            <option value="dropdown">Dropdown</option>
            <option value="formula">Formula</option>
          </select>
          {columnKind === "dropdown" ? (
            <input
              name="dropdown_options"
              defaultValue={formatOptionsInput(column.options_json)}
              placeholder="Dropdown options (comma separated)"
              className="h-9 rounded-md border border-slate-300 bg-white px-2 text-xs text-slate-700"
              required
            />
          ) : null}
          {columnKind === "formula" ? (
            <FormulaAutocompleteInput
              name="formula"
              defaultValue={column.formula || ""}
              placeholder="Formula (e.g. =(C * D))"
              className="h-9 rounded-md border border-slate-300 bg-white px-2 text-xs text-slate-700"
              required
              suggestions={formulaSuggestions}
            />
          ) : null}
          <button
            type="submit"
            className="h-9 rounded-md border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-100"
          >
            Save
          </button>
        </form>
        <form action={onDeleteColumn} className="mt-2">
          <input type="hidden" name="column_id" value={column.id} />
          <button
            type="submit"
            className="h-9 w-full rounded-md border border-red-200 bg-red-50 px-3 text-xs font-semibold text-red-700 hover:bg-red-100"
          >
            Delete column
          </button>
        </form>
      </div>
    </details>
  );
}

export default function EmployeeInfoTable({
  records,
  clients,
  columns,
  valuesByRecordId,
  formulaValueByRecordIdAndColumnId,
  isAdmin,
  formulaSuggestions,
  onCreateRecord,
  onUpdateCell,
  onUpdateColumn,
  onDeleteColumn,
  onMoveColumn,
}: {
  records: EmployeeInfoRecordRow[];
  clients: ClientRow[];
  columns: EmployeeInfoColumnRow[];
  valuesByRecordId: Record<string, Record<string, EmployeeInfoValueRow>>;
  formulaValueByRecordIdAndColumnId: Record<string, Record<string, string>>;
  isAdmin: boolean;
  formulaSuggestions: FormulaSuggestion[];
  onCreateRecord: (formData: FormData) => Promise<void> | void;
  onUpdateCell: (formData: FormData) => Promise<unknown> | void;
  onUpdateColumn: (formData: FormData) => Promise<void> | void;
  onDeleteColumn: (formData: FormData) => Promise<void> | void;
  onMoveColumn: (formData: FormData) => Promise<void> | void;
}) {
  const [, startTransition] = useTransition();
  const createRecordFormId = "employee-info-create-record-form";
  const [isAddingRow, setIsAddingRow] = useState(false);
  const [newFullName, setNewFullName] = useState("");
  const [newClientId, setNewClientId] = useState("");

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
            <th className="sticky left-0 top-0 z-40 border-r border-slate-200 bg-slate-50 px-4 py-3">
              <div className="flex items-center justify-between gap-2">
                <span>Full Name</span>
                <button
                  type="button"
                  aria-label="Add employee row"
                  title="Add employee row"
                  onClick={() => setIsAddingRow(true)}
                  className="inline-flex h-6 w-6 items-center justify-center rounded border border-slate-300 bg-white text-sm font-semibold text-slate-700 hover:bg-slate-100"
                >
                  +
                </button>
              </div>
            </th>
            <th className="sticky top-0 z-30 bg-slate-50 px-4 py-3">Client</th>
            {columns.map((column, index) => (
              <th key={column.id} className="sticky top-0 z-30 bg-slate-50 px-4 py-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex flex-col gap-0.5">
                    <span>{column.label}</span>
                  </div>
                  {isAdmin ? (
                    <ColumnEditPanel
                      column={column}
                      columnIndex={index}
                      totalColumns={columns.length}
                      formulaSuggestions={formulaSuggestions}
                      onUpdateColumn={onUpdateColumn}
                      onDeleteColumn={onDeleteColumn}
                      onMoveColumn={onMoveColumn}
                    />
                  ) : null}
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-200 bg-white">
          {isAddingRow ? (
            <tr className="bg-slate-50/80">
              <td className="sticky left-0 z-20 border-r border-slate-200 bg-slate-50/80 px-4 py-3">
                <form id={createRecordFormId} action={onCreateRecord} />
                <div className="flex items-center gap-2">
                  <input
                    form={createRecordFormId}
                    name="full_name"
                    value={newFullName}
                    placeholder="Add employee full name"
                    aria-label="Add employee full name"
                    className="w-full min-w-[14rem] rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-700"
                    onChange={(event) => setNewFullName(event.currentTarget.value)}
                    autoFocus
                    required
                  />
                  <button
                    type="submit"
                    form={createRecordFormId}
                    disabled={!newFullName.trim()}
                    className="h-9 rounded-md border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Save
                  </button>
                  <button
                    type="button"
                    className="h-9 rounded-md border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                    onClick={() => {
                      setIsAddingRow(false);
                      setNewFullName("");
                      setNewClientId("");
                    }}
                  >
                    Cancel
                  </button>
                </div>
              </td>
              <td className="px-4 py-3">
                <select
                  form={createRecordFormId}
                  name="client_id"
                  value={newClientId}
                  aria-label="New employee client"
                  className="w-full min-w-[12rem] rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-700"
                  onChange={(event) => setNewClientId(event.currentTarget.value)}
                >
                  <option value="">Client (N/A)</option>
                  {clients.map((client) => (
                    <option key={client.id} value={client.id}>
                      {client.name}
                    </option>
                  ))}
                </select>
              </td>
              {columns.map((column) => (
                <td key={`new-record-${column.id}`} className="px-4 py-3 text-xs text-slate-400">
                  {column.column_kind === "formula" ? "auto" : "-"}
                </td>
              ))}
            </tr>
          ) : null}

          {records.length ? (
            records.map((record) => {
              const valuesByColumnId = valuesByRecordId[record.id] || {};
              const formulasByColumnId = formulaValueByRecordIdAndColumnId[record.id] || {};
              return (
                <tr key={record.id}>
                  <td className="sticky left-0 z-10 border-r border-slate-200 bg-white px-4 py-3">
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

                    if (column.column_kind === "number") {
                      return (
                        <td key={column.id} className="px-4 py-3">
                          <form>
                            <input type="hidden" name="record_id" value={record.id} />
                            <input type="hidden" name="column_id" value={column.id} />
                            <input type="hidden" name="column_kind" value={column.column_kind} />
                            <input
                              type="number"
                              step="any"
                              inputMode="decimal"
                              name="value"
                              defaultValue={valueRow?.text_value || ""}
                              aria-label={column.label}
                              className="w-full min-w-[12rem] rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-700"
                              onChange={submitChange}
                            />
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
