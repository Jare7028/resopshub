"use client";

import { useMemo } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  EMPLOYEE_INFO_DISPLAY_CURRENCY_CODES,
  normalizeEmployeeInfoDisplayCurrencyCode,
  type EmployeeInfoDisplayCurrencyCode,
} from "@/lib/employeeInfo";

const displayCurrencyLabelByCode: Record<EmployeeInfoDisplayCurrencyCode, string> = {
  ORIGINAL: "Original",
  USD: "USD ($)",
  GBP: "GBP (\u00A3)",
  MUR: "MUR (Rs)",
};

export default function CurrencyDisplaySelect({
  value,
}: {
  value: EmployeeInfoDisplayCurrencyCode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const normalizedValue = useMemo(
    () => normalizeEmployeeInfoDisplayCurrencyCode(value),
    [value]
  );

  const handleValueChange = (nextValue: string) => {
    const normalized = normalizeEmployeeInfoDisplayCurrencyCode(nextValue);
    const params = new URLSearchParams(searchParams.toString());

    if (normalized === "ORIGINAL") {
      params.delete("display_currency");
    } else {
      params.set("display_currency", normalized);
    }

    params.delete("success");
    const nextQuery = params.toString();
    router.replace(nextQuery ? `${pathname}?${nextQuery}` : pathname, { scroll: false });
  };

  return (
    <label className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-600">
      <span>Currency</span>
      <select
        value={normalizedValue}
        onChange={(event) => handleValueChange(event.currentTarget.value)}
        className="h-9 rounded-md border border-slate-300 bg-white px-2 text-xs font-semibold text-slate-700"
      >
        {EMPLOYEE_INFO_DISPLAY_CURRENCY_CODES.map((code) => (
          <option key={code} value={code}>
            {displayCurrencyLabelByCode[code]}
          </option>
        ))}
      </select>
    </label>
  );
}
