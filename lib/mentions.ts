type MentionableUser = {
  id: string;
  email: string | null;
  full_name: string | null;
};

const MENTION_REGEX = /(^|[^a-zA-Z0-9_])@([a-zA-Z0-9][a-zA-Z0-9._@-]{0,127})/g;

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

  for (const match of normalized.matchAll(MENTION_REGEX)) {
    const token = normalizeMentionToken(match[2] || "");
    if (!token || token.length < 2 || seen.has(token)) {
      continue;
    }
    seen.add(token);
    handles.push(token);
  }

  return handles;
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

