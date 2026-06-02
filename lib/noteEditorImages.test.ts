import { describe, expect, it } from "vitest";

import {
  assertDataUrlSize,
  createImageFileFromBlob,
  extractImageSourcesFromHtml,
  extractSingleLinkFromHtml,
  getImageExtensionFromMimeType,
} from "./noteEditorImages";

describe("note editor image helpers", () => {
  it("maps supported image MIME types to stable extensions", () => {
    expect(getImageExtensionFromMimeType(" image/jpeg ")).toBe("jpg");
    expect(getImageExtensionFromMimeType("image/webp")).toBe("webp");
    expect(getImageExtensionFromMimeType("image/unknown")).toBe("png");
  });

  it("rejects unsupported blob image types before creating files", () => {
    expect(() => createImageFileFromBlob(new Blob(["<svg />"], { type: "image/svg+xml" }))).toThrow(
      /Unsupported image type/
    );
  });

  it("guards data URL byte size", () => {
    expect(() => assertDataUrlSize("data:image/png;base64,small", 100)).not.toThrow();
    expect(() => assertDataUrlSize("", 100)).toThrow(/Unable to read image data/);
    expect(() => assertDataUrlSize("data:image/png;base64,large", 4)).toThrow(/too large/);
  });

  it("returns safe fallbacks when DOMParser is unavailable in the test runtime", () => {
    expect(extractImageSourcesFromHtml('<img src="https://example.test/image.png">')).toEqual([]);
    expect(extractSingleLinkFromHtml('<a href="https://example.test">Example</a>')).toBeNull();
  });
});
