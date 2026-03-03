import { describe, expect, it } from "vitest";
import {
  extractMentionHandles,
  getMentionRanges,
  resolveMentionHandlesToRecipients,
  splitTextWithMentions,
} from "./mentions";

describe("extractMentionHandles", () => {
  it("extracts and normalizes @mention handles", () => {
    const text =
      "Ping @Jared, @jared. and @jared@resolvable.com plus support@company.com and (@Amy_B).";

    expect(extractMentionHandles(text)).toEqual([
      "jared",
      "jared@resolvable.com",
      "amy_b",
    ]);
  });

  it("returns unique handles in first-seen order", () => {
    expect(extractMentionHandles("@alex @alex @alex.")).toEqual(["alex"]);
  });
});

describe("resolveMentionHandlesToRecipients", () => {
  it("resolves handles by email/full-name aliases", () => {
    const recipients = resolveMentionHandlesToRecipients(
      ["jared", "amy.jones", "amy", "missing"],
      [
        {
          id: "user-1",
          email: "jared@resolvable.com",
          full_name: "Jared Vance",
        },
        {
          id: "user-2",
          email: "amy@resolvable.com",
          full_name: "Amy Jones",
        },
      ]
    );

    expect(recipients.get("user-1")).toEqual(["jared"]);
    expect(recipients.get("user-2")).toEqual(["amy.jones", "amy"]);
    expect(recipients.has("missing")).toBe(false);
  });

  it("skips ambiguous aliases", () => {
    const recipients = resolveMentionHandlesToRecipients(["sam"], [
      {
        id: "user-1",
        email: "sam.lee@resolvable.com",
        full_name: "Sam Lee",
      },
      {
        id: "user-2",
        email: "sam.jones@resolvable.com",
        full_name: "Sam Jones",
      },
    ]);

    expect(Array.from(recipients.keys())).toEqual([]);
  });
});

describe("getMentionRanges", () => {
  it("captures ranges for valid mentions and ignores email addresses", () => {
    const text = "Ping @Jared, support@company.com and (@amy_b)! plus @x";
    const ranges = getMentionRanges(text);

    expect(ranges.map((range) => range.text)).toEqual(["@Jared", "@amy_b"]);
    expect(ranges.map((range) => range.handle)).toEqual(["jared", "amy_b"]);
  });
});

describe("splitTextWithMentions", () => {
  it("splits text into plain and mention segments while preserving punctuation", () => {
    const segments = splitTextWithMentions("Hi @jared, thanks.");

    expect(segments).toEqual([
      { type: "text", value: "Hi " },
      { type: "mention", value: "@jared" },
      { type: "text", value: ", thanks." },
    ]);
  });
});
