import { describe, expect, it, vi } from "vitest";
import {
  buildExistingDirectConversationIdByUserId,
  buildMembersByConversationId,
  buildMessagesById,
  buildMyMembershipByConversationId,
  buildReadReceiptsByMessageId,
  buildSearchableConversationTextById,
  buildUserLookup,
  chatUrl,
  filterConversationsBySearchTerm,
  formatConversationTime,
  formatMessageDayLabel,
  formatMessageTime,
  getConversationDisplayTitle,
  getFirstUnreadMessageId,
  getInitials,
  getUserAvatarUrl,
  getUserDisplayName,
  isSameCalendarDay,
  mergeMessages,
  messageLinkHref,
  messageSyncCursor,
  normalizeConversationMember,
  parseReplyBody,
  renderPreviewText,
  sortConversationsByPinnedPriority,
  sortMessagesAsc,
  splitReadReceiptsByStatus,
  toMessageSnippet,
  toMs,
  type ConversationMemberRow,
  type ConversationRow,
  type MessageRow,
  type UserRow,
} from "./chatClientUtils";

function message(overrides: Partial<MessageRow> = {}): MessageRow {
  return {
    id: "message-1",
    conversation_id: "conversation-1",
    sender_id: "user-1",
    body: "Hello",
    created_at: "2026-06-02T09:00:00.000Z",
    edited_at: null,
    deleted_at: null,
    links: [],
    attachments: [],
    reactions: [],
    ...overrides,
  };
}

function conversation(overrides: Partial<ConversationRow> = {}): ConversationRow {
  return {
    id: "conversation-1",
    type: "direct",
    title: null,
    created_by: "user-1",
    created_at: "2026-06-02T09:00:00.000Z",
    ...overrides,
  };
}

function member(overrides: Partial<ConversationMemberRow> = {}): ConversationMemberRow {
  return {
    conversation_id: "conversation-1",
    user_id: "user-1",
    role: "member",
    last_read_at: null,
    is_pinned: false,
    is_muted: false,
    ...overrides,
  };
}

function user(overrides: Partial<UserRow> = {}): UserRow {
  return {
    id: "user-1",
    full_name: "Jane User",
    email: "jane@example.com",
    avatar_url: null,
    ...overrides,
  };
}

