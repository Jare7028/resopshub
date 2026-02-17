"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
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
  const [, startTransition] = useTransition();

  const normalizedValue = useMemo(
    () => normalizeEmployeeInfoDisplayCurrencyCode(value),
    [value]
  );
  const [localValue, setLocalValue] = useState<EmployeeInfoDisplayCurrencyCode>(
    normalizedValue
  );

  useEffect(() => {
    setLocalValue(normalizedValue);
  }, [normalizedValue]);

  const handleValueChange = (nextValue: string) => {
    const normalized = normalizeEmployeeInfoDisplayCurrencyCode(nextValue);
    setLocalValue(normalized);
    const rawQuery =
      typeof window !== "undefined" ? window.location.search.slice(1) : searchParams.toString();
    const params = new URLSearchParams(rawQuery);

    if (normalized === "ORIGINAL") {
      params.delete("display_currency");
    } else {
      params.set("display_currency", normalized);
    }

    params.delete("success");
    params.delete("error");
    const nextQuery = params.toString();
    const nextUrl = nextQuery ? `${pathname}?${nextQuery}` : pathname;
    startTransition(() => {
      router.replace(nextUrl, { scroll: false });
      router.refresh();
    });
  };

  return (
    <label className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-600">
      <span>Currency</span>
      <select
        value={localValue}
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
