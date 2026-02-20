import { describe, expect, it } from "vitest";
import { extractPlainText } from "../../../../lib/tiptapText";
import type { HelpGuide } from "../_data/guides";
import {
  buildGuideSingleDoc,
  ensureUniqueGuideRouteSlug,
  normalizeGuideRouteSlugFromTitle,
  parseGuideSingleDoc,
} from "./guideSingleDoc";

function createGuide(): HelpGuide {
  return {
    slug: "sample-guide",
    title: "Sample Guide",
    summary: "Guide summary",
    appPath: "/help",
    audience: "All users",
    estimatedTime: "5 min",
    keywords: ["sample"],
    prerequisites: ["Signed in"],
    related: [],
    sections: [
      {
        id: "intro",
        title: "Intro",
        content: {
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "Body paragraph one." }],
            },
          ],
        },
      },
      {
        id: "details",
        title: "Details",
        content: {
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "Body paragraph two." }],
            },
          ],
        },
      },
    ],
  };
}

function collectLinkHrefs(value: unknown, results: string[] = []) {
  if (!value) return results;
  if (Array.isArray(value)) {
    value.forEach((item) => collectLinkHrefs(item, results));
    return results;
  }
  if (typeof value !== "object") {
    return results;
  }
  const node = value as { marks?: unknown; attrs?: unknown; content?: unknown };
  if (Array.isArray(node.marks)) {
    node.marks.forEach((mark) => {
      if (!mark || typeof mark !== "object") return;
      const typedMark = mark as { type?: unknown; attrs?: unknown };
      if (typedMark.type !== "link" || !typedMark.attrs || typeof typedMark.attrs !== "object") {
        return;
      }
      const href = String((typedMark.attrs as { href?: unknown }).href || "").trim();
      if (href) {
        results.push(href);
      }
    });
  }
  if (node.content) {
    collectLinkHrefs(node.content, results);
  }
  return results;
}

describe("guide single-document helpers", () => {
  it("builds a document with metadata label lines", () => {
    const guide = createGuide();
    const doc = buildGuideSingleDoc(guide);
    const text = extractPlainText(doc);

    expect(text).toContain("Title: Sample Guide");
    expect(text).toContain("Summary: Guide summary");
    expect(text).toContain("Audience: All users");
    expect(text).toContain("Estimated time: 5 min");
  });

  it("parses metadata updates from labeled lines", () => {
    const guide = createGuide();
    const doc = buildGuideSingleDoc(guide);
    const nodes = Array.isArray((doc as { content?: unknown }).content)
      ? ((doc as { content: unknown[] }).content as Array<Record<string, unknown>>)
      : [];

    nodes[0] = {
      type: "paragraph",
      content: [{ type: "text", text: "Title: Better Guide Name" }],
    };
    nodes[1] = {
      type: "paragraph",
      content: [{ type: "text", text: "Summary: Updated summary text" }],
    };
    nodes[2] = {
      type: "paragraph",
      content: [{ type: "text", text: "Audience: Account managers" }],
    };
    nodes[3] = {
      type: "paragraph",
      content: [{ type: "text", text: "Estimated time: 18 min" }],
    };

    const parsed = parseGuideSingleDoc(doc, guide);
    expect(parsed.title).toBe("Better Guide Name");
    expect(parsed.summary).toBe("Updated summary text");
    expect(parsed.audience).toBe("Account managers");
    expect(parsed.estimatedTime).toBe("18 min");
    expect(parsed.slug).toBe("better-guide-name");
  });

  it("falls back to previous metadata when labels are blank or missing", () => {
    const guide = createGuide();
    const parsed = parseGuideSingleDoc(
      {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "Title: " }],
          },
          {
            type: "paragraph",
            content: [{ type: "text", text: "Random line that is not metadata" }],
          },
        ],
      },
      guide
    );

    expect(parsed.title).toBe(guide.title);
    expect(parsed.summary).toBe(guide.summary);
    expect(parsed.audience).toBe(guide.audience);
    expect(parsed.estimatedTime).toBe(guide.estimatedTime);
  });

  it("round-trips body content without losing paragraph text", () => {
    const guide = createGuide();
    const doc = buildGuideSingleDoc(guide);
    const parsed = parseGuideSingleDoc(doc, guide);
    const sectionText = parsed.sections.map((section) => extractPlainText(section.content)).join(" ");

    expect(sectionText).toContain("Body paragraph one.");
    expect(sectionText).toContain("Body paragraph two.");
  });

  it("preserves section links as clickable link marks during build and parse", () => {
    const guide = createGuide();
    guide.sections[0].links = [
      {
        label: "Download Outlook setup file (manifest.xml)",
        href: "/downloads/outlook-manifest.xml",
      },
    ];

    const doc = buildGuideSingleDoc(guide);
    const linksInDoc = collectLinkHrefs(doc);
    expect(linksInDoc).toContain("/api/help/downloads/outlook-manifest.xml");

    const parsed = parseGuideSingleDoc(doc, guide);
    expect(parsed.sections[0].links?.length || 0).toBe(1);
    expect(parsed.sections[0].links?.[0]?.href).toBe("/api/help/downloads/outlook-manifest.xml");
  });

  it("recovers legacy download-links text blocks into structured section links", () => {
    const guide = createGuide();
    const parsed = parseGuideSingleDoc(
      {
        type: "doc",
        content: [
          { type: "paragraph", content: [{ type: "text", text: "Title: Sample Guide" }] },
          { type: "paragraph", content: [{ type: "text", text: "Summary: Guide summary" }] },
          { type: "paragraph", content: [{ type: "text", text: "Audience: All users" }] },
          { type: "paragraph", content: [{ type: "text", text: "Estimated time: 5 min" }] },
          { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Intro" }] },
          { type: "paragraph", content: [{ type: "text", text: "Body paragraph one." }] },
          { type: "paragraph", content: [{ type: "text", text: "Download links" }] },
          {
            type: "bulletList",
            content: [
              {
                type: "listItem",
                content: [
                  {
                    type: "paragraph",
                    content: [
                      {
                        type: "text",
                        text: "Download Outlook setup file (manifest.xml): /downloads/outlook-manifest.xml",
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
      guide
    );

    expect(parsed.sections[0].links?.length || 0).toBe(1);
    expect(parsed.sections[0].links?.[0]?.href).toBe("/api/help/downloads/outlook-manifest.xml");
    expect(extractPlainText(parsed.sections[0].content)).not.toContain("/downloads/outlook-manifest.xml");
  });

  it("normalizes title to route slug with safe fallback", () => {
    expect(normalizeGuideRouteSlugFromTitle("  My Fresh Guide  ")).toBe("my-fresh-guide");
    expect(normalizeGuideRouteSlugFromTitle("!!!")).toBe("guide");
  });

  it("adds numeric suffix when slug is already used", () => {
    const used = new Set(["guide", "guide-2", "guide-3"]);
    expect(ensureUniqueGuideRouteSlug("Guide", used)).toBe("guide-4");
  });
});
