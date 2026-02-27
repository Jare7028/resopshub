"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import type { DashboardFiltersState } from "./types";
import {
  buildDashboardQuery,
  normalizeDashboardCurrency,
  writeDashboardFiltersCookie,
} from "./filterState";

export default function DashboardCurrencySelect({
  filters,
  focus,
  view,
}: {
  filters: DashboardFiltersState;
  focus: string | null;
  view?: string | null;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();

  return (
    <label className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
      Currency
      <select
        value={filters.currency}
        className="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm font-medium text-slate-700"
        onChange={(event) => {
          const nextCurrency = normalizeDashboardCurrency(event.target.value);
          const next = { ...filters, currency: nextCurrency };
          writeDashboardFiltersCookie(next);
          const query = buildDashboardQuery(next);
          const params = new URLSearchParams(query);
          if (view && view !== "overview") {
            params.set("view", view);
          }
          if (focus) {
            params.set("focus", focus);
          }
          const finalQuery = params.toString();
          startTransition(() => {
            router.replace(finalQuery ? `/dashboard?${finalQuery}` : "/dashboard", {
              scroll: false,
            });
          });
        }}
      >
        <option value="GBP">GBP</option>
        <option value="USD">USD</option>
        <option value="MUR">MUR</option>
      </select>
    </label>
  );
}
