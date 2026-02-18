import { describe, expect, it } from "vitest";
import {
  computeClientBillingSnapshot,
  convertSnapshotAmountsToCurrency,
  type BillingProfileRevenueRow,
  type EmployeeInfoColumnRow,
  type EmployeeInfoRecordRow,
  type EmployeeInfoValueRow,
} from "./billingSnapshot";

function createColumn(
  partial: Partial<EmployeeInfoColumnRow> & Pick<EmployeeInfoColumnRow, "id" | "key" | "label" | "column_kind">
): EmployeeInfoColumnRow {
  return {
    id: partial.id,
    key: partial.key,
    label: partial.label,
    column_kind: partial.column_kind,
    formula: partial.formula || null,
    formula_currency_mode: partial.formula_currency_mode || "display",
    formula_currency_code: partial.formula_currency_code || "USD",
    options_json: partial.options_json ?? null,
    position: partial.position ?? 0,
  };
}

describe("computeClientBillingSnapshot", () => {
  it("computes revenue, costs, and margin with mixed source modes", () => {
    const records: EmployeeInfoRecordRow[] = [
      { id: "r1", full_name: "Ada", client_id: "c1" },
      { id: "r2", full_name: "Lin", client_id: "c1" },
    ];

    const columns: EmployeeInfoColumnRow[] = [
      createColumn({
        id: "col_role",
        key: "role",
        label: "Role",
        column_kind: "text",
        position: 1,
      }),
      createColumn({
        id: "col_salary",
        key: "salary",
        label: "Salary",
        column_kind: "currency",
        position: 2,
        options_json: { currency_code: "USD" },
      }),
      createColumn({
        id: "col_bonus",
        key: "bonus",
        label: "Bonus",
        column_kind: "number",
        position: 3,
      }),
      createColumn({
        id: "col_cost_formula",
        key: "total_monthly_cost_formula",
        label: "Total Monthly Cost Formula",
        column_kind: "formula",
        formula: "=salary + bonus",
        formula_currency_mode: "display",
        formula_currency_code: "USD",
        position: 4,
      }),
    ];

    const values: EmployeeInfoValueRow[] = [
      {
        record_id: "r1",
        column_id: "col_role",
        text_value: "Engineer",
        option_value: null,
        money_currency_code: null,
      },
      {
        record_id: "r1",
        column_id: "col_salary",
        text_value: "1000",
        option_value: null,
        money_currency_code: "USD",
      },
      {
        record_id: "r1",
        column_id: "col_bonus",
        text_value: "50",
        option_value: null,
        money_currency_code: null,
      },
      {
        record_id: "r2",
        column_id: "col_role",
        text_value: "Ops",
        option_value: null,
        money_currency_code: null,
      },
      {
        record_id: "r2",
        column_id: "col_salary",
        text_value: "500",
        option_value: null,
        money_currency_code: "USD",
      },
      {
        record_id: "r2",
        column_id: "col_bonus",
        text_value: "100",
        option_value: null,
        money_currency_code: null,
      },
    ];

    const profile: BillingProfileRevenueRow = {
      currency: "GBP",
      hourly_rate: 20,
      total_billable_hours: 10,
      revenue_charge_items: [
        { id: "rev_per_user", label: "Seat fee", amount: 5, mode: "per_user" },
        { id: "rev_monthly", label: "Platform", amount: 40, mode: "monthly" },
      ],
      monthly_cost_items: [
        {
          id: "src_formula",
          source: "employee_column",
          column_id: "col_cost_formula",
          label: "Formula source",
          amount: 0,
          mode: "monthly",
        },
        { id: "cost_per_user", source: "custom", label: "Insurance", amount: 100, mode: "per_user" },
        { id: "cost_monthly", source: "custom", label: "License", amount: 50, mode: "monthly" },
      ],
    };

    const snapshot = computeClientBillingSnapshot({
      clientId: "c1",
      clientName: "Acme",
      billingProfile: profile,
      employeeRecords: records,
      employeeColumns: columns,
      employeeValues: values,
      exchangeRateRows: [
        {
          base_currency_code: "USD",
          quote_currency_code: "GBP",
          rate: "0.8",
          effective_month_start: "2026-02-01",
        },
      ],
      monthStart: "2026-02-01",
    });

    expect(snapshot.employeeMonthlyCostSummary.clientRowCount).toBe(2);
    expect(snapshot.employeeMonthlyCostSummary.contributingRowCount).toBe(5);
    expect(snapshot.employeeMonthlyCostSummary.amount).toBeCloseTo(1600);
    expect(snapshot.estimatedMonthlyRevenue).toBeCloseTo(250);
    expect(snapshot.estimatedMonthlyMargin).toBeCloseTo(-1350);
    expect(snapshot.estimatedMonthlyMarginPercent).toBeCloseTo(-540);
    expect(snapshot.revenueBreakdownRows.map((row) => row.totalAmount)).toEqual([10, 40]);
    expect(snapshot.employeeMonthlyCostSummary.breakdownRows.map((row) => row.roleLabel)).toEqual([
      "Engineer",
      "Ops",
    ]);
    expect(snapshot.employeeMonthlyCostSummary.breakdownRows.map((row) => row.totalAmount)).toEqual([
      950,
      600,
    ]);
  });

  it("flags missing exchange rates when conversion cannot be completed", () => {
    const snapshot = computeClientBillingSnapshot({
      clientId: "c1",
      clientName: "Acme",
      billingProfile: {
        currency: "GBP",
        hourly_rate: 0,
        total_billable_hours: 0,
        revenue_charge_items: [],
        monthly_cost_items: [
          {
            id: "src_currency",
            source: "employee_column",
            column_id: "salary",
            label: "Salary",
            amount: 0,
            mode: "monthly",
          },
        ],
      },
      employeeRecords: [{ id: "r1", full_name: "Ada", client_id: "c1" }],
      employeeColumns: [
        createColumn({
          id: "salary",
          key: "salary",
          label: "Salary",
          column_kind: "currency",
          options_json: { currency_code: "USD" },
          position: 1,
        }),
      ],
      employeeValues: [
        {
          record_id: "r1",
          column_id: "salary",
          text_value: "1000",
          option_value: null,
          money_currency_code: "USD",
        },
      ],
      exchangeRateRows: [],
    });

    expect(snapshot.employeeMonthlyCostSummary.hasMissingExchangeRate).toBe(true);
    expect(snapshot.employeeMonthlyCostSummary.amount).toBe(0);
  });
});

