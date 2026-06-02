import { describe, expect, it } from "vitest";
import {
  SOCIAL_POSTS_PAGE_SIZE,
  SOCIAL_REACTION_OPTION_SET,
  SOCIAL_REACTION_OPTIONS,
  buildSocialMemberUserIdSet,
  buildSocialReactionSummary,
  buildSocialDetailUrl,
  buildSocialUserMap,
  buildSocialViewerLabels,
  getAvailableSocialGroups,
  getAvailableSocialUsers,
  groupSocialRowsByKey,
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

  it("builds social user maps and available member options", () => {
    const owner = {
      id: "owner",
      full_name: "Owner",
      email: "owner@example.com",
      status: "active",
      avatar_url: null,
    };
    const participant = {
      id: "participant",
      full_name: "Participant",
      email: "participant@example.com",
      status: "active",
      avatar_url: null,
    };
    const available = {
      id: "available",
      full_name: "Available",
      email: "available@example.com",
      status: "active",
      avatar_url: null,
    };

    const userById = buildSocialUserMap({
      participantUsers: [participant],
      allUsers: [owner, participant, available],
    });
    expect(userById.get("participant")).toBe(participant);
    expect(userById.get("available")).toBe(available);

    const memberUserIds = buildSocialMemberUserIdSet({
      members: [{ user_id: "participant" }],
      ownerUserId: "owner",
    });
    expect(Array.from(memberUserIds).sort()).toEqual(["owner", "participant"]);
    expect(
      getAvailableSocialUsers({
        canManagePage: true,
        allUsers: [participant, available, owner],
        ownerUserId: "owner",
        memberUserIds,
      }).map((user) => user.id)
    ).toEqual(["available"]);
    expect(
      getAvailableSocialUsers({
        canManagePage: false,
        allUsers: [available],
        ownerUserId: "owner",
        memberUserIds,
      })
    ).toEqual([]);

    expect(
      getAvailableSocialGroups({
        canManagePage: true,
        groups: [
          { id: "covered", memberUserIds: ["owner", "participant"] },
          { id: "open", memberUserIds: ["participant", "available"] },
        ],
        ownerUserId: "owner",
        memberUserIds,
      }).map((group) => group.id)
    ).toEqual(["open"]);
  });

  it("groups social rows and summarizes reactions/viewers", () => {
    expect(
      Array.from(
        groupSocialRowsByKey(
          [
            { post_id: "post-1", value: "a" },
            { post_id: "post-1", value: "b" },
            { post_id: "", value: "ignored" },
            { post_id: "post-2", value: "c" },
          ],
          (row) => row.post_id
        ).entries()
      )
    ).toEqual([
      [
        "post-1",
        [
          { post_id: "post-1", value: "a" },
          { post_id: "post-1", value: "b" },
        ],
      ],
      ["post-2", [{ post_id: "post-2", value: "c" }]],
    ]);

    expect(
      buildSocialReactionSummary(
        [
          { emoji: SOCIAL_REACTION_OPTIONS[0], user_id: "current" },
          { emoji: SOCIAL_REACTION_OPTIONS[0], user_id: "other" },
          { emoji: SOCIAL_REACTION_OPTIONS[1], user_id: "other" },
          { emoji: "not-rendered", user_id: "other" },
        ],
        "current"
      )
    ).toEqual([
      { emoji: SOCIAL_REACTION_OPTIONS[0], count: 2, active: true },
      { emoji: SOCIAL_REACTION_OPTIONS[1], count: 1, active: false },
    ]);
    expect(
      buildSocialReactionSummary(
        [
          { emoji: SOCIAL_REACTION_OPTIONS[0], user_id: "current" },
          { emoji: "not-rendered", user_id: "current" },
        ],
        "current",
        { includeUnknown: true }
      )
    ).toEqual([
      { emoji: SOCIAL_REACTION_OPTIONS[0], count: 1, active: true },
      { emoji: "not-rendered", count: 1, active: true },
    ]);

    const userById = new Map([
      [
        "current",
        {
          id: "current",
          full_name: "Current User",
          email: "current@example.com",
          status: "active",
          avatar_url: null,
        },
      ],
      [
        "other",
        {
          id: "other",
          full_name: "Other User",
          email: "other@example.com",
          status: "active",
          avatar_url: null,
        },
      ],
    ]);
    expect(
      buildSocialViewerLabels({
        views: [
          { post_id: "post-1", user_id: "other", viewed_at: "2026-06-02T11:00:00.000Z" },
          { post_id: "post-1", user_id: "current", viewed_at: "2026-06-02T10:00:00.000Z" },
        ],
        postId: "post-1",
        currentUserId: "current",
        userById,
      })
    ).toEqual(["Other User", "Current User"]);
  });
});
