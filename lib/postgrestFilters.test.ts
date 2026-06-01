import { describe, expect, it } from "vitest";
import {
  buildPostgrestIlikeContainsFilter,
  buildPostgrestOrFilter,
  quotePostgrestFilterValue,
} from "./postgrestFilters";

describe("postgrest filter helpers", () => {
  it("quotes values so commas and parentheses stay inside a single filter value", () => {
    expect(buildPostgrestIlikeContainsFilter("title", "ACME, Ltd (north)")).toBe(
      'title.ilike."%ACME, Ltd (north)%"'
    );
  });

  it("escapes quotes, backslashes, and LIKE wildcards in user input", () => {
    expect(buildPostgrestIlikeContainsFilter("content_text", '50%_done "today" \\')).toBe(
      'content_text.ilike."%50\\\\%\\\\_done \\"today\\" \\\\\\\\%"'
    );
  });

  it("normalizes control whitespace and skips empty input", () => {
    expect(buildPostgrestIlikeContainsFilter("email", " \n\t ")).toBeNull();
    expect(buildPostgrestIlikeContainsFilter("email", " jane\t\nsmith ")).toBe(
      'email.ilike."%jane smith%"'
    );
  });

  it("rejects dynamic column syntax", () => {
    expect(() =>
      buildPostgrestIlikeContainsFilter("title.ilike.%anything%,id", "x")
    ).toThrow("Invalid PostgREST filter column");
  });

  it("joins only present filters into an OR expression", () => {
    expect(
      buildPostgrestOrFilter([
        buildPostgrestIlikeContainsFilter("title", "alpha"),
        null,
        buildPostgrestIlikeContainsFilter("details", "beta"),
      ])
    ).toBe('title.ilike."%alpha%",details.ilike."%beta%"');
  });

  it("quotes raw filter values for callers that need lower-level control", () => {
    expect(quotePostgrestFilterValue('a,b("c")\\d')).toBe('"a,b(\\"c\\")\\\\d"');
  });
});
