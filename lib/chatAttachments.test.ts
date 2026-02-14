import { describe, expect, it } from "vitest";
import {
  CHAT_ATTACHMENTS_BUCKET,
  CHAT_ATTACHMENT_URL_TTL_SECONDS,
  getSignedChatAttachmentUrl,
  withSignedChatAttachmentUrls,
} from "./chatAttachments";

type FakeStorage = {
  from: (bucket: string) => {
    createSignedUrl: (
      path: string,
      expiresIn: number
    ) => Promise<{
      data: { signedUrl: string } | null;
      error: { message: string } | null;
    }>;
  };
};

function makeStorage(
  resolver: (path: string, expiresIn: number) => { signedUrl: string } | null
) {
  const calls: Array<{ bucket: string; path: string; expiresIn: number }> = [];
  const storage: FakeStorage = {
    from: (bucket: string) => ({
      createSignedUrl: async (path: string, expiresIn: number) => {
        calls.push({ bucket, path, expiresIn });
        const resolved = resolver(path, expiresIn);
        if (!resolved) {
          return { data: null, error: { message: "sign failed" } };
        }
        return { data: resolved, error: null };
      },
    }),
  };
  return { storage, calls };
}

describe("chat attachment signed URLs", () => {
  it("creates a signed URL for a single attachment path", async () => {
    const { storage, calls } = makeStorage((path) => ({
      signedUrl: `https://signed.local/${path}`,
    }));

    const signedUrl = await getSignedChatAttachmentUrl(
      storage,
      "conversation/user/image.png"
    );

    expect(signedUrl).toBe("https://signed.local/conversation/user/image.png");
    expect(calls).toEqual([
      {
        bucket: CHAT_ATTACHMENTS_BUCKET,
        path: "conversation/user/image.png",
        expiresIn: CHAT_ATTACHMENT_URL_TTL_SECONDS,
      },
    ]);
  });

  it("returns null when signed URL creation fails", async () => {
    const { storage } = makeStorage(() => null);

    const signedUrl = await getSignedChatAttachmentUrl(
      storage,
      "conversation/user/image.png"
    );

    expect(signedUrl).toBeNull();
  });

  it("maps attachment rows to signed URLs", async () => {
    const { storage } = makeStorage((path, expiresIn) => ({
      signedUrl: `https://signed.local/${expiresIn}/${path}`,
    }));

    const rows = await withSignedChatAttachmentUrls(storage, [
      {
        id: "1",
        message_id: "m1",
        storage_path: "a/b/1.png",
        filename: "1.png",
      },
      {
        id: "2",
        message_id: "m1",
        storage_path: "a/b/2.png",
        filename: "2.png",
      },
    ]);

    expect(rows).toEqual([
      {
        id: "1",
        message_id: "m1",
        storage_path: "a/b/1.png",
        filename: "1.png",
        url: `https://signed.local/${CHAT_ATTACHMENT_URL_TTL_SECONDS}/a/b/1.png`,
      },
      {
        id: "2",
        message_id: "m1",
        storage_path: "a/b/2.png",
        filename: "2.png",
        url: `https://signed.local/${CHAT_ATTACHMENT_URL_TTL_SECONDS}/a/b/2.png`,
      },
    ]);
  });
});
