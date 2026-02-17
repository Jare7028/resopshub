"use client";

import { useMemo, useRef, useState } from "react";
import { formatEmployeeInfoCurrencyAmount, type EmployeeInfoCurrencyCode } from "@/lib/employeeInfo";

type BillingRevenueChargeMode = "per_user" | "monthly";

type BillingRevenueChargeInput = {
  id: string;
  label: string;
  amount: number | string;
  mode: BillingRevenueChargeMode;
};

type BillingRevenueChargeDraft = {
  id: string;
  label: string;
  amount: string;
  mode: BillingRevenueChargeMode;
};

function normalizeAmount(value: unknown) {
  const normalized = String(value ?? "")
    .trim()
    .replace(/,/g, "");
  if (!normalized) return "";
  const numeric = Number(normalized);
  return Number.isFinite(numeric) && numeric >= 0 ? normalized : "";
}

function toMonthlyAmount(amountText: string, mode: BillingRevenueChargeMode, employeeCount: number) {
  const numeric = Number(
    String(amountText || "")
      .trim()
      .replace(/,/g, "")
  );
  if (!Number.isFinite(numeric) || numeric < 0) return 0;
  return mode === "per_user" ? numeric * employeeCount : numeric;
}

function toUniqueChargeId(rawId: string, usedIds: Set<string>) {
  const normalizedBase = String(rawId || "").trim() || "charge";
  let candidate = normalizedBase;
  let suffix = 2;
  while (usedIds.has(candidate)) {
    candidate = `${normalizedBase}_${suffix}`;
    suffix += 1;
  }
  usedIds.add(candidate);
  return candidate;
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
  const initialDrafts = useMemo<BillingRevenueChargeDraft[]>(
    () => {
      const usedIds = new Set<string>();
      return initialItems.map((item, index) => ({
        id: toUniqueChargeId(String(item.id || `charge_${index + 1}`), usedIds),
        label: String(item.label || ""),
        amount: normalizeAmount(item.amount),
        mode: item.mode === "per_user" ? "per_user" : "monthly",
      }));
    },
    [initialItems]
  );

  const [charges, setCharges] = useState<BillingRevenueChargeDraft[]>(initialDrafts);
  const nextSeedRef = useRef(initialDrafts.length + 1);
  const safeEmployeeCount = Number.isFinite(employeeCount) && employeeCount > 0 ? employeeCount : 0;
  const serialized = useMemo(() => JSON.stringify(charges), [charges]);

  const updateCharge = (chargeId: string, updater: (charge: BillingRevenueChargeDraft) => BillingRevenueChargeDraft) => {
    setCharges((previous) =>
      previous.map((charge) => (charge.id === chargeId ? updater(charge) : charge))
    );
  };

  const addCharge = () => {
    setCharges((previous) => {
      const usedIds = new Set(previous.map((charge) => charge.id));
      let seed = nextSeedRef.current;
      let candidateId = `charge_${seed}`;
      while (usedIds.has(candidateId)) {
        seed += 1;
        candidateId = `charge_${seed}`;
      }
      nextSeedRef.current = seed + 1;
      return [
        ...previous,
        {
          id: candidateId,
          label: "",
          amount: "",
          mode: "monthly",
        },
      ];
    });
  };

  const removeCharge = (chargeId: string) => {
    setCharges((previous) => previous.filter((charge) => charge.id !== chargeId));
  };

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
          onClick={addCharge}
          disabled={disabled}
          className="rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
        >
          Add charge
        </button>
      </div>

      {charges.length === 0 ? (
        <p className="mt-3 text-xs text-slate-500">No additional charges yet.</p>
      ) : (
        <div className="mt-4 space-y-3">
          {charges.map((charge, index) => {
            const monthlyAmount = toMonthlyAmount(charge.amount, charge.mode, safeEmployeeCount);
            return (
              <div key={charge.id} className="rounded-md border border-slate-200 p-3">
                <div className="grid gap-3 md:grid-cols-[2fr_1fr_1fr_auto]">
                  <div className="space-y-1">
                    <label
                      className="text-xs font-medium uppercase tracking-wide text-slate-500"
                      htmlFor={`charge_label_${charge.id}`}
                    >
                      Charge label
                    </label>
                    <input
                      id={`charge_label_${charge.id}`}
                      type="text"
                      value={charge.label}
                      disabled={disabled}
                      onChange={(event) =>
                        updateCharge(charge.id, (previous) => ({
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
                      htmlFor={`charge_amount_${charge.id}`}
                    >
                      Amount
                    </label>
                    <input
                      id={`charge_amount_${charge.id}`}
                      type="number"
                      step="0.01"
                      min="0"
                      value={charge.amount}
                      disabled={disabled}
                      onChange={(event) =>
                        updateCharge(charge.id, (previous) => ({
                          ...previous,
                          amount: event.currentTarget.value,
                        }))
                      }
                      className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                      placeholder="0.00"
                    />
                  </div>

                  <div className="space-y-1">
                    <label
                      className="text-xs font-medium uppercase tracking-wide text-slate-500"
                      htmlFor={`charge_mode_${charge.id}`}
                    >
                      Apply as
                    </label>
                    <select
                      id={`charge_mode_${charge.id}`}
                      value={charge.mode}
                      disabled={disabled}
                      onChange={(event) =>
                        updateCharge(charge.id, (previous) => ({
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
                      onClick={() => removeCharge(charge.id)}
                      disabled={disabled}
                      className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700 hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      Remove
                    </button>
                  </div>
                </div>

                <p className="mt-2 text-xs text-slate-500">
                  Monthly contribution: {formatEmployeeInfoCurrencyAmount(monthlyAmount, currencyCode)}
                  {charge.mode === "per_user" ? ` (${safeEmployeeCount} users)` : ""}
                </p>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
