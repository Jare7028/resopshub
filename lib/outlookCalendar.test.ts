import { describe, expect, it } from "vitest";
import { buildOutlookTaskComposeUrl } from "./outlookCalendar";

function paramsOf(urlValue: string) {
  return new URL(urlValue).searchParams;
}

describe("buildOutlookTaskComposeUrl", () => {
  it("creates an all-day event when only due_date is present", () => {
    const url = buildOutlookTaskComposeUrl({
      id: "task-1",
      title: "Review docs",
      due_date: "2026-02-20",
      due_time: null,
    });
    const params = paramsOf(url);
    expect(params.get("subject")).toBe("Review docs");
    expect(params.get("allday")).toBe("true");
    expect(params.get("startdt")).toBe("2026-02-20");
    expect(params.get("enddt")).toBe("2026-02-21");
  });

  it("creates a timed event when due_date and due_time are present", () => {
    const url = buildOutlookTaskComposeUrl({
      id: "task-2",
      title: "Client call",
      due_date: "2026-02-20",
      due_time: "14:30:00",
    });
    const params = paramsOf(url);
    expect(params.get("allday")).toBe("false");
    expect(params.get("startdt")).toBe("2026-02-20T14:30:00");
    expect(params.get("enddt")).toBe("2026-02-20T15:00:00");
  });

  it("includes task link when appBaseUrl is provided", () => {
    const url = buildOutlookTaskComposeUrl(
      {
        id: "task-3",
        title: "Prepare timeline",
        description: "Need final milestones.",
      },
      { appBaseUrl: "https://app.example.com" }
    );
    const params = paramsOf(url);
    expect(params.get("body")).toContain("Need final milestones.");
    expect(params.get("body")).toContain("https://app.example.com/tasks/task-3");
  });
});