describe("convertSnapshotAmountsToCurrency", () => {
  it("returns same values when target currency matches billing currency", () => {
    const base = computeClientBillingSnapshot({
      clientId: "c1",
      clientName: "Acme",
      billingProfile: {
        currency: "GBP",
        hourly_rate: 10,
        total_billable_hours: 10,
        revenue_charge_items: [],
        monthly_cost_items: [],
      },
      employeeRecords: [],
      employeeColumns: [],
      employeeValues: [],
      exchangeRateRows: [],
    });

    const converted = convertSnapshotAmountsToCurrency({
      snapshot: base,
      targetCurrencyCode: "GBP",
      exchangeRateRows: [],
    });

    expect(converted.currencyCode).toBe("GBP");
    expect(converted.estimatedMonthlyRevenue).toBe(100);
    expect(converted.employeeMonthlyCosts).toBe(0);
    expect(converted.estimatedMonthlyMargin).toBe(100);
    expect(converted.missingExchangeRate).toBe(false);
  });

  it("returns missing flag when snapshot currency conversion is unavailable", () => {
    const base = computeClientBillingSnapshot({
      clientId: "c1",
      clientName: "Acme",
      billingProfile: {
        currency: "GBP",
        hourly_rate: 10,
        total_billable_hours: 10,
        revenue_charge_items: [],
        monthly_cost_items: [],
      },
      employeeRecords: [],
      employeeColumns: [],
      employeeValues: [],
      exchangeRateRows: [],
    });

    const converted = convertSnapshotAmountsToCurrency({
      snapshot: base,
      targetCurrencyCode: "MUR",
      exchangeRateRows: [],
    });

    expect(converted.missingExchangeRate).toBe(true);
    expect(converted.estimatedMonthlyRevenue).toBe(0);
    expect(converted.employeeMonthlyCosts).toBe(0);
    expect(converted.estimatedMonthlyMargin).toBe(0);
  });
});
