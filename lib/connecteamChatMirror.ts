import { logError, logInfo, logWarn } from "./vercelLogger";

type LocalChatConversation = {
  id: string;
  type: "direct" | "group";
  title: string | null;
};

type LocalChatUser = {
  id: string;
  full_name: string | null;
  email: string | null;
};

type LocalChatLink = {
  label: string;
  href: string;
};

type LocalChatAttachment = {
  filename: string;
};

type ConnecteamMirrorInput = {
  conversation: LocalChatConversation;
  sender: LocalChatUser;
  recipients: LocalChatUser[];
  body: string;
  links?: LocalChatLink[];
  attachments?: LocalChatAttachment[];
};

type ConnecteamUserRow = {
  userId?: number;
  id?: number;
  email?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  fullName?: string | null;
  name?: string | null;
};

type ConnecteamPublisherRow = {
  publisherId?: number;
  id?: number;
  name?: string | null;
};

type ConnecteamMirrorSummary = {
  attempted: boolean;
  mode: "disabled" | "mapped_conversation" | "private_messages";
  deliveredCount: number;
  skippedCount: number;
};

const CONNECTEAM_BASE_URL = "https://api.connecteam.com";
const CONNECTEAM_REQUEST_TIMEOUT_MS = 8000;
const CONNECTEAM_MESSAGE_MAX_LENGTH = 1000;
const CONNECTEAM_LIST_PREVIEW_LIMIT = 3;
let cachedConversationMap: Record<string, unknown> | null = null;
let cachedUserMap: Record<string, unknown> | null = null;

function normalizeEmail(value: string | null | undefined) {
  return String(value || "").trim().toLowerCase();
}

function cleanFullName(value: string | null | undefined) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ");
}

function normalizeFullName(value: string | null | undefined) {
  return cleanFullName(value).toLowerCase();
}

function normalizeSiteOrigin(value: string | null | undefined) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  return withProtocol.replace(/\/+$/, "");
}

function normalizePositiveInteger(value: unknown) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function parseOptionalJsonRecord(value: string | undefined, key: string) {
  const raw = String(value || "").trim();
  if (!raw) return {} as Record<string, unknown>;

  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : ({} as Record<string, unknown>);
  } catch (error) {
    logWarn("connecteam.chat.config.parse_failed", {
      config_key: key,
      message: error instanceof Error ? error.message : String(error),
    });
    return {} as Record<string, unknown>;
  }
}

function getConversationMapConfig() {
  if (cachedConversationMap) {
    return cachedConversationMap;
  }
  cachedConversationMap = parseOptionalJsonRecord(
    process.env.CONNECTEAM_CHAT_CONVERSATION_MAP_JSON,
    "CONNECTEAM_CHAT_CONVERSATION_MAP_JSON"
  );
  return cachedConversationMap;
}

function getUserMapConfig() {
  if (cachedUserMap) {
    return cachedUserMap;
  }
  cachedUserMap = parseOptionalJsonRecord(
    process.env.CONNECTEAM_CHAT_USER_MAP_JSON,
    "CONNECTEAM_CHAT_USER_MAP_JSON"
  );
  return cachedUserMap;
}

function summarizeList(values: string[]) {
  const cleaned = values.map((value) => String(value || "").trim()).filter(Boolean);
  if (!cleaned.length) return "";
  if (cleaned.length <= CONNECTEAM_LIST_PREVIEW_LIMIT) {
    return cleaned.join(", ");
  }
  const shown = cleaned.slice(0, CONNECTEAM_LIST_PREVIEW_LIMIT).join(", ");
  return `${shown}, +${cleaned.length - CONNECTEAM_LIST_PREVIEW_LIMIT} more`;
}

function truncateText(value: string, maxLength: number) {
  if (maxLength <= 0) return "";
  if (value.length <= maxLength) return value;
  if (maxLength <= 3) return value.slice(0, maxLength);
  return `${value.slice(0, maxLength - 3).trimEnd()}...`;
}

export function stripChatReplyMetadata(body: string) {
  return String(body || "").replace(/^\[\[reply:([0-9a-f-]{36})\]\]\s*\n?/i, "");
}

