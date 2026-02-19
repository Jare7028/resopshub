import { describe, expect, it } from "vitest";
import {
  BROWSER_CAPTURE_MAX_TEXT_BYTES,
  BrowserTaskCaptureValidationError,
  buildBrowserCaptureNotesText,
  buildBrowserCaptureTaskContent,
  normalizeBrowserCaptureTitle,
  parseBrowserTaskCaptureCreateRequest,
} from "./browserTaskCapture";
import { extractPlainText } from "./tiptapText";

describe("browserTaskCapture", () => {
  it("uses explicit title when provided", () => {
    const parsed = parseBrowserTaskCaptureCreateRequest({
      selectedText: "Need to follow up by Friday",
      title: " Follow up with client ",
      sourceUrl: "https://example.com/thread/123",
      sourceTitle: "Client Thread",
    });
    expect(parsed.title).toBe("Follow up with client");
  });

  it("derives title from selected text when title is omitted", () => {
    const parsed = parseBrowserTaskCaptureCreateRequest({
      selectedText: "Need to follow up by Friday\nAnd send quote",
    });
    expect(parsed.title).toBe("Need to follow up by Friday");
  });

  it("normalizes dueTime and requires dueDate when dueTime is supplied", () => {
    expect(() =>
      parseBrowserTaskCaptureCreateRequest({
        selectedText: "Reminder",
        dueTime: "08:30",
      })
    ).toThrow(BrowserTaskCaptureValidationError);

    const parsed = parseBrowserTaskCaptureCreateRequest({
      selectedText: "Reminder",
      dueDate: "2026-02-19",
      dueTime: "08:30",
    });
    expect(parsed.dueTime).toBe("08:30:00");
  });

  it("rejects invalid source URLs", () => {
    expect(() =>
      parseBrowserTaskCaptureCreateRequest({
        selectedText: "Text",
        sourceUrl: "not-a-url",
      })
    ).toThrow(BrowserTaskCaptureValidationError);
  });

  it("rejects selected text larger than configured byte limit", () => {
    expect(() =>
      parseBrowserTaskCaptureCreateRequest({
        selectedText: "a".repeat(BROWSER_CAPTURE_MAX_TEXT_BYTES + 1),
      })
    ).toThrow(BrowserTaskCaptureValidationError);
  });

  it("builds structured notes text and searchable content", () => {
    const notesText = buildBrowserCaptureNotesText({
      selectedText: "Need to update pricing by Monday.",
      sourceTitle: "Pricing policy",
      sourceUrl: "https://example.com/docs/pricing",
      capturedAtIso: "2026-02-19T12:00:00.000Z",
    });
    expect(notesText).toContain("Source: Browser text capture");
    expect(notesText).toContain("Page title: Pricing policy");
    expect(notesText).toContain("Page URL: https://example.com/docs/pricing");
    expect(notesText).toContain("Selected text:");
    expect(notesText).toContain("Need to update pricing by Monday.");

    const content = buildBrowserCaptureTaskContent({
      selectedText: "Need to update pricing by Monday.",
      sourceTitle: "Pricing policy",
      sourceUrl: "https://example.com/docs/pricing",
      capturedAtIso: "2026-02-19T12:00:00.000Z",
    });
    const text = extractPlainText(content);
    expect(text).toContain("Source: Browser text capture");
    expect(text).toContain("Need to update pricing by Monday.");
  });

  it("falls back to default title when selected text is blank after trimming", () => {
    expect(normalizeBrowserCaptureTitle("", "\n\n")).toBe("Captured task");
  });
});

