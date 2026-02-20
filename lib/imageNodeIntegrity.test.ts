import { describe, expect, it } from "vitest";
import {
  fillMissingImageSrcFromQueue,
  removeMissingSrcImageNodes,
  summarizeImageNodes,
} from "./imageNodeIntegrity";

describe("imageNodeIntegrity", () => {
  it("counts missing image sources in mixed documents", () => {
    const doc = {
      type: "doc",
      content: [
        { type: "image", attrs: { src: "https://example.com/a.png" } },
        { type: "image" },
        { type: "customImage", attrs: {} },
        { type: "paragraph", content: [{ type: "text", text: "hello" }] },
      ],
    };

    const summary = summarizeImageNodes(doc);
    expect(summary.total).toBe(3);
    expect(summary.missingSrc).toBe(2);
    expect(summary.http).toBe(1);
  });

  it("fills missing image src values from queue in FIFO order", () => {
    const doc = {
      type: "doc",
      content: [
        { type: "image" },
        { type: "image", attrs: { src: "https://example.com/existing.png" } },
        { type: "customImage", attrs: {} },
        { type: "image" },
      ],
    };

    const repaired = fillMissingImageSrcFromQueue(doc, [
      "https://example.com/one.png",
      "https://example.com/two.png",
    ]);

    const summary = summarizeImageNodes(repaired.content);
    expect(repaired.fixedCount).toBe(2);
    expect(repaired.unresolvedCount).toBe(1);
    expect(repaired.remainingQueue).toEqual([]);
    expect(summary.total).toBe(4);
    expect(summary.missingSrc).toBe(1);
    expect(summary.http).toBe(3);
  });

  it("does not modify valid image nodes when no src is missing", () => {
    const doc = {
      type: "doc",
      content: [
        { type: "image", attrs: { src: "https://example.com/a.png" } },
        { type: "noteImage", attrs: { src: "/uploads/b.png" } },
      ],
    };

    const repaired = fillMissingImageSrcFromQueue(doc, ["https://example.com/unused.png"]);
    expect(repaired.fixedCount).toBe(0);
    expect(repaired.unresolvedCount).toBe(0);
    expect(repaired.remainingQueue).toEqual(["https://example.com/unused.png"]);
    expect(summarizeImageNodes(repaired.content).missingSrc).toBe(0);
  });

  it("removes missing-src image nodes", () => {
    const doc = {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "before" }] },
        { type: "image" },
        {
          type: "callout",
          content: [{ type: "customImage", attrs: {} }],
        },
        { type: "image", attrs: { src: "https://example.com/ok.png" } },
      ],
    };

    const cleaned = removeMissingSrcImageNodes(doc);
    const summary = summarizeImageNodes(cleaned.content);
    expect(cleaned.removedCount).toBe(2);
    expect(summary.total).toBe(1);
    expect(summary.missingSrc).toBe(0);
  });

  it("handles mixed image-like node types consistently", () => {
    const doc = {
      type: "doc",
      content: [
        { type: "profileImage", attrs: { src: "data:image/png;base64,abc" } },
        { type: "imageWidget", attrs: { src: "blob:https://example.com/blob-id" } },
        { type: "legacy_image_node" },
      ],
    };

    const summary = summarizeImageNodes(doc);
    expect(summary.total).toBe(3);
    expect(summary.data).toBe(1);
    expect(summary.blob).toBe(1);
    expect(summary.missingSrc).toBe(1);
  });
});