export function buildConnecteamMirrorMessage(input: {
  conversation: LocalChatConversation;
  sender: LocalChatUser;
  body: string;
  links?: LocalChatLink[];
  attachments?: LocalChatAttachment[];
  chatUrl?: string | null;
}) {
  const senderLabel =
    String(input.sender.full_name || "").trim() ||
    String(input.sender.email || "").trim() ||
    "Someone";
  const groupTitle =
    input.conversation.type === "group"
      ? String(input.conversation.title || "").trim() || "Untitled group"
      : "";
  const header =
    input.conversation.type === "group"
      ? `${senderLabel} posted in "${groupTitle}" via ResOpsHub`
      : `${senderLabel} sent you a message via ResOpsHub`;
  const cleanBody = stripChatReplyMetadata(input.body).trim();
  const linksLine = input.links?.length
    ? `Links: ${summarizeList(input.links.map((link) => link.label || link.href))}`
    : "";
  const attachmentsLine = input.attachments?.length
    ? `Attachments: ${summarizeList(input.attachments.map((attachment) => attachment.filename))}`
    : "";
  const footer = String(input.chatUrl || "").trim()
    ? `Open in ResOpsHub: ${String(input.chatUrl || "").trim()}`
    : "";

  const prefixLines = [header];
  if (cleanBody) {
    prefixLines.push("", cleanBody);
  }
  if (linksLine) {
    prefixLines.push("", linksLine);
  }
  if (attachmentsLine) {
    prefixLines.push("", attachmentsLine);
  }

  const prefix = prefixLines.join("\n").trim();
  if (!footer) {
    return truncateText(prefix, CONNECTEAM_MESSAGE_MAX_LENGTH);
  }

  const footerBlock = prefix ? `\n\n${footer}` : footer;
  const remainingLength = CONNECTEAM_MESSAGE_MAX_LENGTH - footerBlock.length;
  if (remainingLength <= 0) {
    return truncateText(footer, CONNECTEAM_MESSAGE_MAX_LENGTH);
  }

  return `${truncateText(prefix, remainingLength).trimEnd()}${footerBlock}`.trim();
}

function getConnecteamApiKey() {
  return String(process.env.CONNECTEAM_API_KEY || "").trim();
}

function getConnecteamBaseUrl() {
  return normalizeSiteOrigin(process.env.CONNECTEAM_API_BASE_URL) || CONNECTEAM_BASE_URL;
}

function getResOpsHubSiteOrigin() {
  return (
    normalizeSiteOrigin(process.env.NEXT_PUBLIC_SITE_URL) ||
    normalizeSiteOrigin(process.env.NEXT_PUBLIC_VERCEL_URL)
  );
}

function buildChatUrl(conversationId: string) {
  const origin = getResOpsHubSiteOrigin();
  if (!origin) return null;
  return `${origin}/chat?c=${encodeURIComponent(conversationId)}`;
}

function getMappedConversationId(localConversationId: string) {
  const mapping = getConversationMapConfig();
  const direct = mapping[localConversationId];
  if (typeof direct === "string" || typeof direct === "number") {
    const normalized = String(direct).trim();
    return normalized || null;
  }
  return null;
}

function getMappedConnecteamUserId(localUser: LocalChatUser) {
  const mapping = getUserMapConfig();
  const directUserId = mapping[localUser.id];
  if (directUserId !== undefined) {
    return normalizePositiveInteger(directUserId);
  }

  const normalizedEmail = normalizeEmail(localUser.email);
  if (!normalizedEmail) return null;
  return normalizePositiveInteger(mapping[normalizedEmail]);
}

function getConnecteamUserFullName(user: ConnecteamUserRow) {
  const explicitFullName = normalizeFullName(user.fullName);
  if (explicitFullName) return explicitFullName;

  const genericName = normalizeFullName(user.name);
  if (genericName) return genericName;

  return normalizeFullName(
    [String(user.firstName || "").trim(), String(user.lastName || "").trim()]
      .filter(Boolean)
      .join(" ")
  );
}

export function isConnecteamChatMirrorConfigured() {
  return Boolean(getConnecteamApiKey());
}

