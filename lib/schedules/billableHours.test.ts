import { describe, expect, it } from "vitest";
import { computeBillableMinutes, type BillableShiftInput } from "./billableHours";

const baseShift: BillableShiftInput = {
  is_open: false,
  start_local_time: "09:00",
  end_local_time: "17:00",
  ends_next_day: false,
  break_minutes: 30,
  job_code_id: "jc-1",
};

describe("computeBillableMinutes", () => {
  it("counts assigned shift minutes when code is billable", () => {
    const result = computeBillableMinutes(baseShift, {
      billableJobCodeIds: new Set(["jc-1"]),
      breaksBillable: false,
    });
    expect(result).toBe(450);
  });

  it("returns 0 for open shifts", () => {
    const result = computeBillableMinutes(
      {
        ...baseShift,
        is_open: true,
      },
      {
        billableJobCodeIds: new Set(["jc-1"]),
        breaksBillable: true,
      }
    );
    expect(result).toBe(0);
  });

  it("returns 0 when job code is missing", () => {
    const result = computeBillableMinutes(
      {
        ...baseShift,
        job_code_id: null,
      },
      {
        billableJobCodeIds: new Set(["jc-1"]),
        breaksBillable: true,
      }
    );
    expect(result).toBe(0);
  });

  it("returns 0 when job code is not billable", () => {
    const result = computeBillableMinutes(baseShift, {
      billableJobCodeIds: new Set(["jc-2"]),
      breaksBillable: true,
    });
    expect(result).toBe(0);
  });

  it("applies break billable toggle", () => {
    const billableBreak = computeBillableMinutes(baseShift, {
      billableJobCodeIds: new Set(["jc-1"]),
      breaksBillable: true,
    });
    const nonBillableBreak = computeBillableMinutes(baseShift, {
      billableJobCodeIds: new Set(["jc-1"]),
      breaksBillable: false,
    });

    expect(billableBreak).toBe(480);
    expect(nonBillableBreak).toBe(450);
  });

  it("handles overnight shifts", () => {
    const result = computeBillableMinutes(
      {
        ...baseShift,
        start_local_time: "22:00",
        end_local_time: "06:00",
        ends_next_day: true,
        break_minutes: 45,
      },
      {
        billableJobCodeIds: new Set(["jc-1"]),
        breaksBillable: false,
      }
    );

    expect(result).toBe(435);
  });
});
