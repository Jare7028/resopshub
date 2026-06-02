import { describe, expect, it } from "vitest";
import {
  buildTaskTimelineData,
  buildTimelineTicks,
  buildTodayMarker,
  diffTimelineDays,
  parseTaskTimelineDate,
} from "./taskTimeline";

describe("task timeline helpers", () => {
  it("parses date-only values as local calendar days and rejects invalid dates", () => {
    const parsed = parseTaskTimelineDate("2026-06-03");

    expect(parsed?.getFullYear()).toBe(2026);
    expect(parsed?.getMonth()).toBe(5);
    expect(parsed?.getDate()).toBe(3);
    expect(parseTaskTimelineDate("not-a-date")).toBeNull();
  });

  it("normalizes tasks, clamps backwards due dates, and calculates the range", () => {
    const data = buildTaskTimelineData(
      [
        {
          id: "task-1",
          start_date: "2026-06-05",
          due_date: "2026-06-03",
          created_at: "2026-06-01",
        },
        {
          id: "task-2",
          start_date: null,
          due_date: "2026-06-10",
          created_at: "2026-06-02",
        },
      ],
      new Date(2026, 5, 1)
    );

    expect(data.tasks[0].start).toEqual(data.tasks[0].end);
    expect(data.rangeStart.getFullYear()).toBe(2026);
    expect(data.rangeStart.getMonth()).toBe(5);
    expect(data.rangeStart.getDate()).toBe(2);
    expect(data.rangeEnd.getDate()).toBe(10);
    expect(data.rangeDays).toBe(9);
  });

  it("returns a one-day timeline for empty task lists", () => {
    const now = new Date(2026, 5, 15);
    const data = buildTaskTimelineData([], now);

    expect(data.tasks).toEqual([]);
    expect(data.rangeStart).toBe(now);
    expect(data.rangeEnd).toBe(now);
    expect(data.rangeDays).toBe(1);
  });

  it("builds evenly spaced timeline ticks", () => {
    const ticks = buildTimelineTicks(new Date(2026, 5, 1), 9, 4);

    expect(ticks).toEqual([
      { label: "Jun 1", left: 0 },
      { label: "Jun 3", left: 25 },
      { label: "Jun 5", left: 50 },
      { label: "Jun 7", left: 75 },
      { label: "Jun 9", left: 100 },
    ]);
  });

  it("builds today markers only when today is inside the timeline range", () => {
    const rangeStart = new Date(2026, 5, 1);

    expect(buildTodayMarker(rangeStart, 10, new Date(2026, 5, 6))).toEqual({
      leftPercent: 50,
    });
    expect(buildTodayMarker(rangeStart, 10, new Date(2026, 5, 20))).toBeNull();
  });

  it("diffs calendar days without daylight-saving drift", () => {
    expect(diffTimelineDays(new Date(2026, 2, 28), new Date(2026, 2, 30))).toBe(2);
  });
});
