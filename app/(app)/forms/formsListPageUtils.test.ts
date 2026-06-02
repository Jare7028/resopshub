import { describe, expect, it } from "vitest";
import {
  buildFormsListUrl,
  normalizeFormsPageNumber,
  normalizeFormsSortDir,
  normalizeFormsSortKey,
} from "./formsListPageUtils";

describe("forms list page helpers", () => {
  it("normalizes invalid page numbers to the first page", () => {
    expect(normalizeFormsPageNumber(undefined)).toBe(1);
    expect(normalizeFormsPageNumber("0")).toBe(1);
    expect(normalizeFormsPageNumber("-2")).toBe(1);
    expect(normalizeFormsPageNumber("2.5")).toBe(1);
    expect(normalizeFormsPageNumber("3")).toBe(3);
  });

  it("defaults sort direction by sort key", () => {
    expect(normalizeFormsSortDir(undefined, "title")).toBe("asc");
    expect(normalizeFormsSortDir(undefined, "status")).toBe("asc");
    expect(normalizeFormsSortDir(undefined, "open_submissions")).toBe("desc");
    expect(normalizeFormsSortDir("asc", "updated_at")).toBe("asc");
  });

  it("falls back to updated_at for unknown sort keys", () => {
    expect(normalizeFormsSortKey("created_at")).toBe("updated_at");
    expect(normalizeFormsSortKey("title")).toBe("title");
  });

  it("builds list urls while omitting first-page noise", () => {
    expect(
      buildFormsListUrl({
        q: " onboarding ",
        statuses: ["active", "draft"],
        sortKey: "open_submissions",
        sortDir: "desc",
        page: 3,
      })
    ).toBe(
      "/forms?q=onboarding&status=active%2Cdraft&sort=open_submissions&dir=desc&page=3"
    );

    expect(
      buildFormsListUrl({
        q: "",
        statuses: [],
        sortKey: "updated_at",
        sortDir: "desc",
        page: 1,
      })
    ).toBe("/forms?sort=updated_at&dir=desc");
  });
});
