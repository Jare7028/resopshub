"use client";

import { useEffect, useMemo, useState } from "react";
import { formatEmployeeInfoCurrencyAmount, type EmployeeInfoCurrencyCode } from "@/lib/employeeInfo";

type EmployeeMonthlyCostBreakdownRow = {
  roleLabel: string;
  employeeCount: number;
  contributingRowCount: number;
  totalAmount: number;
};

type EmployeeMonthlyCostCustomBreakdownRow = {
  id: string;
  label: string;
  mode: "per_user" | "monthly";
  amount: number;
  quantity: number;
  totalAmount: number;
};

function formatRoleLabel(label: string, count: number) {
  const normalized = String(label || "").trim();
  if (!normalized) return count === 1 ? "employee" : "employees";
  if (count === 1) return normalized;
  if (/[sxz]$/i.test(normalized) || /ch$/i.test(normalized) || /sh$/i.test(normalized)) {
    return `${normalized}es`;
  }
  if (/y$/i.test(normalized) && !/[aeiou]y$/i.test(normalized)) {
    return `${normalized.slice(0, -1)}ies`;
  }
  if (/s$/i.test(normalized)) return normalized;
  return `${normalized}s`;
}

export default function EmployeeMonthlyCostBreakdownPopover({
  currencyCode,
  rows,
  customRows,
  clientRowCount,
  contributingRowCount,
  roleColumnLabel,
}: {
  currencyCode: EmployeeInfoCurrencyCode;
  rows: EmployeeMonthlyCostBreakdownRow[];
  customRows: EmployeeMonthlyCostCustomBreakdownRow[];
  clientRowCount: number;
  contributingRowCount: number;
  roleColumnLabel: string | null;
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

  const roleMixSummary = useMemo(() => {
    if (!rows.length) {
      return clientRowCount
        ? `${clientRowCount} assigned ${formatRoleLabel("employee", clientRowCount)}`
        : "No assigned employees yet";
    }
    return rows
      .map((row) => `${row.employeeCount} ${formatRoleLabel(row.roleLabel, row.employeeCount)}`)
      .join(", ");
  }, [clientRowCount, rows]);

  const roleRowsTotal = rows.reduce((sum, row) => sum + row.totalAmount, 0);
  const roleRowsContributingCount = rows.reduce((sum, row) => sum + row.contributingRowCount, 0);
  const roleAveragePerEmployee = clientRowCount > 0 ? roleRowsTotal / clientRowCount : 0;
  const customMonthlyTotal = customRows.reduce((sum, row) => sum + row.totalAmount, 0);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-md border border-slate-300 bg-white px-2 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-100"
      >
        Employee monthly costs
      </button>

      {open ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button
            type="button"
            aria-label="Close employee cost breakdown"
            className="absolute inset-0 bg-slate-900/45"
            onClick={() => setOpen(false)}
          />
          <section className="relative z-10 w-full max-w-4xl rounded-xl border border-slate-200 bg-white shadow-2xl">
            <header className="flex items-start justify-between gap-3 border-b border-slate-200 px-5 py-4">
              <div className="space-y-1">
                <h3 className="text-lg font-semibold text-slate-900">
                  Employee Monthly Cost Breakdown
                </h3>
                <p className="text-sm text-slate-600">{roleMixSummary}</p>
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
                    Assigned employees
                  </p>
                  <p className="mt-1 text-base font-semibold text-slate-900">{clientRowCount}</p>
                </div>
                <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    Cost entries
                  </p>
                  <p className="mt-1 text-base font-semibold text-slate-900">{contributingRowCount}</p>
                </div>
                <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    Breakdown by
                  </p>
                  <p className="mt-1 text-base font-semibold text-slate-900">
                    {roleColumnLabel || "Role/position"}
                  </p>
                </div>
              </div>

              {rows.length ? (
                <div className="overflow-x-auto rounded-md border border-slate-200">
                  <table className="min-w-full text-left text-sm">
                    <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                      <tr>
                        <th className="px-3 py-2">{roleColumnLabel || "Role"}</th>
                        <th className="px-3 py-2 text-right">Headcount</th>
                        <th className="px-3 py-2 text-right">Cost entries</th>
                        <th className="px-3 py-2 text-right">Monthly total</th>
                        <th className="px-3 py-2 text-right">Avg / employee</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 bg-white">
                      {rows.map((row) => {
                        const average = row.employeeCount > 0 ? row.totalAmount / row.employeeCount : 0;
                        return (
                          <tr key={row.roleLabel}>
                            <td className="px-3 py-2 text-slate-800">{row.roleLabel}</td>
                            <td className="px-3 py-2 text-right text-slate-700">{row.employeeCount}</td>
                            <td className="px-3 py-2 text-right text-slate-700">
                              {row.contributingRowCount}
                            </td>
                            <td className="px-3 py-2 text-right font-semibold text-slate-900">
                              {formatEmployeeInfoCurrencyAmount(row.totalAmount, currencyCode)}
                            </td>
                            <td className="px-3 py-2 text-right text-slate-700">
                              {formatEmployeeInfoCurrencyAmount(average, currencyCode)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot className="border-t border-slate-200 bg-slate-50">
                      <tr>
                        <td className="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-600">
                          Total
                        </td>
                        <td className="px-3 py-2 text-right text-sm font-semibold text-slate-900">
                          {clientRowCount}
                        </td>
                        <td className="px-3 py-2 text-right text-sm font-semibold text-slate-900">
                          {roleRowsContributingCount}
                        </td>
                        <td className="px-3 py-2 text-right text-sm font-semibold text-slate-900">
                          {formatEmployeeInfoCurrencyAmount(roleRowsTotal, currencyCode)}
                        </td>
                        <td className="px-3 py-2 text-right text-sm font-semibold text-slate-900">
                          {formatEmployeeInfoCurrencyAmount(roleAveragePerEmployee, currencyCode)}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              ) : (
                <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
                  No role/position values found yet for this client.
                </p>
              )}

              {customRows.length ? (
                <div className="overflow-x-auto rounded-md border border-slate-200">
                  <table className="min-w-full text-left text-sm">
                    <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                      <tr>
                        <th className="px-3 py-2">Custom cost item</th>
                        <th className="px-3 py-2">Apply as</th>
                        <th className="px-3 py-2 text-right">Rate</th>
                        <th className="px-3 py-2 text-right">Qty</th>
                        <th className="px-3 py-2 text-right">Monthly total</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 bg-white">
                      {customRows.map((row) => (
                        <tr key={row.id}>
                          <td className="px-3 py-2 text-slate-800">{row.label}</td>
                          <td className="px-3 py-2 text-slate-700">
                            {row.mode === "per_user" ? "Per user" : "Fixed monthly"}
                          </td>
                          <td className="px-3 py-2 text-right text-slate-700">
                            {formatEmployeeInfoCurrencyAmount(row.amount, currencyCode)}
                          </td>
                          <td className="px-3 py-2 text-right text-slate-700">{row.quantity}</td>
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
                          Custom costs total
                        </td>
                        <td className="px-3 py-2 text-right text-sm font-semibold text-slate-900">
                          {formatEmployeeInfoCurrencyAmount(customMonthlyTotal, currencyCode)}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              ) : null}
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}
