import { describe, expect, it } from "vitest";
import { sortConversationsByRecentActivity } from "./chatConversations";

describe("sortConversationsByRecentActivity", () => {
  it("orders conversations by latest message timestamp when present", () => {
    const conversations = [
      { id: "a", created_at: "2026-02-10T08:00:00.000Z" },
      { id: "b", created_at: "2026-02-10T09:00:00.000Z" },
      { id: "c", created_at: "2026-02-10T10:00:00.000Z" },
    ];

    const sorted = sortConversationsByRecentActivity(conversations, {
      a: { created_at: "2026-02-15T08:30:00.000Z" },
      b: { created_at: "2026-02-14T11:00:00.000Z" },
      c: null,
    });

    expect(sorted.map((row) => row.id)).toEqual(["a", "b", "c"]);
  });

  it("falls back to conversation created_at when no latest message exists", () => {
    const conversations = [
      { id: "one", created_at: "2026-01-01T00:00:00.000Z" },
      { id: "two", created_at: "2026-01-02T00:00:00.000Z" },
    ];

    const sorted = sortConversationsByRecentActivity(conversations, {
      one: null,
      two: null,
    });

    expect(sorted.map((row) => row.id)).toEqual(["two", "one"]);
  });
});
