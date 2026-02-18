"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  EMPLOYEE_INFO_DISPLAY_CURRENCY_CODES,
  normalizeEmployeeInfoDisplayCurrencyCode,
  type EmployeeInfoDisplayCurrencyCode,
} from "@/lib/employeeInfo";
import { EMPLOYEE_INFO_DISPLAY_CURRENCY_SWITCH_INTENT } from "./events";

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

  const serverValue = useMemo(
    () => normalizeEmployeeInfoDisplayCurrencyCode(value),
    [value]
  );
  const urlValue = useMemo(
    () => normalizeEmployeeInfoDisplayCurrencyCode(searchParams.get("display_currency") || serverValue),
    [searchParams, serverValue]
  );
  const [localValue, setLocalValue] = useState<EmployeeInfoDisplayCurrencyCode>(urlValue);

  useEffect(() => {
    setLocalValue(urlValue);
  }, [urlValue]);

  const handleValueChange = (nextValue: string) => {
    const normalized = normalizeEmployeeInfoDisplayCurrencyCode(nextValue);
    setLocalValue(normalized);
    const params = new URLSearchParams(searchParams.toString());

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
    });
  };

  return (
    <label className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-600">
      <span>Currency</span>
      <select
        data-employee-info-currency-selector="true"
        value={localValue}
        onChange={(event) => handleValueChange(event.currentTarget.value)}
        onPointerDownCapture={() => {
          if (typeof window === "undefined") return;
          window.dispatchEvent(new Event(EMPLOYEE_INFO_DISPLAY_CURRENCY_SWITCH_INTENT));
        }}
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
