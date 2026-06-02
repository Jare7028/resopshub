import { describe, expect, it } from "vitest";
import {
  buildCompletedStatusValues,
  buildHiddenStatusValues,
  buildStatusColorMap,
  buildStatusOptionsWithMetadata,
  normalizeStatusColorHex,
  type StatusOptionRow,
} from "./statusOptions";

describe("status option helpers", () => {
  it("normalizes and orders custom status rows while preserving completion metadata", () => {
    const rows: StatusOptionRow[] = [
      {
        entity_type: "task",
        value: "Needs Checking!",
        position: 2,
        is_visible: true,
        counts_as_completed: false,
        color_hex: "abc",
      },
      {
        entity_type: "task",
        value: "Done",
        position: 1,
        is_visible: false,
        counts_as_completed: true,
        color_hex: "#00FFAA",
      },
      {
        entity_type: "project",
        value: "Ignored",
        position: 1,
        is_visible: true,
        counts_as_completed: false,
      },
    ];

    const options = buildStatusOptionsWithMetadata("task", rows, []);

    expect(options.map((option) => option.value)).toEqual([
      "done",
      "to_do",
      "in_progress",
      "needs_checking",
      "blocked",
      "completed",
      "cancelled",
    ]);
    expect(options.find((option) => option.value === "done")).toMatchObject({
      isVisible: false,
      countsAsCompleted: true,
      colorHex: "#00ffaa",
    });
    expect(options.find((option) => option.value === "needs_checking")).toMatchObject({
      colorHex: "#aabbcc",
    });
  });

  it("builds completed and hidden status lists from explicit metadata", () => {
    const options = buildStatusOptionsWithMetadata(
      "feature_suggestion",
      [
        {
          entity_type: "feature_suggestion",
          value: "Shipped",
          position: 1,
          is_visible: false,
          counts_as_completed: true,
          color_hex: "#123456",
        },
        {
          entity_type: "feature_suggestion",
          value: "Triaged",
          position: 2,
          is_visible: false,
          counts_as_completed: false,
          color_hex: "#654321",
        },
      ],
      []
    );

    expect(buildCompletedStatusValues("feature_suggestion", options)).toContain("shipped");
    expect(buildCompletedStatusValues("feature_suggestion", options)).not.toContain("triaged");
    expect(buildHiddenStatusValues("feature_suggestion", options)).toEqual(
      expect.arrayContaining(["shipped", "triaged"])
    );
    expect(buildStatusColorMap("feature_suggestion", options)).toMatchObject({
      shipped: "#123456",
      triaged: "#654321",
    });
  });

  it("normalizes valid hex colors and rejects unsafe values", () => {
    expect(normalizeStatusColorHex("abc")).toBe("#aabbcc");
    expect(normalizeStatusColorHex("#ABCDEF")).toBe("#abcdef");
    expect(normalizeStatusColorHex("javascript:alert(1)")).toBeNull();
    expect(normalizeStatusColorHex("")).toBeNull();
  });
});
