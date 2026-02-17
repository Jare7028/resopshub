"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { formatEmployeeInfoCurrencyAmount, type EmployeeInfoCurrencyCode } from "@/lib/employeeInfo";

type BillingMonthlyCostSourceKind = "employee_column" | "custom";
type BillingMonthlyCostCustomMode = "per_user" | "monthly";

type BillingMonthlyCostItemInput = {
  id: string;
  source: BillingMonthlyCostSourceKind;
  column_id: string | null;
  label: string;
  amount: number | string;
  mode: BillingMonthlyCostCustomMode;
};

type BillingMonthlyCostColumnOption = {
  id: string;
  label: string;
  column_kind: "text" | "dropdown" | "formula" | "number" | "currency";
};

type BillingMonthlyCostRow = {
  rowKey: string;
  persistedId: string;
  source: BillingMonthlyCostSourceKind;
  columnId: string;
  label: string;
  amount: string;
  mode: BillingMonthlyCostCustomMode;
};

type BillingMonthlyCostRowPatch = Partial<
  Pick<BillingMonthlyCostRow, "persistedId" | "source" | "columnId" | "label" | "amount" | "mode">
>;

function toSafeString(value: unknown) {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return "";
  try {
    return String(value);
  } catch {
    return "";
  }
}

function normalizeAmount(value: unknown) {
  const normalized = toSafeString(value).trim().replace(/,/g, "");
  if (!normalized) return "";
  const numeric = Number(normalized);
  return Number.isFinite(numeric) && numeric >= 0 ? normalized : "";
}

function normalizeMode(value: unknown): BillingMonthlyCostCustomMode {
  return toSafeString(value).trim().toLowerCase() === "per_user" ? "per_user" : "monthly";
}

function normalizeSource(value: unknown): BillingMonthlyCostSourceKind {
  return toSafeString(value).trim().toLowerCase() === "custom" ? "custom" : "employee_column";
}

function toMonthlyAmount(amountText: string, mode: BillingMonthlyCostCustomMode, employeeCount: number) {
  const numeric = Number(toSafeString(amountText).trim().replace(/,/g, ""));
  if (!Number.isFinite(numeric) || numeric < 0) return 0;
  return mode === "per_user" ? numeric * employeeCount : numeric;
}

function toUniqueId(baseValue: unknown, usedIds: Set<string>, fallbackPrefix: string) {
  const base = toSafeString(baseValue).trim() || fallbackPrefix;
  let candidate = base;
  let suffix = 2;
  while (usedIds.has(candidate)) {
    candidate = `${base}_${suffix}`;
    suffix += 1;
  }
  usedIds.add(candidate);
  return candidate;
}

function buildInitialRows(
  initialItems: BillingMonthlyCostItemInput[],
  employeeColumns: BillingMonthlyCostColumnOption[]
) {
  const firstColumnId = employeeColumns[0]?.id || "";
  const usedPersistedIds = new Set<string>();
  const usedRowKeys = new Set<string>();

  return initialItems.map((item, index) => ({
    rowKey: toUniqueId(`cost_source_row_${index + 1}`, usedRowKeys, "cost_source_row"),
    persistedId: toUniqueId(item.id || `cost_source_${index + 1}`, usedPersistedIds, "cost_source"),
    source: normalizeSource(item.source),
    columnId: toSafeString(item.column_id || firstColumnId),
    label: toSafeString(item.label),
    amount: normalizeAmount(item.amount),
    mode: normalizeMode(item.mode),
  }));
}

