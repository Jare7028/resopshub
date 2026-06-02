import { describe, expect, it, vi } from "vitest";
import {
  chatUrl,
  formatConversationTime,
  formatMessageDayLabel,
  formatMessageTime,
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
  sortMessagesAsc,
  toMessageSnippet,
  toMs,
  type MessageRow,
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
