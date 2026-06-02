import { describe, expect, it } from "vitest";
import {
  addDaysToYmd,
  getFirstOccurrence,
  getNextOccurrence,
  ymdFromDate,
  ymdToDate,
} from "./recurrence";

describe("recurrence helpers", () => {
  it("converts between YMD strings and UTC dates", () => {
    const date = ymdToDate("2026-06-02");

    expect(date.toISOString()).toBe("2026-06-02T00:00:00.000Z");
    expect(ymdFromDate(date)).toBe("2026-06-02");
    expect(addDaysToYmd("2026-02-27", 2)).toBe("2026-03-01");
  });

  it("returns daily first and next occurrences using the configured interval", () => {
    const config = {
      frequency: "daily" as const,
      interval: 3,
      startDate: "2026-06-02",
    };

    expect(getFirstOccurrence(config)).toBe("2026-06-02");
    expect(getNextOccurrence(config, "2026-06-02")).toBe("2026-06-05");
  });

  it("finds weekly occurrences across selected weekdays and intervals", () => {
    const config = {
      frequency: "weekly" as const,
      interval: 2,
      startDate: "2026-06-01",
      weekdays: [1, 3],
    };

    expect(getFirstOccurrence(config)).toBe("2026-06-01");
    expect(getNextOccurrence(config, "2026-06-01")).toBe("2026-06-03");
    expect(getNextOccurrence(config, "2026-06-03")).toBe("2026-06-15");
  });

  it("defaults weekly recurrence to the start-date weekday", () => {
    const config = {
      frequency: "weekly" as const,
      interval: 1,
      startDate: "2026-06-12",
    };

    expect(getFirstOccurrence(config)).toBe("2026-06-12");
    expect(getNextOccurrence(config, "2026-06-12")).toBe("2026-06-19");
  });

  it("clamps monthly day recurrence to the last day of shorter months", () => {
    const config = {
      frequency: "monthly" as const,
      interval: 1,
      startDate: "2026-01-31",
      monthDay: 31,
    };

    expect(getFirstOccurrence(config)).toBe("2026-01-31");
    expect(getNextOccurrence(config, "2026-01-31")).toBe("2026-02-28");
  });

  it("supports nth and last weekday monthly recurrence", () => {
    expect(
      getFirstOccurrence({
        frequency: "monthly",
        interval: 1,
        startDate: "2026-06-01",
        monthWeek: 2,
        monthWeekday: 2,
      })
    ).toBe("2026-06-09");

    expect(
      getNextOccurrence(
        {
          frequency: "monthly",
          interval: 1,
          startDate: "2026-06-01",
          monthWeek: -1,
          monthWeekday: 5,
        },
        "2026-06-26"
      )
    ).toBe("2026-07-31");
  });

  it("clamps yearly leap-day recurrence in non-leap years", () => {
    const config = {
      frequency: "yearly" as const,
      interval: 1,
      startDate: "2024-02-29",
    };

    expect(getFirstOccurrence(config)).toBe("2024-02-29");
    expect(getNextOccurrence(config, "2024-02-29")).toBe("2025-02-28");
  });
});
