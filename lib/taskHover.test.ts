import { describe, expect, it } from "vitest";
import { getTaskHoverFetchUrl, normalizeTaskHoverNotesPreview } from "./taskHover";

describe("task hover helpers", () => {
  it("builds encoded task hover API URLs", () => {
    expect(getTaskHoverFetchUrl(" task-1 ")).toBe("/api/tasks/task-1/hover");
    expect(getTaskHoverFetchUrl("task/with spaces")).toBe(
      "/api/tasks/task%2Fwith%20spaces/hover"
    );
  });

  it("normalizes notes previews from hover payloads", () => {
    expect(normalizeTaskHoverNotesPreview("  Call client tomorrow  ")).toBe(
      "Call client tomorrow"
    );
    expect(normalizeTaskHoverNotesPreview("   ")).toBeNull();
    expect(normalizeTaskHoverNotesPreview(null)).toBeNull();
    expect(normalizeTaskHoverNotesPreview({ text: "nope" })).toBeNull();
  });
});
