export const CHAT_ATTACHMENTS_BUCKET = "chat-attachments";
export const CHAT_ATTACHMENT_URL_TTL_SECONDS = 60 * 60;

type SignedUrlResult = {
  data: { signedUrl: string } | null;
  error: { message: string } | null;
};

type ChatAttachmentStorage = {
  from: (bucket: string) => {
    createSignedUrl: (path: string, expiresIn: number) => Promise<SignedUrlResult>;
  };
};

export type ChatAttachmentWithPath = {
  storage_path: string;
};

export async function getSignedChatAttachmentUrl(
  storage: ChatAttachmentStorage,
  storagePath: string,
  expiresInSeconds = CHAT_ATTACHMENT_URL_TTL_SECONDS
) {
  const { data, error } = await storage
    .from(CHAT_ATTACHMENTS_BUCKET)
    .createSignedUrl(storagePath, expiresInSeconds);

  if (error || !data?.signedUrl) {
    return null;
  }

  return data.signedUrl;
}

export async function withSignedChatAttachmentUrls<T extends ChatAttachmentWithPath>(
  storage: ChatAttachmentStorage,
  attachments: T[],
  expiresInSeconds = CHAT_ATTACHMENT_URL_TTL_SECONDS
) {
  const signedUrls = await Promise.all(
    attachments.map((attachment) =>
      getSignedChatAttachmentUrl(storage, attachment.storage_path, expiresInSeconds)
    )
  );

  return attachments.map((attachment, index) => ({
    ...attachment,
    url: signedUrls[index],
  }));
}
