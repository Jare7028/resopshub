import type { Editor } from "@tiptap/core";
import { describe, expect, it } from "vitest";
import {
  EMPTY_NOTE_EDITOR_REVIEW_STATS,
  buildNoteEditorMetaTooltip,
  buildNoteEditorReviewStats,
  findTrailingMissingImageNodePos,
  getActiveTableColumnType,
  getCurrentLineText,
  getCurrentTextAlign,
  getSelectedText,
  getSuggestedTaskTitle,
} from "./NoteEditorStateHelpers";

function asEditor(value: unknown): Editor {
  return value as Editor;
}

function node(name: string, attrs: Record<string, unknown> = {}) {
  return { type: { name }, attrs };
}

describe("note editor state helpers", () => {
  it("builds note editor meta tooltip text from saved labels", () => {
    expect(
      buildNoteEditorMetaTooltip({
        lastEditedAtLabel: " 2 minutes ago ",
        lastEditedByLabel: " Morgan ",
      })
    ).toBe("Last edited: 2 minutes ago\nEdited by: Morgan");
    expect(
      buildNoteEditorMetaTooltip({
        lastEditedAtLabel: "",
        lastEditedByLabel: "Alex",
      })
    ).toBe("Edited by: Alex");
    expect(buildNoteEditorMetaTooltip({})).toBe("");
  });

  it("builds note editor review stats from plain text", () => {
    expect(buildNoteEditorReviewStats(" \n\t ")).toBe(EMPTY_NOTE_EDITOR_REVIEW_STATS);
    expect(
      buildNoteEditorReviewStats(
        "Hello @Morgan, check /tasks/01234567-89ab-4def-8123-456789abcdef and @alex."
      )
    ).toEqual({
      words: 6,
      readingMinutes: 1,
      mentions: 2,
      linkedTaskRefs: 1,
    });
    expect(buildNoteEditorReviewStats(Array.from({ length: 221 }, () => "word").join(" ")))
      .toMatchObject({
        words: 221,
        readingMinutes: 2,
      });
  });

  it("detects the active table column type only inside supported table cells", () => {
    expect(getActiveTableColumnType(null)).toBe("text");
    expect(
      getActiveTableColumnType(
        asEditor({
          isActive: () => false,
          state: { selection: { $from: { depth: 0, node: () => node("doc") } } },
        })
      )
    ).toBe("text");

    expect(
      getActiveTableColumnType(
        asEditor({
          isActive: (name: string) => name === "table",
          state: {
            selection: {
              $from: {
                depth: 3,
                node: (depth: number) =>
                  depth === 2
                    ? node("tableCell", { colType: "date" })
                    : node("paragraph"),
              },
            },
          },
        })
      )
    ).toBe("date");

    expect(
      getActiveTableColumnType(
        asEditor({
          isActive: (name: string) => name === "table",
          state: {
            selection: {
              $from: {
                depth: 2,
                node: () => node("tableHeader", { colType: "unsupported" }),
              },
            },
          },
        })
      )
    ).toBe("text");
  });

  it("reads the first supported text alignment from active block attributes", () => {
    expect(getCurrentTextAlign(null)).toBe("left");
    expect(
      getCurrentTextAlign(
        asEditor({
          getAttributes: (name: string) =>
            name === "paragraph" ? { textAlign: " Center " } : {},
        })
      )
    ).toBe("center");
    expect(
      getCurrentTextAlign(
        asEditor({
          getAttributes: (name: string) =>
            name === "blockquote" ? { textAlign: "justify" } : { textAlign: "sideways" },
        })
      )
    ).toBe("justify");
  });

  it("finds the last image-like node with a missing src", () => {
    expect(
      findTrailingMissingImageNodePos(
        asEditor({
          state: {
            doc: {
              descendants: (callback: (nodeValue: unknown, pos: number) => boolean) => {
                callback(node("paragraph"), 1);
                callback(node("image", { src: "https://example.com/image.png" }), 5);
                callback(node("floatingImage", { src: "" }), 9);
                callback(node("image"), 14);
                return true;
              },
            },
          },
        })
      )
    ).toBe(14);

    expect(
      findTrailingMissingImageNodePos(
        asEditor({
          state: {
            doc: {
              descendants: (callback: (nodeValue: unknown, pos: number) => boolean) => {
                callback(node("paragraph"), 1);
                callback(node("image", { src: "data:image/png;base64,abc" }), 5);
                return true;
              },
            },
          },
        })
      )
    ).toBeNull();
  });

  it("normalizes selected text, current line text, and suggested task titles", () => {
    const selectedEditor = asEditor({
      state: {
        selection: {
          from: 1,
          to: 8,
          empty: false,
          $from: { parent: { textContent: "current line" } },
        },
        doc: {
          textBetween: () => " selected\n\ttext ",
        },
      },
    });

    expect(getSelectedText(selectedEditor)).toBe("selected text");
    expect(getCurrentLineText(selectedEditor)).toBe("current line");
    expect(getSuggestedTaskTitle(selectedEditor)).toBe("selected text");

    const emptySelectionEditor = asEditor({
      state: {
        selection: {
          from: 1,
          to: 1,
          empty: true,
          $from: { parent: { textContent: "  current\nline  " } },
        },
        doc: {
          textBetween: () => "ignored",
        },
      },
    });

    expect(getSelectedText(emptySelectionEditor)).toBe("");
    expect(getSuggestedTaskTitle(emptySelectionEditor)).toBe("current line");
  });
});