async function fetchConnecteam(
  path: string,
  init?: {
    method?: "GET" | "POST";
    body?: Record<string, unknown>;
  }
) {
  const apiKey = getConnecteamApiKey();
  if (!apiKey) {
    throw new Error("Missing CONNECTEAM_API_KEY");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CONNECTEAM_REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(`${getConnecteamBaseUrl()}${path}`, {
      method: init?.method || "GET",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "X-API-KEY": apiKey,
      },
      body: init?.body ? JSON.stringify(init.body) : undefined,
      cache: "no-store",
      signal: controller.signal,
    });

    const text = await response.text();
    let payload: unknown = null;
    if (text) {
      try {
        payload = JSON.parse(text);
      } catch {
        payload = { raw: truncateText(text, 300) };
      }
    }

    if (!response.ok) {
      const payloadMessage =
        payload && typeof payload === "object" && "message" in payload
          ? (payload as { message?: unknown }).message
          : null;
      throw new Error(
        `Connecteam request failed (${response.status})${
          typeof payloadMessage === "string" ? `: ${payloadMessage}` : ""
        }`
      );
    }

    return payload;
  } finally {
    clearTimeout(timeout);
  }
}

async function resolvePublisherId() {
  const configuredPublisherId = normalizePositiveInteger(process.env.CONNECTEAM_PUBLISHER_ID);
  if (configuredPublisherId) {
    return configuredPublisherId;
  }

  const payload = (await fetchConnecteam("/publishers/v1/publishers")) as
    | { data?: { publishers?: ConnecteamPublisherRow[] } }
    | null;
  const publishers = Array.isArray(payload?.data?.publishers) ? payload.data.publishers : [];
  const publisherIds = publishers
    .map((publisher) => normalizePositiveInteger(publisher.publisherId ?? publisher.id))
    .filter((value): value is number => value !== null);

  if (!publisherIds.length) {
    return null;
  }

  if (publisherIds.length > 1) {
    logWarn("connecteam.chat.publisher.multiple_detected", {
      publisher_count: publisherIds.length,
      chosen_publisher_id: publisherIds[0],
    });
  }

  return publisherIds[0];
}

export async function resolveConnecteamUserIds(users: LocalChatUser[]) {
  const byLocalUserId = new Map<string, number>();
  const unresolvedEmails = new Set<string>();
  const unresolvedFullNames = new Map<string, string>();

  users.forEach((user) => {
    const mappedId = getMappedConnecteamUserId(user);
    if (mappedId) {
      byLocalUserId.set(user.id, mappedId);
      return;
    }

    const normalizedEmail = normalizeEmail(user.email);
    if (normalizedEmail) {
      unresolvedEmails.add(normalizedEmail);
    }

    const cleanedFullName = cleanFullName(user.full_name);
    const normalizedFullName = normalizeFullName(cleanedFullName);
    if (normalizedFullName) {
      unresolvedFullNames.set(normalizedFullName, cleanedFullName);
    }
  });

  if (!unresolvedEmails.size && !unresolvedFullNames.size) {
    return byLocalUserId;
  }

  const query = new URLSearchParams();
  query.set(
    "limit",
    String(Math.min(500, Math.max(10, unresolvedEmails.size + unresolvedFullNames.size)))
  );
  Array.from(unresolvedEmails).forEach((email) => {
    query.append("emailAddresses", email);
  });
  Array.from(unresolvedFullNames.values()).forEach((fullName) => {
    query.append("fullNames", fullName);
  });

  const payload = (await fetchConnecteam(`/users/v1/users?${query.toString()}`)) as
    | { data?: { users?: ConnecteamUserRow[] } }
    | null;
  const connecteamUsers = Array.isArray(payload?.data?.users) ? payload.data.users : [];
  const connecteamUserIdByEmail = new Map<string, number>();
  const connecteamUserIdsByFullName = new Map<string, number[]>();

  connecteamUsers.forEach((user) => {
    const userId = normalizePositiveInteger(user.userId ?? user.id);
    const email = normalizeEmail(user.email);
    const fullName = getConnecteamUserFullName(user);
    if (!userId) return;

    if (email) {
      connecteamUserIdByEmail.set(email, userId);
    }

    if (fullName) {
      const bucket = connecteamUserIdsByFullName.get(fullName) || [];
      bucket.push(userId);
      connecteamUserIdsByFullName.set(fullName, bucket);
    }
  });

  users.forEach((user) => {
    if (byLocalUserId.has(user.id)) return;

    const email = normalizeEmail(user.email);
    const connecteamUserId = email ? connecteamUserIdByEmail.get(email) || null : null;
    if (connecteamUserId) {
      byLocalUserId.set(user.id, connecteamUserId);
      return;
    }

    const fullName = normalizeFullName(user.full_name);
    const candidateIds = fullName ? connecteamUserIdsByFullName.get(fullName) || [] : [];
    const uniqueCandidateIds = Array.from(new Set(candidateIds));
    if (uniqueCandidateIds.length === 1) {
      byLocalUserId.set(user.id, uniqueCandidateIds[0]);
    }
  });

  return byLocalUserId;
}

