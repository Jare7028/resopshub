import { describe, expect, it } from "vitest";
import {
  buildConnecteamMirrorMessage,
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
