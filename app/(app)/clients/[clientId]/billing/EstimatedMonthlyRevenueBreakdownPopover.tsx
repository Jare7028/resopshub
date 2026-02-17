"use client";

import { useEffect, useMemo, useState } from "react";
import { formatEmployeeInfoCurrencyAmount, type EmployeeInfoCurrencyCode } from "@/lib/employeeInfo";

type RevenueChargeBreakdownRow = {
  id: string;
  label: string;
  mode: "per_user" | "monthly";
  amount: number;
  quantity: number;
  totalAmount: number;
};

function formatHours(hours: number) {
  return `${hours.toFixed(2).replace(/\.?0+$/, "")}h`;
}

export default function EstimatedMonthlyRevenueBreakdownPopover({
  currencyCode,
  hourlyRate,
  totalBillableHours,
  baseRevenue,
  employeeCount,
  rows,
  totalAmount,
}: {
  currencyCode: EmployeeInfoCurrencyCode;
  hourlyRate: number;
  totalBillableHours: number;
  baseRevenue: number;
  employeeCount: number;
  rows: RevenueChargeBreakdownRow[];
  totalAmount: number;
}) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const summary = useMemo(() => {
    const perUserCount = rows.filter((row) => row.mode === "per_user").length;
    const monthlyCount = rows.length - perUserCount;
    if (!rows.length) {
      return "Base hourly revenue only; no custom charges applied.";
    }
    return `${rows.length} custom charge${rows.length === 1 ? "" : "s"} (${perUserCount} per-user, ${monthlyCount} monthly).`;
  }, [rows]);

  const customChargeTotal = rows.reduce((sum, row) => sum + row.totalAmount, 0);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-md border border-slate-300 bg-white px-2 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-100"
      >
        Estimated monthly revenue
      </button>

      {open ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button
            type="button"
            aria-label="Close revenue breakdown"
            className="absolute inset-0 bg-slate-900/45"
            onClick={() => setOpen(false)}
          />
          <section className="relative z-10 w-full max-w-4xl rounded-xl border border-slate-200 bg-white shadow-2xl">
            <header className="flex items-start justify-between gap-3 border-b border-slate-200 px-5 py-4">
              <div className="space-y-1">
                <h3 className="text-lg font-semibold text-slate-900">
                  Estimated Monthly Revenue Breakdown
                </h3>
                <p className="text-sm text-slate-600">{summary}</p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100"
              >
                Close
              </button>
            </header>

            <div className="space-y-4 px-5 py-4">
              <div className="grid gap-2 sm:grid-cols-3">
                <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    Base revenue
                  </p>
                  <p className="mt-1 text-base font-semibold text-slate-900">
                    {formatEmployeeInfoCurrencyAmount(baseRevenue, currencyCode)}
                  </p>
                  <p className="mt-0.5 text-xs text-slate-600">
                    {formatEmployeeInfoCurrencyAmount(hourlyRate, currencyCode)} x{" "}
                    {formatHours(totalBillableHours)}
                  </p>
                </div>
                <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    Custom charges
                  </p>
                  <p className="mt-1 text-base font-semibold text-slate-900">
                    {formatEmployeeInfoCurrencyAmount(customChargeTotal, currencyCode)}
                  </p>
                  <p className="mt-0.5 text-xs text-slate-600">
                    {rows.length} line item{rows.length === 1 ? "" : "s"}
                  </p>
                </div>
                <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    Per-user quantity
                  </p>
                  <p className="mt-1 text-base font-semibold text-slate-900">{employeeCount}</p>
                  <p className="mt-0.5 text-xs text-slate-600">Assigned employees</p>
                </div>
              </div>

              <div className="overflow-x-auto rounded-md border border-slate-200">
                <table className="min-w-full text-left text-sm">
                  <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="px-3 py-2">Line item</th>
                      <th className="px-3 py-2">Apply as</th>
                      <th className="px-3 py-2 text-right">Rate</th>
                      <th className="px-3 py-2 text-right">Qty</th>
                      <th className="px-3 py-2 text-right">Monthly contribution</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 bg-white">
                    <tr>
                      <td className="px-3 py-2 text-slate-800">Billable hours</td>
                      <td className="px-3 py-2 text-slate-700">Hourly</td>
                      <td className="px-3 py-2 text-right text-slate-700">
                        {formatEmployeeInfoCurrencyAmount(hourlyRate, currencyCode)}
                      </td>
                      <td className="px-3 py-2 text-right text-slate-700">{formatHours(totalBillableHours)}</td>
                      <td className="px-3 py-2 text-right font-semibold text-slate-900">
                        {formatEmployeeInfoCurrencyAmount(baseRevenue, currencyCode)}
                      </td>
                    </tr>
                    {rows.map((row) => (
                      <tr key={row.id}>
                        <td className="px-3 py-2 text-slate-800">{row.label}</td>
                        <td className="px-3 py-2 text-slate-700">
                          {row.mode === "per_user" ? "Per user" : "Fixed monthly"}
                        </td>
                        <td className="px-3 py-2 text-right text-slate-700">
                          {formatEmployeeInfoCurrencyAmount(row.amount, currencyCode)}
                        </td>
                        <td className="px-3 py-2 text-right text-slate-700">
                          {row.mode === "per_user" ? row.quantity : 1}
                        </td>
                        <td className="px-3 py-2 text-right font-semibold text-slate-900">
                          {formatEmployeeInfoCurrencyAmount(row.totalAmount, currencyCode)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="border-t border-slate-200 bg-slate-50">
                    <tr>
                      <td
                        colSpan={4}
                        className="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-600"
                      >
                        Total estimated monthly revenue
                      </td>
                      <td className="px-3 py-2 text-right text-sm font-semibold text-slate-900">
                        {formatEmployeeInfoCurrencyAmount(totalAmount, currencyCode)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}
