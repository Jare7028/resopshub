import { describe, expect, it } from "vitest";
import {
  DEFAULT_TASK_NOTES_PREVIEW_MAX_CHARS,
  buildTaskNotesPreview,
} from "./taskNotesPreview";

describe("taskNotesPreview", () => {
  it("returns null for empty notes", () => {
    expect(buildTaskNotesPreview({ contentText: "" })).toBeNull();
    expect(buildTaskNotesPreview({ contentText: "   \n\t  " })).toBeNull();
    expect(buildTaskNotesPreview({})).toBeNull();
  });

  it("collapses whitespace in content text", () => {
    expect(
      buildTaskNotesPreview({
        contentText: "  First   line \n\n second\t\tline   ",
      })
    ).toBe("First line second line");
  });

  it("truncates long notes with ellipsis", () => {
    expect(
      buildTaskNotesPreview({
        contentText: "abcdefghijklmnopqrstuvwxyz",
        maxChars: 10,
      })
    ).toBe("abcdefghi…");
  });

  it("falls back to tiptap content when content_text is missing", () => {
    expect(
      buildTaskNotesPreview({
        content: {
          type: "doc",
          content: [
            { type: "paragraph", content: [{ type: "text", text: "Fallback text from JSON" }] },
          ],
        },
      })
    ).toBe("Fallback text from JSON");
  });

  it("uses default max chars when maxChars is invalid", () => {
    const longValue = "x".repeat(DEFAULT_TASK_NOTES_PREVIEW_MAX_CHARS + 50);
    const preview = buildTaskNotesPreview({
      contentText: longValue,
      maxChars: 0,
    });
    expect(preview).toBe(`${"x".repeat(DEFAULT_TASK_NOTES_PREVIEW_MAX_CHARS - 1)}…`);
  });
});
