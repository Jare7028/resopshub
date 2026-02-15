import { describe, expect, it } from "vitest";
import { resolveConversationReadAt } from "./chatReadMarker";

describe("resolveConversationReadAt", () => {
  it("uses the latest message timestamp when it is valid", () => {
    const marker = resolveConversationReadAt("2026-02-15T14:10:00.000Z");
    expect(marker).toBe("2026-02-15T14:10:00.000Z");
  });

  it("falls back to now when the latest timestamp is missing", () => {
    const marker = resolveConversationReadAt(
      null,
      new Date("2026-02-15T16:00:00.000Z")
    );
    expect(marker).toBe("2026-02-15T16:00:00.000Z");
  });

  it("falls back to now when the latest timestamp is invalid", () => {
    const marker = resolveConversationReadAt(
      "not-a-date",
      new Date("2026-02-15T17:00:00.000Z")
    );
    expect(marker).toBe("2026-02-15T17:00:00.000Z");
  });
});
