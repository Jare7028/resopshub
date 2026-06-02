import { describe, expect, it } from "vitest";
import {
  cloneJsonValue,
  containsEphemeralImageSource,
  isEphemeralImageSource,
  isObjectRecord,
  isTiptapDocContent,
  mergeSaveWarnings,
  normalizeContent,
  normalizeSaveWarnings,
} from "./noteEditorContent";

describe("note editor content helpers", () => {
  it("normalizes non-doc content to an empty Tiptap doc", () => {
    expect(normalizeContent(null)).toEqual({
      type: "doc",
      content: [{ type: "paragraph" }],
    });
    expect(normalizeContent({ type: "paragraph" })).toEqual({
      type: "doc",
      content: [{ type: "paragraph" }],
    });
  });

  it("preserves canonical Tiptap doc content", () => {
    const doc = { type: "doc", content: [{ type: "paragraph" }] };

    expect(normalizeContent(doc)).toBe(doc);
    expect(isTiptapDocContent(doc)).toBe(true);
    expect(isTiptapDocContent([])).toBe(false);
  });

  it("normalizes and caps save warnings", () => {
    expect(
      normalizeSaveWarnings([
        " one ",
        "",
        null,
        "two",
        "three",
        "four",
        "five",
        "six",
        "seven",
      ])
    ).toEqual(["one", "two", "three", "four", "five", "six"]);
    expect(normalizeSaveWarnings("one")).toEqual([]);
  });

  it("merges warning arrays with de-duping and a six-warning cap", () => {
    expect(
      mergeSaveWarnings(["one", "two"], [" two ", "three", "four", "five", "six", "seven"])
    ).toEqual(["one", "two", "three", "four", "five", "six"]);
  });

  it("clones JSON values and falls back for non-serializable values", () => {
    const value = { nested: { count: 1 } };
    const cloned = cloneJsonValue(value);
    cloned.nested.count = 2;

    expect(value.nested.count).toBe(1);

    const circular: { self?: unknown } = {};
    circular.self = circular;
    expect(cloneJsonValue(circular)).toBe(circular);
  });

  it("identifies object records and ephemeral image sources", () => {
    expect(isObjectRecord({ ok: true })).toBe(true);
    expect(isObjectRecord([])).toBe(false);
    expect(isEphemeralImageSource(" blob:https://example.test/image ")).toBe(true);
    expect(isEphemeralImageSource("file:///tmp/image.png")).toBe(true);
    expect(isEphemeralImageSource("https://example.test/image.png")).toBe(false);
  });

  it("detects nested ephemeral image nodes", () => {
    expect(
      containsEphemeralImageSource({
        type: "doc",
        content: [
          {
            type: "image",
            attrs: { src: "blob:https://example.test/image" },
          },
        ],
      })
    ).toBe(true);
    expect(
      containsEphemeralImageSource({
        type: "doc",
        content: [{ type: "image", attrs: { src: "https://example.test/image.png" } }],
      })
    ).toBe(false);
  });
});
