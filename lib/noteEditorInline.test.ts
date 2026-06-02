import { describe, expect, it } from "vitest";
import {
  extractTaskIdFromHref,
  normalizeInlineText,
  normalizeMentionHandle,
  normalizePastedLink,
  normalizeTaskStatusLabel,
  parseTimestampMs,
} from "./noteEditorInline";

describe("note editor inline helpers", () => {
  it("parses valid timestamp strings only", () => {
    const parsed = parseTimestampMs("2026-06-02T10:30:00.000Z");

    expect(typeof parsed).toBe("number");
    expect(parseTimestampMs("")).toBeNull();
    expect(parseTimestampMs("not a date")).toBeNull();
    expect(parseTimestampMs(Date.now())).toBeNull();
  });

  it("normalizes pasted standalone links", () => {
    expect(normalizePastedLink(" https://example.com/path ")).toBe(
      "https://example.com/path"
    );
    expect(normalizePastedLink("mailto:test@example.com")).toBe(
      "mailto:test@example.com"
    );
    expect(normalizePastedLink("tel:+441234567890")).toBe("tel:+441234567890");
    expect(normalizePastedLink("/tasks/task-1")).toBe("/tasks/task-1");
    expect(normalizePastedLink("https://example.com/a b")).toBeNull();
    expect(normalizePastedLink("example.com")).toBeNull();
  });

  it("normalizes mention handles for suggestion matching", () => {
    expect(normalizeMentionHandle(" @@Jane.Doe!! ")).toBe("jane.doe");
    expect(normalizeMentionHandle("a")).toBe("");
    expect(normalizeMentionHandle("__team-lead__")).toBe("team-lead");
  });

  it("normalizes inline text whitespace", () => {
    expect(normalizeInlineText("  one\n two\tthree  ")).toBe("one two three");
  });

  it("formats task status labels", () => {
    expect(normalizeTaskStatusLabel(null)).toBe("To Do");
    expect(normalizeTaskStatusLabel("in_progress")).toBe("In Progress");
    expect(normalizeTaskStatusLabel("DONE")).toBe("Done");
  });

  it("extracts task ids from internal task links", () => {
    expect(extractTaskIdFromHref("/tasks/abc-123?from=note")).toBe("abc-123");
    expect(extractTaskIdFromHref("/clients/abc-123")).toBeNull();
    expect(extractTaskIdFromHref("https://example.com/tasks/abc-123")).toBeNull();
  });
});
