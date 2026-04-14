import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildConnecteamMirrorMessage,
  resolveConnecteamUserIds,
  stripChatReplyMetadata,
} from "./connecteamChatMirror";

describe("stripChatReplyMetadata", () => {
  it("removes the reply token prefix from mirrored messages", () => {
    expect(
      stripChatReplyMetadata(
        "[[reply:123e4567-e89b-12d3-a456-426614174000]]\nFollowing up on this now."
      )
    ).toBe("Following up on this now.");
  });

  it("leaves normal messages unchanged", () => {
    expect(stripChatReplyMetadata("Plain message")).toBe("Plain message");
  });
});

describe("buildConnecteamMirrorMessage", () => {
  it("formats group message context with links, attachments, and a footer", () => {
    const message = buildConnecteamMirrorMessage({
      conversation: {
        id: "conversation-1",
        type: "group",
        title: "Field Team",
      },
      sender: {
        id: "user-1",
        full_name: "Alice Example",
        email: "[email protected]",
      },
      body: "Need eyes on this before end of day.",
      links: [
        { label: "Task 123", href: "/tasks/123" },
        { label: "Project Alpha", href: "/projects/alpha" },
      ],
      attachments: [{ filename: "scope.pdf" }],
      chatUrl: "https://resopshub.example/chat?c=conversation-1",
    });

    expect(message).toContain('Alice Example posted in "Field Team" via ResOpsHub');
    expect(message).toContain("Need eyes on this before end of day.");
    expect(message).toContain("Links: Task 123, Project Alpha");
    expect(message).toContain("Attachments: scope.pdf");
    expect(message).toContain("Open in ResOpsHub: https://resopshub.example/chat?c=conversation-1");
    expect(message.length).toBeLessThanOrEqual(1000);
  });

  it("keeps the footer when truncating long messages", () => {
    const body = Array.from({ length: 300 }, () => "long").join(" ");
    const message = buildConnecteamMirrorMessage({
      conversation: {
        id: "conversation-2",
        type: "direct",
        title: null,
      },
      sender: {
        id: "user-2",
        full_name: "Bob Example",
        email: "[email protected]",
      },
      body,
      chatUrl: "https://resopshub.example/chat?c=conversation-2",
    });

    expect(message).toContain("Open in ResOpsHub: https://resopshub.example/chat?c=conversation-2");
    expect(message.length).toBeLessThanOrEqual(1000);
  });
});

describe("resolveConnecteamUserIds", () => {
  afterEach(() => {
    delete process.env.CONNECTEAM_API_KEY;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("resolves recipients by email and unique full name", async () => {
    process.env.CONNECTEAM_API_KEY = "test-key";
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: async () =>
        JSON.stringify({
          data: {
            users: [
              {
                userId: 101,
                email: "[email protected]",
                fullName: "Alice Example",
              },
              {
                userId: 202,
                firstName: "Bob",
                lastName: "Example",
              },
            ],
          },
        }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const resolved = await resolveConnecteamUserIds([
      {
        id: "user-1",
        full_name: "Alice Example",
        email: "[email protected]",
      },
      {
        id: "user-2",
        full_name: "Bob Example",
        email: null,
      },
    ]);

    expect(resolved.get("user-1")).toBe(101);
    expect(resolved.get("user-2")).toBe(202);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const requestUrl = new URL(String(fetchMock.mock.calls[0]?.[0]));
    expect(requestUrl.searchParams.getAll("emailAddresses")).toEqual(["[email protected]"]);
    expect(requestUrl.searchParams.getAll("fullNames")).toEqual(
      expect.arrayContaining(["Alice Example", "Bob Example"])
    );
  });

  it("skips ambiguous full-name matches", async () => {
    process.env.CONNECTEAM_API_KEY = "test-key";
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: async () =>
        JSON.stringify({
          data: {
            users: [
              {
                userId: 301,
                fullName: "Chris Smith",
              },
              {
                userId: 302,
                firstName: "Chris",
                lastName: "Smith",
              },
            ],
          },
        }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const resolved = await resolveConnecteamUserIds([
      {
        id: "user-3",
        full_name: "Chris Smith",
        email: null,
      },
    ]);

    expect(resolved.has("user-3")).toBe(false);
  });
});