describe("chat client helpers", () => {
  it("sorts messages by created time without mutating the input", () => {
    const messages = [
      message({ id: "late", created_at: "2026-06-02T12:00:00.000Z" }),
      message({ id: "early", created_at: "2026-06-02T08:00:00.000Z" }),
      message({ id: "invalid", created_at: "not a date" }),
    ];

    const sorted = sortMessagesAsc(messages);

    expect(sorted.map((row) => row.id)).toEqual(["invalid", "early", "late"]);
    expect(messages.map((row) => row.id)).toEqual(["late", "early", "invalid"]);
    expect(toMs("not a date")).toBe(0);
  });

  it("uses edits and deletes when calculating the sync cursor", () => {
    expect(
      messageSyncCursor([
        message({ id: "created", created_at: "2026-06-02T09:00:00.000Z" }),
        message({
          id: "edited",
          created_at: "2026-06-02T08:00:00.000Z",
          edited_at: "2026-06-02T11:00:00.000Z",
        }),
        message({
          id: "deleted",
          created_at: "2026-06-02T07:00:00.000Z",
          deleted_at: "2026-06-02T10:00:00.000Z",
        }),
      ])
    ).toBe("2026-06-02T11:00:00.000Z");
  });

  it("merges incoming messages by id and keeps chronological order", () => {
    const current = [
      message({ id: "existing", body: "old", created_at: "2026-06-02T09:00:00.000Z" }),
      message({ id: "later", created_at: "2026-06-02T12:00:00.000Z" }),
    ];
    const merged = mergeMessages(current, [
      message({ id: "existing", body: "new", created_at: "2026-06-02T09:30:00.000Z" }),
      message({ id: "earlier", created_at: "2026-06-02T08:00:00.000Z" }),
    ]);

    expect(merged.map((row) => `${row.id}:${row.body}`)).toEqual([
      "earlier:Hello",
      "existing:new",
      "later:Hello",
    ]);
    expect(mergeMessages(current, [])).toBe(current);
  });

  it("normalizes members and user display metadata", () => {
    expect(
      normalizeConversationMember({
        conversation_id: "conversation-1",
        user_id: "user-1",
        role: "member",
        last_read_at: null,
        is_pinned: null,
        is_muted: true,
      })
    ).toMatchObject({ is_pinned: false, is_muted: true });

    expect(
      getUserDisplayName({
        id: "user-1",
        full_name: "",
        email: "jane@example.com",
        avatar_url: " https://example.com/avatar.png ",
      })
    ).toBe("jane@example.com");
    expect(getUserDisplayName(null)).toBe("Unknown user");
    expect(getInitials("Jane Mary Doe")).toBe("JM");
    expect(getInitials("  ")).toBe("NA");
    expect(
      getUserAvatarUrl({
        id: "user-1",
        full_name: null,
        email: null,
        avatar_url: " https://example.com/avatar.png ",
      })
    ).toBe("https://example.com/avatar.png");
  });

  it("builds conversation lookup maps and pinned priority ordering", () => {
    const users = [
      user({ id: "user-1", full_name: "Current User" }),
      user({ id: "user-2", full_name: "Other User" }),
    ];
    const members = [
      member({ conversation_id: "regular-muted", user_id: "user-1", is_muted: true }),
      member({ conversation_id: "pinned-muted", user_id: "user-1", is_pinned: true, is_muted: true }),
      member({ conversation_id: "regular-unmuted", user_id: "user-1" }),
      member({ conversation_id: "pinned-unmuted", user_id: "user-1", is_pinned: true }),
      member({ conversation_id: "pinned-unmuted", user_id: "user-2" }),
    ];
    const conversations = [
      conversation({ id: "regular-muted" }),
      conversation({ id: "pinned-muted" }),
      conversation({ id: "regular-unmuted" }),
      conversation({ id: "pinned-unmuted" }),
    ];

    expect(buildUserLookup(users)).toEqual({
      "user-1": users[0],
      "user-2": users[1],
    });
    expect(buildMembersByConversationId(members)).toMatchObject({
      "pinned-unmuted": [
        { conversation_id: "pinned-unmuted", user_id: "user-1" },
        { conversation_id: "pinned-unmuted", user_id: "user-2" },
      ],
    });
    const myMembershipByConversationId = buildMyMembershipByConversationId({
      members,
      currentUserId: "user-1",
    });
    expect(Object.keys(myMembershipByConversationId).sort()).toEqual([
      "pinned-muted",
      "pinned-unmuted",
      "regular-muted",
      "regular-unmuted",
    ]);
    expect(
      sortConversationsByPinnedPriority({
        conversations,
        myMembershipByConversationId,
      }).map((row) => row.id)
    ).toEqual([
      "pinned-unmuted",
      "pinned-muted",
      "regular-unmuted",
      "regular-muted",
    ]);
  });

  it("builds chat and linked-entity URLs", () => {
    expect(chatUrl({})).toBe("/chat");
    expect(chatUrl({ c: "conversation 1" })).toBe("/chat?c=conversation+1");
    expect(messageLinkHref("task", "task-1")).toBe("/tasks/task-1");
    expect(messageLinkHref("project", "project-1")).toBe("/projects/project-1");
    expect(messageLinkHref("client", "client-1")).toBe("/clients/client-1");
    expect(messageLinkHref("feature_suggestion", "feature 1")).toBe(
      "/feature-suggestions?open=feature%201"
    );
    expect(messageLinkHref("note", "note-1")).toBe("/notes");
  });

  it("builds conversation titles, search text, and direct-chat lookup maps", () => {
    const usersById = {
      "user-1": user({ id: "user-1", full_name: "Current User" }),
      "user-2": user({ id: "user-2", full_name: "Sam Teammate" }),
      "user-3": user({ id: "user-3", full_name: null, email: "lee@example.com" }),
    };
    const conversations = [
      conversation({ id: "direct-1", type: "direct" }),
      conversation({ id: "direct-2", type: "direct" }),
      conversation({ id: "group-1", type: "group", title: "" }),
    ];
    const membersByConversationId = {
      "direct-1": [
        member({ conversation_id: "direct-1", user_id: "user-1" }),
        member({ conversation_id: "direct-1", user_id: "user-2" }),
      ],
      "direct-2": [
        member({ conversation_id: "direct-2", user_id: "user-1" }),
        member({ conversation_id: "direct-2", user_id: "user-3" }),
      ],
      "group-1": [
        member({ conversation_id: "group-1", user_id: "user-1" }),
        member({ conversation_id: "group-1", user_id: "user-2" }),
      ],
    };

    expect(
      getConversationDisplayTitle({
        conversation: conversations[0],
        membersByConversationId,
        currentUserId: "user-1",
        userById: usersById,
      })
    ).toBe("Sam Teammate");
    expect(
      getConversationDisplayTitle({
        conversation: conversations[2],
        membersByConversationId,
        currentUserId: "user-1",
        userById: usersById,
      })
    ).toBe("Untitled group");

    expect(
      buildExistingDirectConversationIdByUserId({
        conversations,
        membersByConversationId,
        currentUserId: "user-1",
      })
    ).toEqual({ "user-2": "direct-1", "user-3": "direct-2" });

    expect(
      buildSearchableConversationTextById({
        conversations,
        membersByConversationId,
        currentUserId: "user-1",
        userById: usersById,
        latestByConversationId: {
          "direct-1": message({
            id: "latest-1",
            conversation_id: "direct-1",
            sender_id: "user-2",
            body: "Need a callback",
          }),
          "direct-2": null,
          "group-1": message({
            id: "latest-2",
            conversation_id: "group-1",
            sender_id: "user-1",
            body: "",
            deleted_at: "2026-06-02T10:00:00.000Z",
          }),
        },
      })
    ).toMatchObject({
      "direct-1": "sam teammate sam teammate need a callback",
      "direct-2": "lee@example.com  ",
      "group-1": "untitled group current user message deleted",
    });

    const searchableTextById = {
      "direct-1": "sam teammate callback",
      "direct-2": "lee@example.com",
      "group-1": "untitled group",
    };
    expect(
      filterConversationsBySearchTerm({
        conversations,
        searchableConversationTextById: searchableTextById,
        searchTerm: " CALLBACK ",
      }).map((row) => row.id)
    ).toEqual(["direct-1"]);
    expect(
      filterConversationsBySearchTerm({
        conversations,
        searchableConversationTextById: searchableTextById,
        searchTerm: "",
      })
    ).toBe(conversations);
  });

  it("finds unread anchors and builds read receipts for sent messages", () => {
    const messages = [
      message({
        id: "mine",
        sender_id: "user-1",
        created_at: "2026-06-02T09:00:00.000Z",
      }),
      message({
        id: "theirs-before",
        sender_id: "user-2",
        created_at: "2026-06-02T09:15:00.000Z",
      }),
      message({
        id: "theirs-after",
        sender_id: "user-2",
        created_at: "2026-06-02T10:15:00.000Z",
      }),
      message({
        id: "deleted-after",
        sender_id: "user-2",
        created_at: "2026-06-02T10:30:00.000Z",
        deleted_at: "2026-06-02T10:31:00.000Z",
      }),
    ];

    expect(
      getFirstUnreadMessageId({
        messages,
        anchorValue: "2026-06-02T10:00:00.000Z",
        currentUserId: "user-1",
      })
    ).toBe("theirs-after");
    expect(
      getFirstUnreadMessageId({
        messages,
        anchorValue: null,
        currentUserId: "user-1",
      })
    ).toBeNull();

    const readReceiptsByMessageId = buildReadReceiptsByMessageId({
      messages: [
        messages[0],
        message({
          id: "failed",
          sender_id: "user-1",
          client_status: "failed",
        }),
        message({
          id: "received",
          sender_id: "user-2",
        }),
      ],
      members: [
        member({ user_id: "user-1" }),
        member({
          user_id: "user-3",
          last_read_at: "2026-06-02T09:30:00.000Z",
        }),
        member({
          user_id: "user-2",
          last_read_at: "2026-06-02T08:30:00.000Z",
        }),
      ],
      currentUserId: "user-1",
      userById: {
        "user-2": user({ id: "user-2", full_name: "Ben Reader" }),
        "user-3": user({
          id: "user-3",
          full_name: "Amy Reader",
          avatar_url: " https://example.com/amy.png ",
        }),
      },
    });
    expect(readReceiptsByMessageId).toEqual({
      mine: [
        {
          userId: "user-3",
          name: "Amy Reader",
          avatarUrl: "https://example.com/amy.png",
          hasRead: true,
          lastReadAt: "2026-06-02T09:30:00.000Z",
        },
        {
          userId: "user-2",
          name: "Ben Reader",
          avatarUrl: "",
          hasRead: false,
          lastReadAt: "2026-06-02T08:30:00.000Z",
        },
      ],
    });
    expect(splitReadReceiptsByStatus(readReceiptsByMessageId.mine)).toEqual({
      read: [
        {
          userId: "user-3",
          name: "Amy Reader",
          avatarUrl: "https://example.com/amy.png",
          hasRead: true,
          lastReadAt: "2026-06-02T09:30:00.000Z",
        },
      ],
      unread: [
        {
          userId: "user-2",
          name: "Ben Reader",
          avatarUrl: "",
          hasRead: false,
          lastReadAt: "2026-06-02T08:30:00.000Z",
        },
      ],
    });
  });

  it("builds message lookup maps", () => {
    const messages = [
      message({ id: "first", body: "One" }),
      message({ id: "second", body: "Two" }),
    ];

    expect(buildMessagesById(messages)).toMatchObject({
      first: { body: "One" },
      second: { body: "Two" },
    });
  });

  it("parses reply prefixes and strips them from previews", () => {
    const replyId = "01234567-89ab-cdef-0123-456789abcdef";

    expect(parseReplyBody(`[[reply:${replyId.toUpperCase()}]]\nThanks`)).toEqual({
      replyToMessageId: replyId,
      cleanBody: "Thanks",
    });
    expect(parseReplyBody("[[reply:not-a-uuid]]\nNope")).toEqual({
      replyToMessageId: null,
      cleanBody: "[[reply:not-a-uuid]]\nNope",
    });
    expect(
      renderPreviewText(
        message({
          body: `[[reply:${replyId}]]\nFollow up`,
        })
      )
    ).toBe("Follow up");
  });

  it("creates snippets with body, attachment, link, and long-text fallbacks", () => {
    expect(
      toMessageSnippet(
        message({
          body: "  Hello\n\nthere  ",
        })
      )
    ).toBe("Hello there");
    expect(
      toMessageSnippet(
        message({
          body: "",
          attachments: [
            {
              id: "attachment-1",
              message_id: "message-1",
              storage_path: "chat/file.png",
              filename: "file.png",
              mime_type: "image/png",
              size_bytes: 10,
              url: null,
            },
          ],
        })
      )
    ).toBe("sent an attachment");
    expect(
      toMessageSnippet(
        message({
          body: "",
          links: [
            {
              id: "link-1",
              entity_type: "task",
              entity_id: "task-1",
              label: "Task",
              href: "/tasks/task-1",
            },
          ],
        })
      )
    ).toBe("shared a link");
    expect(toMessageSnippet(message({ body: "x".repeat(130) }))).toHaveLength(120);
  });

  it("formats invalid dates as blank and compares valid calendar days", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 5, 2, 9, 0, 0));

    expect(formatMessageTime("not a date")).toBe("");
    expect(formatConversationTime("not a date")).toBe("");
    expect(formatMessageDayLabel("not a date")).toBe("");
    expect(formatConversationTime(new Date(2026, 5, 2, 8, 30, 0).toISOString())).toBe(
      "8:30 AM"
    );
    expect(
      isSameCalendarDay(
        new Date(2026, 5, 2, 8, 30, 0).toISOString(),
        new Date(2026, 5, 2, 17, 30, 0).toISOString()
      )
    ).toBe(true);
    expect(isSameCalendarDay("not a date", "2026-06-02T09:00:00.000Z")).toBe(false);

    vi.useRealTimers();
  });
});
