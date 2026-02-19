import { describe, expect, it } from "vitest";
import {
  HELP_GUIDES,
  getHelpGuideSearchText,
  normalizeHelpGuide,
  normalizeHelpGuideSection,
} from "./guides";
import { extractPlainText } from "../../../../lib/tiptapText";

function createBaseGuide() {
  return {
    slug: "sample-guide",
    title: "Sample Guide",
    summary: "Guide summary",
    appPath: "/tasks",
    audience: "All users",
    estimatedTime: "5 min",
    keywords: ["tasks"],
    prerequisites: ["Signed in"],
    related: [],
  };
}

describe("help guide normalization", () => {
  it("converts legacy section summary/steps/tips into rich content", () => {
    const section = normalizeHelpGuideSection({
      id: "legacy-section",
      title: "Legacy section",
      summary: "Legacy summary",
      steps: ["First step", "Second step"],
      tips: ["Helpful tip"],
    });

    expect(section).not.toBeNull();
    expect(extractPlainText(section?.content)).toContain("Legacy summary");
    expect(extractPlainText(section?.content)).toContain("First step");
    expect(extractPlainText(section?.content)).toContain("Helpful tip");
  });

  it("normalizes guides that already use rich section content", () => {
    const guide = normalizeHelpGuide({
      ...createBaseGuide(),
      sections: [
        {
          id: "rich",
          title: "Rich section",
          content: {
            type: "doc",
            content: [
              {
                type: "paragraph",
                content: [{ type: "text", text: "Formatted text content" }],
              },
            ],
          },
        },
      ],
    });

    expect(guide).not.toBeNull();
    expect(extractPlainText(guide?.sections[0]?.content)).toContain("Formatted text content");
  });

  it("rejects invalid guide payloads", () => {
    const missingRequiredFields = normalizeHelpGuide({
      slug: "invalid-guide",
      title: "",
      summary: "",
      sections: [],
    });
    expect(missingRequiredFields).toBeNull();

    const invalidRichContent = normalizeHelpGuide({
      ...createBaseGuide(),
      sections: [
        {
          id: "bad",
          title: "Bad section",
          content: {
            type: "paragraph",
          },
        },
      ],
    });
    expect(invalidRichContent).toBeNull();
  });

  it("builds search text from rich section content", () => {
    const guide = normalizeHelpGuide({
      ...createBaseGuide(),
      sections: [
        {
          id: "search-rich",
          title: "Search section",
          content: {
            type: "doc",
            content: [
              {
                type: "paragraph",
                content: [{ type: "text", text: "Critical searchable phrase" }],
              },
            ],
          },
        },
      ],
    });

    expect(guide).not.toBeNull();
    expect(getHelpGuideSearchText(guide!)).toContain("critical searchable phrase");
  });

  it("keeps built-in guides normalized with rich section content", () => {
    expect(HELP_GUIDES.length).toBeGreaterThan(0);
    HELP_GUIDES.forEach((guide) => {
      expect(guide.sections.length).toBeGreaterThan(0);
      guide.sections.forEach((section) => {
        expect(section.content).toBeTruthy();
        expect(extractPlainText(section.content).length).toBeGreaterThan(0);
      });
    });
  });
});

