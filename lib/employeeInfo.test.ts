import { describe, expect, it } from "vitest";
import {
  buildEmployeeInfoExchangeRateMap,
  convertEmployeeInfoCurrencyAmount,
  formatEmployeeInfoCurrencyAmount,
  getEmployeeInfoCurrencySymbol,
  normalizeEmployeeInfoColumnKind,
  normalizeEmployeeInfoCurrencyCode,
  normalizeEmployeeInfoDisplayCurrencyCode,
  normalizeEmployeeInfoFormulaCurrencyMode,
  parseEmployeeInfoCurrencyCodeFromOptions,
  parseEmployeeInfoCurrencyInput,
  parseEmployeeInfoDateToSerial,
} from "./employeeInfo";
import { evaluateEmployeeFormula, formatFormulaResult } from "./employeeInfoFormula";

describe("normalizeEmployeeInfoColumnKind", () => {
  it("accepts date as a valid employee info column kind", () => {
    expect(normalizeEmployeeInfoColumnKind("date")).toBe("date");
  });

  it("accepts currency as a valid employee info column kind", () => {
    expect(normalizeEmployeeInfoColumnKind("currency")).toBe("currency");
  });
});

describe("employee info currency helpers", () => {
  it("normalizes currency codes and falls back to USD", () => {
    expect(normalizeEmployeeInfoCurrencyCode("gbp")).toBe("GBP");
    expect(normalizeEmployeeInfoCurrencyCode("bad-code")).toBe("USD");
  });

  it("reads currency code from column options json", () => {
    expect(parseEmployeeInfoCurrencyCodeFromOptions({ currency_code: "MUR" })).toBe("MUR");
    expect(parseEmployeeInfoCurrencyCodeFromOptions([])).toBe("USD");
  });

  it("maps currency symbols", () => {
    expect(getEmployeeInfoCurrencySymbol("USD")).toBe("$");
    expect(getEmployeeInfoCurrencySymbol("GBP")).toBe("\u00A3");
    expect(getEmployeeInfoCurrencySymbol("MUR")).toBe("Rs");
  });

  it("normalizes display currency values", () => {
    expect(normalizeEmployeeInfoDisplayCurrencyCode("usd")).toBe("USD");
    expect(normalizeEmployeeInfoDisplayCurrencyCode("original")).toBe("ORIGINAL");
    expect(normalizeEmployeeInfoDisplayCurrencyCode("bad")).toBe("ORIGINAL");
  });

  it("normalizes formula currency mode values", () => {
    expect(normalizeEmployeeInfoFormulaCurrencyMode("fixed")).toBe("fixed");
    expect(normalizeEmployeeInfoFormulaCurrencyMode("display")).toBe("display");
    expect(normalizeEmployeeInfoFormulaCurrencyMode("bad")).toBe("display");
  });

  it("parses typed currency symbols and amount values", () => {
    expect(parseEmployeeInfoCurrencyInput("\u00A310", "USD")).toEqual({
      amountText: "10",
      currencyCode: "GBP",
    });
    expect(parseEmployeeInfoCurrencyInput("Rs 1500", "USD")).toEqual({
      amountText: "1500",
      currencyCode: "MUR",
    });
    expect(parseEmployeeInfoCurrencyInput("$5", "MUR")).toEqual({
      amountText: "5",
      currencyCode: "USD",
    });
  });

  it("formats currency amounts for display", () => {
    expect(formatEmployeeInfoCurrencyAmount(10, "USD")).toBe("$10");
    expect(formatEmployeeInfoCurrencyAmount(10, "GBP")).toBe("\u00A310");
    expect(formatEmployeeInfoCurrencyAmount(10, "MUR")).toBe("Rs 10");
  });

  it("builds rate maps and converts amounts", () => {
    const rateMap = buildEmployeeInfoExchangeRateMap(
      [
        {
          base_currency_code: "USD",
          quote_currency_code: "MUR",
          rate: "45",
          effective_month_start: "2026-02-01",
        },
      ],
      "2026-02-01"
    );

    expect(
      convertEmployeeInfoCurrencyAmount({
        amount: 10,
        fromCurrencyCode: "USD",
        toCurrencyCode: "MUR",
        exchangeRateMap: rateMap,
      })
    ).toBe(450);
    expect(
      convertEmployeeInfoCurrencyAmount({
        amount: 450,
        fromCurrencyCode: "MUR",
        toCurrencyCode: "USD",
        exchangeRateMap: rateMap,
      })
    ).toBeCloseTo(10);
  });

  it("supports two-hop conversion through another currency", () => {
    const rateMap = buildEmployeeInfoExchangeRateMap(
      [
        {
          base_currency_code: "USD",
          quote_currency_code: "MUR",
          rate: "45",
          effective_month_start: "2026-02-01",
        },
        {
          base_currency_code: "USD",
          quote_currency_code: "GBP",
          rate: "0.8",
          effective_month_start: "2026-02-01",
        },
      ],
      "2026-02-01"
    );

    expect(
      convertEmployeeInfoCurrencyAmount({
        amount: 90,
        fromCurrencyCode: "MUR",
        toCurrencyCode: "GBP",
        exchangeRateMap: rateMap,
      })
    ).toBeCloseTo(1.6);
  });
});

