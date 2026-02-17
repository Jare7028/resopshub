import { describe, expect, it } from "vitest";
import {
  evaluateEmployeeFormula,
  formatFormulaResult,
  normalizeEmployeeInfoColumnKind,
} from "./employeeInfo";

describe("normalizeEmployeeInfoColumnKind", () => {
  it("accepts date as a valid employee info column kind", () => {
    expect(normalizeEmployeeInfoColumnKind("date")).toBe("date");
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
    const result = evaluateEmployeeFormula("=A + B", (index) => (index === 0 ? 2 : index === 1 ? 3 : 0));
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

  it("supports shorthand comparisons like client = \"A\" OR \"B\"", () => {
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
});
