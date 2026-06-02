import { describe, expect, it } from "vitest";
import {
  buildSocialListUrl,
  normalizeSocialPageNumber,
} from "./socialListPageUtils";

describe("social list page helpers", () => {
  it("normalizes invalid page numbers to the first page", () => {
    expect(normalizeSocialPageNumber(undefined)).toBe(1);
    expect(normalizeSocialPageNumber("0")).toBe(1);
    expect(normalizeSocialPageNumber("-4")).toBe(1);
    expect(normalizeSocialPageNumber("2.5")).toBe(1);
    expect(normalizeSocialPageNumber("4")).toBe(4);
  });

  it("builds compact social list urls", () => {
    expect(buildSocialListUrl()).toBe("/social");
    expect(buildSocialListUrl(1)).toBe("/social");
    expect(buildSocialListUrl(3)).toBe("/social?page=3");
  });
});