export default function MonthlyCostSourcesEditor({
  name,
  initialItems,
  employeeColumns,
  currencyCode,
  employeeCount,
  disabled,
}: {
  name: string;
  initialItems: BillingMonthlyCostItemInput[];
  employeeColumns: BillingMonthlyCostColumnOption[];
  currencyCode: EmployeeInfoCurrencyCode;
  employeeCount: number;
  disabled: boolean;
}) {
  const seededRows = useMemo(
    () => buildInitialRows(initialItems, employeeColumns),
    [employeeColumns, initialItems]
  );
  const [rows, setRows] = useState<BillingMonthlyCostRow[]>(seededRows);
  const [runtimeError, setRuntimeError] = useState("");
  const nextRowSeedRef = useRef(seededRows.length + 1);
  const nextPersistedSeedRef = useRef(seededRows.length + 1);
  const safeEmployeeCount = Number.isFinite(employeeCount) && employeeCount > 0 ? employeeCount : 0;
  const hasEmployeeColumns = employeeColumns.length > 0;

  useEffect(() => {
    setRows(seededRows);
    nextRowSeedRef.current = seededRows.length + 1;
    nextPersistedSeedRef.current = seededRows.length + 1;
    setRuntimeError("");
  }, [seededRows]);

  const serialized = useMemo(() => {
    try {
      return JSON.stringify(
        rows.map((row) => {
          const source = normalizeSource(row.source);
          if (source === "employee_column") {
            return {
              id: toSafeString(row.persistedId),
              source,
              column_id: toSafeString(row.columnId),
              label: "",
              amount: "0",
              mode: "monthly",
            };
          }
          return {
            id: toSafeString(row.persistedId),
            source: "custom",
            column_id: null,
            label: toSafeString(row.label),
            amount: normalizeAmount(row.amount),
            mode: normalizeMode(row.mode),
          };
        })
      );
    } catch {
      return "[]";
    }
  }, [rows]);

  const runSafely = useCallback(
    (action: () => void) => {
      try {
        action();
        if (runtimeError) setRuntimeError("");
      } catch (error) {
        console.error("[billing.monthly_cost_sources_editor]", error);
        setRuntimeError("Something went wrong while editing cost sources. Please refresh and try again.");
      }
    },
    [runtimeError]
  );

  const updateRow = useCallback(
    (rowKey: string, patch: BillingMonthlyCostRowPatch) => {
      runSafely(() => {
        setRows((previous) =>
          previous.map((row) => {
            if (row.rowKey !== rowKey) return row;

            const nextPersistedId =
              patch.persistedId === undefined ? row.persistedId : patch.persistedId;
            const nextSource = patch.source === undefined ? row.source : patch.source;
            const nextColumnId = patch.columnId === undefined ? row.columnId : patch.columnId;
            const nextLabel = patch.label === undefined ? row.label : patch.label;
            const nextAmount = patch.amount === undefined ? row.amount : patch.amount;
            const nextMode = patch.mode === undefined ? row.mode : patch.mode;

            const normalizedSource = normalizeSource(nextSource);
            const fallbackColumnId = employeeColumns[0]?.id || "";

            return {
              rowKey: row.rowKey,
              persistedId: toSafeString(nextPersistedId || row.persistedId),
              source: normalizedSource,
              columnId:
                normalizedSource === "employee_column"
                  ? toSafeString(nextColumnId || fallbackColumnId)
                  : "",
              label: normalizedSource === "custom" ? toSafeString(nextLabel) : "",
              amount: normalizedSource === "custom" ? normalizeAmount(nextAmount) : "0",
              mode: normalizeMode(nextMode),
            };
          })
        );
      });
    },
    [employeeColumns, runSafely]
  );

  const addRow = useCallback(() => {
    runSafely(() => {
      setRows((previous) => {
        const usedRowKeys = new Set(previous.map((row) => row.rowKey));
        const usedPersistedIds = new Set(previous.map((row) => row.persistedId));

        let rowSeed = nextRowSeedRef.current;
        let rowKey = `cost_source_row_${rowSeed}`;
        while (usedRowKeys.has(rowKey)) {
          rowSeed += 1;
          rowKey = `cost_source_row_${rowSeed}`;
        }
        nextRowSeedRef.current = rowSeed + 1;

        let persistedSeed = nextPersistedSeedRef.current;
        let persistedId = `cost_source_${persistedSeed}`;
        while (usedPersistedIds.has(persistedId)) {
          persistedSeed += 1;
          persistedId = `cost_source_${persistedSeed}`;
        }
        nextPersistedSeedRef.current = persistedSeed + 1;

        const source: BillingMonthlyCostSourceKind = hasEmployeeColumns ? "employee_column" : "custom";

        return [
          ...previous,
          {
            rowKey,
            persistedId,
            source,
            columnId: hasEmployeeColumns ? employeeColumns[0]?.id || "" : "",
            label: "",
            amount: source === "custom" ? "" : "0",
            mode: "monthly",
          },
        ];
      });
    });
  }, [employeeColumns, hasEmployeeColumns, runSafely]);

  const removeRow = useCallback(
    (rowKey: string) => {
      runSafely(() => {
        setRows((previous) => previous.filter((row) => row.rowKey !== rowKey));
      });
    },
    [runSafely]
  );

  return (
    <div className="rounded-md border border-slate-200 p-4">
      <input type="hidden" name={name} value={serialized} />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-slate-800">Monthly cost sources</h3>
          <p className="text-xs text-slate-500">
            Build monthly costs from Employee Info columns and extra custom monthly/per-user cost
            lines.
          </p>
        </div>
        <button
          type="button"
          onClick={addRow}
          disabled={disabled}
          className="rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
        >
          Add source
        </button>
      </div>

      {!hasEmployeeColumns ? (
        <p className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          Employee Info columns were not found, so only custom cost lines are available.
        </p>
      ) : null}

      {runtimeError ? (
        <p className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {runtimeError}
        </p>
      ) : null}

      {rows.length === 0 ? (
        <p className="mt-3 text-xs text-slate-500">No monthly cost sources configured yet.</p>
      ) : (
        <div className="mt-4 space-y-3">
          {rows.map((row, index) => {
            const monthlyAmount = toMonthlyAmount(row.amount, row.mode, safeEmployeeCount);
            let monthlyAmountText = "";
            try {
              monthlyAmountText = formatEmployeeInfoCurrencyAmount(monthlyAmount, currencyCode);
            } catch {
              monthlyAmountText = "";
            }

            return (
              <div key={row.rowKey} className="rounded-md border border-slate-200 p-3">
                <div className="grid gap-3 md:grid-cols-[1fr_2fr_1fr_1fr_auto]">
                  <div className="space-y-1">
                    <label
                      className="text-xs font-medium uppercase tracking-wide text-slate-500"
                      htmlFor={`cost_source_type_${row.rowKey}`}
                    >
                      Source
                    </label>
                    <select
                      id={`cost_source_type_${row.rowKey}`}
                      value={row.source}
                      disabled={disabled}
                      onChange={(event) => {
                        const nextSourceValue = event.currentTarget?.value;
                        if (typeof nextSourceValue !== "string") return;
                        const nextSource =
                          nextSourceValue === "custom" ? "custom" : "employee_column";
                        updateRow(row.rowKey, {
                          source: nextSource,
                          columnId:
                            nextSource === "employee_column" ? employeeColumns[0]?.id || "" : "",
                          label: "",
                          amount: nextSource === "custom" ? row.amount : "0",
                          mode: row.mode,
                        });
                      }}
                      className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                    >
                      <option value="employee_column" disabled={!hasEmployeeColumns}>
                        Employee Info column
                      </option>
                      <option value="custom">Custom amount</option>
                    </select>
                  </div>

                  {row.source === "employee_column" ? (
                    <div className="space-y-1 md:col-span-3">
                      <label
                        className="text-xs font-medium uppercase tracking-wide text-slate-500"
                        htmlFor={`cost_source_column_${row.rowKey}`}
                      >
                        Employee Info column
                      </label>
                      <select
                        id={`cost_source_column_${row.rowKey}`}
                        value={row.columnId}
                        disabled={disabled || !hasEmployeeColumns}
                        onChange={(event) => {
                          const nextColumnId = event.currentTarget?.value;
                          if (typeof nextColumnId !== "string") return;
                          updateRow(row.rowKey, { columnId: nextColumnId });
                        }}
                        className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                      >
                        {employeeColumns.map((column) => (
                          <option key={column.id} value={column.id}>
                            {column.label} ({column.column_kind})
                          </option>
                        ))}
                      </select>
                    </div>
                  ) : (
                    <>
                      <div className="space-y-1">
                        <label
                          className="text-xs font-medium uppercase tracking-wide text-slate-500"
                          htmlFor={`cost_source_label_${row.rowKey}`}
                        >
                          Label
                        </label>
                        <input
                          id={`cost_source_label_${row.rowKey}`}
                          type="text"
                          value={row.label}
                          disabled={disabled}
                          onChange={(event) => {
                            const nextLabel = event.currentTarget?.value;
                            if (typeof nextLabel !== "string") return;
                            updateRow(row.rowKey, { label: nextLabel });
                          }}
                          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                          placeholder={`Custom cost ${index + 1}`}
                        />
                      </div>

                      <div className="space-y-1">
                        <label
                          className="text-xs font-medium uppercase tracking-wide text-slate-500"
                          htmlFor={`cost_source_amount_${row.rowKey}`}
                        >
                          Amount
                        </label>
                        <input
                          id={`cost_source_amount_${row.rowKey}`}
                          type="text"
                          inputMode="decimal"
                          value={row.amount}
                          disabled={disabled}
                          onChange={(event) => {
                            const nextAmount = event.currentTarget?.value;
                            if (typeof nextAmount !== "string") return;
                            updateRow(row.rowKey, { amount: nextAmount.replace(/,/g, "") });
                          }}
                          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                          placeholder="0.00"
                        />
                      </div>

                      <div className="space-y-1">
                        <label
                          className="text-xs font-medium uppercase tracking-wide text-slate-500"
                          htmlFor={`cost_source_mode_${row.rowKey}`}
                        >
                          Apply as
                        </label>
                        <select
                          id={`cost_source_mode_${row.rowKey}`}
                          value={row.mode}
                          disabled={disabled}
                          onChange={(event) => {
                            const nextModeValue = event.currentTarget?.value;
                            if (typeof nextModeValue !== "string") return;
                            updateRow(row.rowKey, {
                              mode: nextModeValue === "per_user" ? "per_user" : "monthly",
                            });
                          }}
                          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                        >
                          <option value="monthly">Set monthly cost</option>
                          <option value="per_user">Per user</option>
                        </select>
                      </div>
                    </>
                  )}

                  <div className="flex items-end">
                    <button
                      type="button"
                      onClick={() => removeRow(row.rowKey)}
                      disabled={disabled}
                      className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700 hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      Remove
                    </button>
                  </div>
                </div>

                {row.source === "custom" ? (
                  <p className="mt-2 text-xs text-slate-500">
                    Monthly contribution: {monthlyAmountText}
                    {row.mode === "per_user" ? ` (${safeEmployeeCount} users)` : ""}
                  </p>
                ) : (
                  <p className="mt-2 text-xs text-slate-500">
                    Uses this column value per assigned employee row (formula and currency fields are
                    converted automatically).
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
