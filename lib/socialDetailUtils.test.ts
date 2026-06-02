import { describe, expect, it } from "vitest";
import {
  SOCIAL_POSTS_PAGE_SIZE,
  SOCIAL_REACTION_OPTION_SET,
  SOCIAL_REACTION_OPTIONS,
  buildSocialDetailUrl,
  normalizePostFilter,
  normalizeRole,
  normalizeSocialPanel,
  parsePostImagesJson,
  toAvatarUrl,
  toDateTimeLabel,
  toInitials,
  toTime,
  toUserLabel,
  toViewerSummary,
} from "./socialDetailUtils";

describe("social detail helpers", () => {
  it("normalizes uploaded image JSON safely", () => {
    const parsed = parsePostImagesJson(
      JSON.stringify([
        null,
        { storage_path: "", url: "https://example.com/empty.png" },
        {
          storage_path: " page/post/image-1.png ",
          url: " https://example.com/image-1.png ",
          filename: " ",
          mime_type: "",
          size_bytes: "10.6",
        },
        {
          storage_path: "page/post/image-1.png",
          url: "https://example.com/duplicate.png",
          filename: "duplicate.png",
          mime_type: "image/png",
          size_bytes: 20,
        },
        ...Array.from({ length: 7 }, (_, index) => ({
          storage_path: `page/post/image-${index + 2}.png`,
          url: `https://example.com/image-${index + 2}.png`,
          filename: `image-${index + 2}.png`,
          mime_type: "image/png",
          size_bytes: index + 1,
        })),
      ])
    );

    expect(parsed).toHaveLength(6);
    expect(parsed[0]).toEqual({
      storage_path: "page/post/image-1.png",
      url: "https://example.com/image-1.png",
      filename: "image",
      mime_type: "application/octet-stream",
      size_bytes: 11,
    });
    expect(parsed.map((image) => image.storage_path)).toEqual([
      "page/post/image-1.png",
      "page/post/image-2.png",
      "page/post/image-3.png",
      "page/post/image-4.png",
      "page/post/image-5.png",
      "page/post/image-6.png",
    ]);
    expect(parsePostImagesJson("not json")).toEqual([]);
    expect(parsePostImagesJson(JSON.stringify({ storage_path: "x" }))).toEqual([]);
  });

  it("normalizes people labels, initials, avatars, and viewer summaries", () => {
    expect(toUserLabel({ full_name: "Jane Doe", email: "jane@example.com" })).toBe(
      "Jane Doe"
    );
    expect(toUserLabel({ full_name: "", email: "jane@example.com" })).toBe(
      "jane@example.com"
    );
    expect(toUserLabel(null)).toBe("Unknown user");
    expect(toInitials("Jane Mary Doe")).toBe("JM");
    expect(toInitials("   ")).toBe("NA");
    expect(toAvatarUrl({ avatar_url: " https://example.com/avatar.png " })).toBe(
      "https://example.com/avatar.png"
    );
    expect(toAvatarUrl(null)).toBe("");
    expect(toViewerSummary([])).toBe("No views yet");
    expect(toViewerSummary(["Jane"])).toBe("Seen by Jane");
    expect(toViewerSummary(["Jane", "Sam"])).toBe("Seen by Jane and Sam");
    expect(toViewerSummary(["Jane", "Sam", "Lee"])).toBe("Seen by Jane, Sam +1");
  });

  it("normalizes filter, role, and panel inputs", () => {
    expect(normalizePostFilter("pinned")).toBe("pinned");
    expect(normalizePostFilter("mine")).toBe("mine");
    expect(normalizePostFilter("unread")).toBe("unread");
    expect(normalizePostFilter("anything")).toBe("all");
    expect(normalizeRole("manager")).toBe("manager");
    expect(normalizeRole("owner")).toBe("member");
    expect(normalizeSocialPanel("compose")).toBe("compose");
    expect(normalizeSocialPanel("edit")).toBe("edit");
    expect(normalizeSocialPanel("members")).toBe("none");
  });

  it("builds canonical social detail URLs", () => {
    expect(buildSocialDetailUrl("page-1")).toBe("/social/page-1");
    expect(
      buildSocialDetailUrl(
        "page-1",
        { error: "Needs attention" },
        { q: " team update ", filter: "unread", p: 3, panel: "compose" }
      )
    ).toBe(
      "/social/page-1?q=team+update&filter=unread&p=3&panel=compose&error=Needs+attention"
    );
    expect(
      buildSocialDetailUrl(
        "page-1",
        { success: "Saved" },
        { q: "", filter: "all", p: -4, panel: "none" }
      )
    ).toBe("/social/page-1?success=Saved");
  });

  it("exposes reaction constants and date helpers", () => {
    expect(SOCIAL_POSTS_PAGE_SIZE).toBe(20);
    expect(SOCIAL_REACTION_OPTIONS.length).toBeGreaterThan(0);
    expect(SOCIAL_REACTION_OPTION_SET.has(SOCIAL_REACTION_OPTIONS[0])).toBe(true);
    expect(toDateTimeLabel("not a date")).toBe("Unknown");
    expect(toTime(null)).toBe(0);
    expect(toTime("not a date")).toBe(0);
    expect(toTime("2026-06-02T10:00:00.000Z")).toBe(
      Date.parse("2026-06-02T10:00:00.000Z")
    );
  });
});
