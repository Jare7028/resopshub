import { describe, expect, it } from "vitest";
import { parseTaskScheduleFormData } from "./taskSchedule";

describe("parseTaskScheduleFormData", () => {
  it("allows quick tasks without a schedule", () => {
    const formData = new FormData();
    formData.set("due_date", "");
    formData.set("due_time", "");
    formData.set("start_date", "");
    formData.set("recurrence_frequency", "");

    const result = parseTaskScheduleFormData(formData, "Europe/London");

    expect(result.error).toBeNull();
    expect(result.value?.dueDate).toBeNull();
    expect(result.value?.dueTime).toBeNull();
    expect(result.value?.startDate).toBeNull();
    expect(result.value?.recurrenceConfig).toBeNull();
  });

  it("keeps a blank one-off start date as null", () => {
    const formData = new FormData();
    formData.set("due_date", "2026-06-10");
    formData.set("due_time", "09:30");
    formData.set("start_date", "");
    formData.set("recurrence_frequency", "");

    const result = parseTaskScheduleFormData(formData, "Europe/London");

    expect(result.error).toBeNull();
    expect(result.value?.startDate).toBeNull();
    expect(result.value?.dueDate).toBe("2026-06-10");
    expect(result.value?.recurrenceConfig).toBeNull();
  });

  it("uses the recurrence start date for recurring tasks", () => {
    const formData = new FormData();
    formData.set("due_time", "11:00");
    formData.set("recurrence_frequency", "weekly");
    formData.set("recurrence_interval", "1");
    formData.set("recurrence_start_date", "2026-06-10");
    formData.set("recurrence_end_mode", "never");
    formData.append("recurrence_weekdays", "3");

    const result = parseTaskScheduleFormData(formData, "Europe/London");

    expect(result.error).toBeNull();
    expect(result.value?.startDate).toBe("2026-06-10");
    expect(result.value?.dueDate).toBe("2026-06-10");
    expect(result.value?.recurrenceConfig?.frequency).toBe("weekly");
  });

  it("defaults weekly recurrence weekdays to the start date weekday", () => {
    const formData = new FormData();
    formData.set("due_time", "11:00");
    formData.set("recurrence_frequency", "weekly");
    formData.set("recurrence_interval", "1");
    formData.set("recurrence_start_date", "2026-06-12");
    formData.set("recurrence_end_mode", "never");

    const result = parseTaskScheduleFormData(formData, "Europe/London");

    expect(result.error).toBeNull();
    expect(result.value?.dueDate).toBe("2026-06-12");
    expect(result.value?.recurrenceConfig?.weekdays).toEqual([5]);
    expect(result.value?.recurrenceNextDate).toBe("2026-06-19");
  });

  it("rejects recurring tasks when the configured end date is before the first occurrence", () => {
    const formData = new FormData();
    formData.set("due_time", "11:00");
    formData.set("recurrence_frequency", "weekly");
    formData.set("recurrence_interval", "1");
    formData.set("recurrence_start_date", "2026-06-10");
    formData.set("recurrence_end_mode", "on");
    formData.set("recurrence_end_date", "2026-06-09");
    formData.append("recurrence_weekdays", "3");

    const result = parseTaskScheduleFormData(formData, "Europe/London");

    expect(result).toEqual({
      error: "End date must be on or after start date",
      value: null,
    });
  });

  it("bounds the next recurrence when the end date allows only the first occurrence", () => {
    const formData = new FormData();
    formData.set("due_time", "11:00");
    formData.set("recurrence_frequency", "weekly");
    formData.set("recurrence_interval", "1");
    formData.set("recurrence_start_date", "2026-06-10");
    formData.set("recurrence_end_mode", "on");
    formData.set("recurrence_end_date", "2026-06-10");
    formData.append("recurrence_weekdays", "3");

    const result = parseTaskScheduleFormData(formData, "Europe/London");

    expect(result.error).toBeNull();
    expect(result.value?.dueDate).toBe("2026-06-10");
    expect(result.value?.recurrenceNextDate).toBeNull();
  });
});
