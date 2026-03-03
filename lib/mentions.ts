type MentionableUser = {
  id: string;
  email: string | null;
  full_name: string | null;
};

const MENTION_REGEX = /(^|[^a-zA-Z0-9_])@([a-zA-Z0-9][a-zA-Z0-9._@-]{0,127})/g;
const TRAILING_MENTION_PUNCTUATION_REGEX = /[.,;:!?]+$/;

export type MentionRange = {
  start: number;
  end: number;
  handle: string;
  text: string;
};

export type MentionTextSegment = {
  type: "text" | "mention";
  value: string;
};

function createMentionRegex() {
  return new RegExp(MENTION_REGEX.source, "g");
}

function normalizeWhitespace(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function normalizeMentionToken(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[.,;:!?]+$/g, "")
    .replace(/^[-_.]+|[-_.]+$/g, "");
}

function addAlias(target: Set<string>, value: string) {
  const alias = normalizeMentionToken(value);
  if (alias.length >= 2) {
    target.add(alias);
  }
}

function buildUserAliases(user: MentionableUser) {
  const aliases = new Set<string>();
  const email = String(user.email || "")
    .trim()
    .toLowerCase();

  if (email) {
    addAlias(aliases, email);
    const localPart = email.split("@")[0] || "";
    addAlias(aliases, localPart);
  }

  const fullName = normalizeWhitespace(String(user.full_name || ""));
  if (fullName) {
    addAlias(aliases, fullName.split(" ")[0] || "");
    addAlias(aliases, fullName.replace(/\s+/g, ""));
    addAlias(aliases, fullName.replace(/\s+/g, "."));
    addAlias(aliases, fullName.replace(/\s+/g, "_"));
    addAlias(aliases, fullName.replace(/\s+/g, "-"));
    addAlias(aliases, fullName.replace(/[^a-z0-9]+/g, ""));
  }

  return aliases;
}

export function extractMentionHandles(text: string) {
  const normalized = String(text || "");
  const seen = new Set<string>();
  const handles: string[] = [];

  for (const match of normalized.matchAll(createMentionRegex())) {
    const token = normalizeMentionToken(match[2] || "");
    if (!token || token.length < 2 || seen.has(token)) {
      continue;
    }
    seen.add(token);
    handles.push(token);
  }

  return handles;
}

export function getMentionRanges(text: string): MentionRange[] {
  const normalized = String(text || "");
  const ranges: MentionRange[] = [];
  for (const match of normalized.matchAll(createMentionRegex())) {
    const matchIndex = Number(match.index);
    if (!Number.isFinite(matchIndex) || matchIndex < 0) {
      continue;
    }
    const prefix = String(match[1] || "");
    const rawHandle = String(match[2] || "");
    if (!rawHandle) {
      continue;
    }
    const handleWithoutTrailingPunctuation = rawHandle.replace(TRAILING_MENTION_PUNCTUATION_REGEX, "");
    const normalizedHandle = normalizeMentionToken(handleWithoutTrailingPunctuation);
    if (!normalizedHandle || normalizedHandle.length < 2) {
      continue;
    }
    const mentionText = `@${handleWithoutTrailingPunctuation}`;
    ranges.push({
      start: matchIndex + prefix.length,
      end: matchIndex + prefix.length + mentionText.length,
      handle: normalizedHandle,
      text: mentionText,
    });
  }
  return ranges;
}

export function splitTextWithMentions(text: string): MentionTextSegment[] {
  const normalized = String(text || "");
  if (!normalized) {
    return [{ type: "text", value: "" }];
  }
  const ranges = getMentionRanges(normalized);
  if (!ranges.length) {
    return [{ type: "text", value: normalized }];
  }
  const segments: MentionTextSegment[] = [];
  let cursor = 0;
  for (const range of ranges) {
    if (range.start > cursor) {
      segments.push({
        type: "text",
        value: normalized.slice(cursor, range.start),
      });
    }
    segments.push({
      type: "mention",
      value: normalized.slice(range.start, range.end),
    });
    cursor = range.end;
  }
  if (cursor < normalized.length) {
    segments.push({
      type: "text",
      value: normalized.slice(cursor),
    });
  }
  return segments;
}

export function resolveMentionHandlesToRecipients(
  handles: string[],
  users: MentionableUser[]
) {
  const aliasToUserIds = new Map<string, Set<string>>();

  for (const user of users) {
    const aliases = buildUserAliases(user);
    for (const alias of aliases) {
      if (!aliasToUserIds.has(alias)) {
        aliasToUserIds.set(alias, new Set<string>());
      }
      aliasToUserIds.get(alias)?.add(user.id);
    }
  }

  const userHandlesMap = new Map<string, Set<string>>();
  for (const rawHandle of handles) {
    const handle = normalizeMentionToken(rawHandle);
    const recipients = aliasToUserIds.get(handle);
    if (!recipients || recipients.size !== 1) {
      continue;
    }
    const [userId] = Array.from(recipients);
    if (!userId) {
      continue;
    }
    if (!userHandlesMap.has(userId)) {
      userHandlesMap.set(userId, new Set<string>());
    }
    userHandlesMap.get(userId)?.add(handle);
  }

  return new Map(
    Array.from(userHandlesMap.entries()).map(([userId, userHandles]) => [
      userId,
      Array.from(userHandles),
    ])
  );
}
