import { describe, expect, it } from "vitest";
import {
  allocateTimeOffRange,
  buildCarryoverExpiryDate,
  computeProratedEntitlementDays,
} from "./timeOffAllocation";

describe("computeProratedEntitlementDays", () => {
  it("prorates first year and rounds down", () => {
    expect(
      computeProratedEntitlementDays({
        annualBaseDays: 23,
        startDate: "2026-06-01",
        leaveYear: 2026,
      })
    ).toBe(13);
  });

  it("uses leap-year day count", () => {
    expect(
      computeProratedEntitlementDays({
        annualBaseDays: 24,
        startDate: "2024-07-01",
        leaveYear: 2024,
      })
    ).toBe(12);
  });

  it("returns full annual days after first year", () => {
    expect(
      computeProratedEntitlementDays({
        annualBaseDays: 23,
        startDate: "2026-06-01",
        leaveYear: 2027,
      })
    ).toBe(23);
  });
});

describe("buildCarryoverExpiryDate", () => {
  it("clamps invalid day to month end", () => {
    expect(
      buildCarryoverExpiryDate({
        leaveYear: 2026,
        carryoverEnabled: true,
        expiryMonth: 2,
        expiryDay: 31,
      })
    ).toBe("2026-02-28");
  });
});

describe("allocateTimeOffRange", () => {
  it("uses carryover before entitlement and then unpaid", () => {
    const allocations = allocateTimeOffRange({
      startDate: "2026-01-01",
      endDate: "2026-01-05",
      yearStateByYear: {
        2026: {
          carryoverRemaining: 2,
          carryoverExpiryDate: "2026-03-31",
          entitlementRemaining: 2,
        },
      },
    });

    expect(allocations.map((row) => row.paySource)).toEqual([
      "carryover",
      "carryover",
      "entitlement",
      "entitlement",
      "unpaid",
    ]);
  });

  it("does not use carryover after expiry", () => {
    const allocations = allocateTimeOffRange({
      startDate: "2026-04-01",
      endDate: "2026-04-03",
      yearStateByYear: {
        2026: {
          carryoverRemaining: 5,
          carryoverExpiryDate: "2026-03-31",
          entitlementRemaining: 1,
        },
      },
    });

    expect(allocations.map((row) => row.paySource)).toEqual([
      "entitlement",
      "unpaid",
      "unpaid",
    ]);
  });

  it("automatically handles cross-year ranges", () => {
    const allocations = allocateTimeOffRange({
      startDate: "2026-12-31",
      endDate: "2027-01-02",
      yearStateByYear: {
        2026: {
          carryoverRemaining: 0,
          carryoverExpiryDate: null,
          entitlementRemaining: 1,
        },
        2027: {
          carryoverRemaining: 1,
          carryoverExpiryDate: "2027-02-28",
          entitlementRemaining: 0,
        },
      },
    });

    expect(allocations).toEqual([
      { day: "2026-12-31", leaveYear: 2026, paySource: "entitlement" },
      { day: "2027-01-01", leaveYear: 2027, paySource: "carryover" },
      { day: "2027-01-02", leaveYear: 2027, paySource: "unpaid" },
    ]);
  });
});
