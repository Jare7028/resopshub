import { describe, expect, it } from "vitest";
import {
  filterSlashCommands,
  getMentionMatch,
  getSlashMatch,
  type SlashCommand,
} from "./noteEditorSuggestions";

function createTextMatchEditor(
  text: string,
  options: { from?: number; empty?: boolean } = {}
) {
  const from = typeof options.from === "number" ? options.from : text.length;
  return {
    state: {
      selection: {
        empty: options.empty !== false,
        from,
      },
      doc: {
        textBetween(start: number, end: number) {
          return text.slice(start, end);
        },
      },
    },
  };
}

describe("note editor suggestions", () => {
  it("matches slash commands after whitespace", () => {
    expect(getSlashMatch(createTextMatchEditor("Add a /tab"))).toEqual({
      range: { from: 6, to: 10 },
      query: "tab",
    });
  });

  it("rejects invalid slash command triggers", () => {
    expect(getSlashMatch(createTextMatchEditor("word/table"))).toBeNull();
    expect(getSlashMatch(createTextMatchEditor("Add /two words"))).toBeNull();
    expect(getSlashMatch(createTextMatchEditor(`/${"a".repeat(33)}`))).toBeNull();
    expect(getSlashMatch(createTextMatchEditor("/task", { empty: false }))).toBeNull();
  });

  it("filters slash commands by label or keyword", () => {
    const commands: Array<SlashCommand<string>> = [
      {
        id: "heading",
        label: "Heading",
        description: "Heading block",
        keywords: ["title"],
        run: () => undefined,
      },
      {
        id: "table",
        label: "Table",
        description: "Table block",
        keywords: ["grid", "rows"],
        run: () => undefined,
      },
    ];

    expect(filterSlashCommands(commands, "")).toBe(commands);
    expect(filterSlashCommands(commands, "HEAD").map((command) => command.id)).toEqual([
      "heading",
    ]);
    expect(filterSlashCommands(commands, "grid").map((command) => command.id)).toEqual([
      "table",
    ]);
  });

  it("matches mention triggers and normalizes the query", () => {
    expect(getMentionMatch(createTextMatchEditor("Please ask @Jane.Doe"))).toEqual({
      range: { from: 11, to: 20 },
      query: "jane.doe",
    });
  });

  it("rejects invalid mention triggers", () => {
    expect(getMentionMatch(createTextMatchEditor("email jane@example.com"))).toBeNull();
    expect(getMentionMatch(createTextMatchEditor("@mention", { empty: false }))).toBeNull();
    expect(getMentionMatch(createTextMatchEditor(`@${"a".repeat(128)}`))).toBeNull();
  });
});
