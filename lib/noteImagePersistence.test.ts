import { describe, expect, it, vi } from "vitest";
import { normalizeAndPersistNoteImages } from "./noteImagePersistence";

describe("normalizeAndPersistNoteImages", () => {
  it("does not persist embedded svg data images", async () => {
    const upload = vi.fn();
    const supabase = {
      storage: {
        from: vi.fn(() => ({
          upload,
          getPublicUrl: vi.fn(() => ({ data: { publicUrl: "https://example.test/image.png" } })),
        })),
      },
    };
    const svgSrc = `data:image/svg+xml;base64,${Buffer.from("<svg />").toString("base64")}`;
    const content = {
      type: "doc",
      content: [
        {
          type: "image",
          attrs: { src: svgSrc },
        },
      ],
    };

    const result = await normalizeAndPersistNoteImages({
      content,
      scope: "task_note",
      entityId: "task-1",
      userId: "user-1",
      supabase: supabase as never,
    });

    expect(upload).not.toHaveBeenCalled();
    expect(result.content).toEqual(content);
    expect(result.warnings).toContain("One embedded image could not be decoded and was saved unchanged.");
  });
});