describe("employee info date helpers", () => {
  it("converts ISO dates into formula-friendly serial values", () => {
    const firstDay = parseEmployeeInfoDateToSerial("2026-02-14");
    const nextDay = parseEmployeeInfoDateToSerial("2026-02-15");

    expect(firstDay).not.toBeNull();
    expect(nextDay).not.toBeNull();
    expect((nextDay || 0) - (firstDay || 0)).toBe(1);
    expect(parseEmployeeInfoDateToSerial("")).toBeNull();
    expect(parseEmployeeInfoDateToSerial("not-a-date")).toBeNull();
  });
});

describe("evaluateEmployeeFormula", () => {
  it("keeps arithmetic formulas working with named references", () => {
    const result = evaluateEmployeeFormula(
      "=salary + bonus",
      () => 0,
      (reference) => {
        const key = String(reference || "").toLowerCase();
        if (key === "salary") return 1200;
        if (key === "bonus") return 300;
        return undefined;
      }
    );
    expect(result).toBe(1500);
  });

  it("supports bare letter references without row numbers", () => {
    const result = evaluateEmployeeFormula("=A + B", (index) =>
      index === 0 ? 2 : index === 1 ? 3 : 0
    );
    expect(result).toBe(5);
  });

  it("supports Excel functions and ranges", () => {
    const values = [1000, 200, 50];
    const result = evaluateEmployeeFormula("=ROUND(SUM(A1:C1)/3,2)", (index) => values[index] ?? 0);
    expect(result).toBe(416.67);
  });

  it("supports IF with OR and text comparisons", () => {
    const result = evaluateEmployeeFormula(
      '=IF(OR(client="Resolvable", client="Dusk"), 500, 0)',
      () => 0,
      (reference) => (String(reference || "").toLowerCase() === "client" ? "Dusk" : undefined)
    );
    expect(result).toBe(500);
  });

  it('supports shorthand comparisons like client = "A" OR "B"', () => {
    const matchResult = evaluateEmployeeFormula(
      '=IF(client = "Resolvable" OR "Dusk", 500, 0)',
      () => 0,
      (reference) => (String(reference || "").toLowerCase() === "client" ? "Dusk" : undefined)
    );
    const noMatchResult = evaluateEmployeeFormula(
      '=IF(client = "Resolvable" OR "Dusk", 500, 0)',
      () => 0,
      (reference) => (String(reference || "").toLowerCase() === "client" ? "Acme" : undefined)
    );
    expect(matchResult).toBe(500);
    expect(noMatchResult).toBe(0);
  });

  it("supports natural-language IF syntax", () => {
    const result = evaluateEmployeeFormula(
      '=IF Client column entry = "Resolvable" or "Dusk" then return 500, else 0',
      () => 0,
      (reference) =>
        String(reference || "").toLowerCase() === "client" ? "Resolvable" : undefined
    );
    expect(result).toBe(500);
  });

  it("supports text-returning formulas", () => {
    const result = evaluateEmployeeFormula(
      '=CONCAT("Employee: ", full_name)',
      () => "",
      (reference) =>
        String(reference || "").toLowerCase() === "full_name" ? "Casey Taylor" : undefined
    );
    expect(result).toBe("Employee: Casey Taylor");
    expect(formatFormulaResult(result)).toBe("Employee: Casey Taylor");
  });

  it("supports leave-date checks when date references are serialized", () => {
    const leaverResult = evaluateEmployeeFormula(
      "=IF(LEAVE_DATE>0,0,1)",
      () => 0,
      (reference) =>
        String(reference || "").toLowerCase() === "leave_date"
          ? parseEmployeeInfoDateToSerial("2026-02-15")
          : undefined
    );
    const activeResult = evaluateEmployeeFormula(
      "=IF(LEAVE_DATE>0,0,1)",
      () => 0,
      (reference) =>
        String(reference || "").toLowerCase() === "leave_date"
          ? parseEmployeeInfoDateToSerial(null)
          : undefined
    );

    expect(leaverResult).toBe(0);
    expect(activeResult).toBe(1);
  });
});
