import { describe, expect, it } from "vitest";
import {
  formatSubmissionValue,
  shortQuestionLabel,
  type SubmissionTableField,
} from "./formSubmissionTableUtils";

describe("shortQuestionLabel", () => {
  it("returns original label when under max length", () => {
    expect(shortQuestionLabel("First name", 20)).toBe("First name");
  });

  it("truncates and appends ellipsis when over max length", () => {
    expect(shortQuestionLabel("What is your full legal first name?", 20)).toBe(
      "What is your full..."
    );
  });
});

describe("formatSubmissionValue", () => {
  it("returns plain text values for non-checkbox fields", () => {
    const field: SubmissionTableField = {
      key: "favorite_color",
      type: "text",
      label: "Favorite color",
    };
    expect(formatSubmissionValue(field, { favorite_color: "Blue" })).toBe("Blue");
  });

  it("returns em dash for missing values", () => {
    const field: SubmissionTableField = {
      key: "notes",
      type: "textarea",
      label: "Notes",
    };
    expect(formatSubmissionValue(field, {})).toBe("\u2014");
  });

  it("formats checkbox true as Yes", () => {
    const field: SubmissionTableField = {
      key: "is_billable",
      type: "checkbox",
      label: "Billable",
    };
    expect(formatSubmissionValue(field, { is_billable: "true" })).toBe("Yes");
  });

  it("formats checkbox false as No", () => {
    const field: SubmissionTableField = {
      key: "is_billable",
      type: "checkbox",
      label: "Billable",
    };
    expect(formatSubmissionValue(field, { is_billable: false })).toBe("No");
  });

  it("joins array values for multi-value fields", () => {
    const field: SubmissionTableField = { key: "tags", type: "text", label: "Tags" };
    expect(formatSubmissionValue(field, { tags: ["A", "B", "C"] })).toBe("A, B, C");
  });

  it("joins multi-select responses", () => {
    const field: SubmissionTableField = {
      key: "skills",
      type: "multi_select",
      label: "Skills",
    };
    expect(formatSubmissionValue(field, { skills: ["HTML", "CSS"] })).toBe("HTML, CSS");
  });
});