async function sendConnecteamPrivateMessages(
  input: ConnecteamMirrorInput,
  publisherId: number,
  messageText: string
) {
  const connecteamUserIdByLocalUserId = await resolveConnecteamUserIds(input.recipients);
  const uniqueRecipientIds = Array.from(
    new Set(
      input.recipients
        .map((recipient) => connecteamUserIdByLocalUserId.get(recipient.id) || null)
        .filter((value): value is number => value !== null)
    )
  );

  if (!uniqueRecipientIds.length) {
    logInfo("connecteam.chat.private.no_recipients_resolved", {
      conversation_id: input.conversation.id,
      recipient_count: input.recipients.length,
      recipient_preview: summarizeList(
        input.recipients.map(
          (recipient) =>
            String(recipient.full_name || "").trim() ||
            String(recipient.email || "").trim() ||
            recipient.id
        )
      ),
      recipients_with_email_count: input.recipients.filter((recipient) => normalizeEmail(recipient.email)).length,
      recipients_with_name_count: input.recipients.filter((recipient) => normalizeFullName(recipient.full_name)).length,
    });
    return { deliveredCount: 0, skippedCount: input.recipients.length };
  }

  const results = await Promise.allSettled(
    uniqueRecipientIds.map((recipientId) =>
      fetchConnecteam(`/chat/v1/conversations/privateMessage/${recipientId}`, {
        method: "POST",
        body: {
          senderId: publisherId,
          text: messageText,
        },
      })
    )
  );

  const deliveredCount = results.filter((result) => result.status === "fulfilled").length;
  results.forEach((result, index) => {
    if (result.status === "fulfilled") return;
    logError("connecteam.chat.private.delivery_failed", {
      conversation_id: input.conversation.id,
      connecteam_user_id: uniqueRecipientIds[index],
      message: result.reason instanceof Error ? result.reason.message : String(result.reason),
    });
  });

  return {
    deliveredCount,
    skippedCount: Math.max(0, input.recipients.length - deliveredCount),
  };
}

async function sendConnecteamConversationMessage(
  mappedConversationId: string,
  publisherId: number,
  messageText: string
) {
  await fetchConnecteam(`/chat/v1/conversations/${encodeURIComponent(mappedConversationId)}/message`, {
    method: "POST",
    body: {
      senderId: publisherId,
      text: messageText,
    },
  });
}

export async function mirrorChatMessageToConnecteam(
  input: ConnecteamMirrorInput
): Promise<ConnecteamMirrorSummary> {
  if (!isConnecteamChatMirrorConfigured()) {
    return {
      attempted: false,
      mode: "disabled",
      deliveredCount: 0,
      skippedCount: input.recipients.length,
    };
  }

  if (!input.recipients.length) {
    return {
      attempted: false,
      mode: "private_messages",
      deliveredCount: 0,
      skippedCount: 0,
    };
  }

  const publisherId = await resolvePublisherId();
  if (!publisherId) {
    logWarn("connecteam.chat.publisher.missing", {
      conversation_id: input.conversation.id,
    });
    return {
      attempted: true,
      mode: "private_messages",
      deliveredCount: 0,
      skippedCount: input.recipients.length,
    };
  }

  const messageText = buildConnecteamMirrorMessage({
    conversation: input.conversation,
    sender: input.sender,
    body: input.body,
    links: input.links,
    attachments: input.attachments,
    chatUrl: buildChatUrl(input.conversation.id),
  });
  const mappedConversationId = getMappedConversationId(input.conversation.id);

  if (mappedConversationId) {
    try {
      await sendConnecteamConversationMessage(mappedConversationId, publisherId, messageText);
      return {
        attempted: true,
        mode: "mapped_conversation",
        deliveredCount: 1,
        skippedCount: 0,
      };
    } catch (error) {
      logWarn("connecteam.chat.conversation.delivery_failed_fallback_private", {
        conversation_id: input.conversation.id,
        mapped_conversation_id: mappedConversationId,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const summary = await sendConnecteamPrivateMessages(input, publisherId, messageText);
  return {
    attempted: true,
    mode: "private_messages",
    deliveredCount: summary.deliveredCount,
    skippedCount: summary.skippedCount,
  };
}
