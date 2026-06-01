import { describe, expect, it } from "vitest";
import {
  getAllowedImageExtensionFromMimeType,
  safeUploadImageFilename,
  validateUploadImageFile,
} from "./imageUploadValidation";

describe("image upload validation", () => {
  it("allows only the shared safe image MIME types", () => {
    expect(getAllowedImageExtensionFromMimeType("image/png")).toBe("png");
    expect(getAllowedImageExtensionFromMimeType("image/jpeg")).toBe("jpg");
    expect(getAllowedImageExtensionFromMimeType("image/webp")).toBe("webp");
    expect(getAllowedImageExtensionFromMimeType("image/gif")).toBe("gif");
    expect(getAllowedImageExtensionFromMimeType("image/avif")).toBe("avif");
  });

  it("blocks svg and generic image wildcards", () => {
    const svg = new File(["<svg />"], "bad.svg", { type: "image/svg+xml" });
    const result = validateUploadImageFile(svg, { maxSizeBytes: 10 * 1024 * 1024 });

    expect(result).toEqual({
      ok: false,
      error: "Unsupported image type. Use PNG, JPEG, WebP, GIF, or AVIF.",
    });
    expect(getAllowedImageExtensionFromMimeType("image/bmp")).toBeNull();
    expect(getAllowedImageExtensionFromMimeType("image/svg+xml")).toBeNull();
  });

  it("enforces the configured size limit", () => {
    const file = new File(["abc"], "photo.png", { type: "image/png" });
    Object.defineProperty(file, "size", { value: 6 * 1024 * 1024 });

    expect(validateUploadImageFile(file, { maxSizeBytes: 5 * 1024 * 1024 })).toEqual({
      ok: false,
      error: "Image exceeds 5MB limit",
    });
  });

  it("uses the MIME-derived extension instead of trusting the original name", () => {
    expect(safeUploadImageFilename("../avatar.svg", "png")).toBe("avatar.png");
    expect(safeUploadImageFilename("client logo.jpg", "webp")).toBe("client_logo.webp");
  });
});
