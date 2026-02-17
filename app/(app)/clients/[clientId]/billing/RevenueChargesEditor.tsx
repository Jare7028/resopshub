"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { formatEmployeeInfoCurrencyAmount, type EmployeeInfoCurrencyCode } from "@/lib/employeeInfo";

type BillingRevenueChargeMode = "per_user" | "monthly";

type BillingRevenueChargeInput = {
  id: string;
  label: string;
  amount: number | string;
  mode: BillingRevenueChargeMode;
};

type BillingRevenueChargeRow = {
  rowKey: string;
  persistedId: string;
  label: string;
  amount: string;
  mode: BillingRevenueChargeMode;
};

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

function normalizeMode(value: unknown): BillingRevenueChargeMode {
  return toSafeString(value).trim().toLowerCase() === "per_user" ? "per_user" : "monthly";
}

function toMonthlyAmount(amountText: string, mode: BillingRevenueChargeMode, employeeCount: number) {
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

function buildInitialRows(initialItems: BillingRevenueChargeInput[]) {
  const usedPersistedIds = new Set<string>();
  const usedRowKeys = new Set<string>();

  return initialItems.map((item, index) => ({
    rowKey: toUniqueId(`charge_row_${index + 1}`, usedRowKeys, "charge_row"),
    persistedId: toUniqueId(item.id || `charge_${index + 1}`, usedPersistedIds, "charge"),
    label: toSafeString(item.label),
    amount: normalizeAmount(item.amount),
    mode: normalizeMode(item.mode),
  }));
}

export default function RevenueChargesEditor({
  name,
  initialItems,
  currencyCode,
  employeeCount,
  disabled,
}: {
  name: string;
  initialItems: BillingRevenueChargeInput[];
  currencyCode: EmployeeInfoCurrencyCode;
  employeeCount: number;
  disabled: boolean;
}) {
  const seededRows = useMemo(() => buildInitialRows(initialItems), [initialItems]);
  const [rows, setRows] = useState<BillingRevenueChargeRow[]>(seededRows);
  const [runtimeError, setRuntimeError] = useState("");
  const nextRowSeedRef = useRef(seededRows.length + 1);
  const nextPersistedSeedRef = useRef(seededRows.length + 1);
  const safeEmployeeCount = Number.isFinite(employeeCount) && employeeCount > 0 ? employeeCount : 0;

  useEffect(() => {
    setRows(seededRows);
    nextRowSeedRef.current = seededRows.length + 1;
    nextPersistedSeedRef.current = seededRows.length + 1;
    setRuntimeError("");
  }, [seededRows]);

  const serialized = useMemo(() => {
    try {
      return JSON.stringify(
        rows.map((row) => ({
          id: row.persistedId,
          label: toSafeString(row.label),
          amount: normalizeAmount(row.amount),
          mode: normalizeMode(row.mode),
        }))
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
        console.error("[billing.revenue_charges_editor]", error);
        setRuntimeError("Something went wrong while editing charges. Please refresh and try again.");
      }
    },
    [runtimeError]
  );

  const updateRow = useCallback(
    (
      rowKey: string,
      updater: (row: BillingRevenueChargeRow) => BillingRevenueChargeRow
    ) => {
      runSafely(() => {
        setRows((previous) =>
          previous.map((row) => {
            if (row.rowKey !== rowKey) return row;
            const nextRow = updater(row);
            return {
              rowKey: row.rowKey,
              persistedId: toSafeString(nextRow.persistedId || row.persistedId),
              label: toSafeString(nextRow.label),
              amount: normalizeAmount(nextRow.amount),
              mode: normalizeMode(nextRow.mode),
            };
          })
        );
      });
    },
    [runSafely]
  );

  const addRow = useCallback(() => {
    runSafely(() => {
      setRows((previous) => {
        const usedRowKeys = new Set(previous.map((row) => row.rowKey));
        const usedPersistedIds = new Set(previous.map((row) => row.persistedId));

        let rowSeed = nextRowSeedRef.current;
        let rowKey = `charge_row_${rowSeed}`;
        while (usedRowKeys.has(rowKey)) {
          rowSeed += 1;
          rowKey = `charge_row_${rowSeed}`;
        }
        nextRowSeedRef.current = rowSeed + 1;

        let persistedSeed = nextPersistedSeedRef.current;
        let persistedId = `charge_${persistedSeed}`;
        while (usedPersistedIds.has(persistedId)) {
          persistedSeed += 1;
          persistedId = `charge_${persistedSeed}`;
        }
        nextPersistedSeedRef.current = persistedSeed + 1;

        return [
          ...previous,
          {
            rowKey,
            persistedId,
            label: "",
            amount: "",
            mode: "monthly",
          },
        ];
      });
    });
  }, [runSafely]);

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
          <h3 className="text-sm font-semibold text-slate-800">Additional charges</h3>
          <p className="text-xs text-slate-500">
            Add custom revenue fields, then choose whether each charge is per user or fixed monthly.
          </p>
        </div>
        <button
          type="button"
          onClick={addRow}
          disabled={disabled}
          className="rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
        >
          Add charge
        </button>
      </div>

      {runtimeError ? (
        <p className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {runtimeError}
        </p>
      ) : null}

      {rows.length === 0 ? (
        <p className="mt-3 text-xs text-slate-500">No additional charges yet.</p>
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
                <div className="grid gap-3 md:grid-cols-[2fr_1fr_1fr_auto]">
                  <div className="space-y-1">
                    <label
                      className="text-xs font-medium uppercase tracking-wide text-slate-500"
                      htmlFor={`charge_label_${row.rowKey}`}
                    >
                      Charge label
                    </label>
                    <input
                      id={`charge_label_${row.rowKey}`}
                      type="text"
                      value={row.label}
                      disabled={disabled}
                      onChange={(event) =>
                        updateRow(row.rowKey, (previous) => ({
                          ...previous,
                          label: event.currentTarget.value,
                        }))
                      }
                      className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                      placeholder={`Charge ${index + 1}`}
                    />
                  </div>

                  <div className="space-y-1">
                    <label
                      className="text-xs font-medium uppercase tracking-wide text-slate-500"
                      htmlFor={`charge_amount_${row.rowKey}`}
                    >
                      Amount
                    </label>
                    <input
                      id={`charge_amount_${row.rowKey}`}
                      type="text"
                      inputMode="decimal"
                      value={row.amount}
                      disabled={disabled}
                      onChange={(event) =>
                        updateRow(row.rowKey, (previous) => ({
                          ...previous,
                          amount: event.currentTarget.value.replace(/,/g, ""),
                        }))
                      }
                      className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                      placeholder="0.00"
                    />
                  </div>

                  <div className="space-y-1">
                    <label
                      className="text-xs font-medium uppercase tracking-wide text-slate-500"
                      htmlFor={`charge_mode_${row.rowKey}`}
                    >
                      Apply as
                    </label>
                    <select
                      id={`charge_mode_${row.rowKey}`}
                      value={row.mode}
                      disabled={disabled}
                      onChange={(event) =>
                        updateRow(row.rowKey, (previous) => ({
                          ...previous,
                          mode: event.currentTarget.value === "per_user" ? "per_user" : "monthly",
                        }))
                      }
                      className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                    >
                      <option value="per_user">Per user</option>
                      <option value="monthly">Set monthly cost</option>
                    </select>
                  </div>

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

                <p className="mt-2 text-xs text-slate-500">
                  Monthly contribution: {monthlyAmountText}
                  {row.mode === "per_user" ? ` (${safeEmployeeCount} users)` : ""}
                </p>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
