import { NextResponse } from "next/server";
import {
  buildPostgrestIlikeContainsFilter,
  buildPostgrestOrFilter,
} from "@/lib/postgrestFilters";
import { requireApiUser } from "@/lib/api/requireApiUser";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type MentionUserRow = {
  id: string;
  full_name: string | null;
  email: string | null;
  status?: string | null;
};

type MentionSuggestionItem = {
  id: string;
  handle: string;
  full_name: string | null;
  email: string | null;
};

const DEFAULT_LIMIT = 8;
const MAX_LIMIT = 12;

function normalizeHandlePart(value: string) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._@-]+/g, ".")
    .replace(/\.{2,}/g, ".")
    .replace(/^[._-]+|[._-]+$/g, "");
}

function normalizeSearchValue(value: string) {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function deriveMentionHandleCandidates(user: MentionUserRow) {
  const candidates: string[] = [];
  const normalizedName = normalizeHandlePart(
    normalizeSearchValue(String(user.full_name || "")).replace(/\s+/g, ".")
  );
  if (normalizedName.length >= 2) {
    candidates.push(normalizedName);
  }

  const email = String(user.email || "").trim().toLowerCase();
  const emailLocalPart = normalizeHandlePart(email.split("@")[0] || "");
  if (emailLocalPart.length >= 2) {
    candidates.push(emailLocalPart);
  }

  const normalizedEmail = normalizeHandlePart(email);
  if (normalizedEmail.length >= 2) {
    candidates.push(normalizedEmail);
  }

  return Array.from(new Set(candidates));
}

function getRelevanceScore(item: MentionSuggestionItem, query: string) {
  const normalizedQuery = normalizeSearchValue(query);
  if (!normalizedQuery) return 0;

  const fullName = normalizeSearchValue(String(item.full_name || ""));
  const email = normalizeSearchValue(String(item.email || ""));
  const handle = normalizeSearchValue(String(item.handle || ""));
  const emailLocal = normalizeSearchValue(email.split("@")[0] || "");

  if (fullName.startsWith(normalizedQuery)) return 0;
  if (emailLocal.startsWith(normalizedQuery)) return 1;
  if (handle.startsWith(normalizedQuery)) return 2;
  if (fullName.includes(normalizedQuery)) return 3;
  if (email.includes(normalizedQuery)) return 4;
  if (handle.includes(normalizedQuery)) return 5;
  return 6;
}

async function fetchMentionUsers(
  query: string,
  limit: number
): Promise<MentionUserRow[]> {
  const supabase = createSupabaseServerClient();
  const sampleSize = Math.max(limit * 4, 24);
  const normalizedQuery = normalizeSearchValue(query);
  const userSearchFilter = buildPostgrestOrFilter([
    buildPostgrestIlikeContainsFilter("full_name", normalizedQuery),
    buildPostgrestIlikeContainsFilter("email", normalizedQuery),
  ]);

  const withStatus = normalizedQuery.length
    ? await supabase
        .from("users")
        .select("id,full_name,email,status")
        .or(userSearchFilter)
        .order("full_name", { ascending: true })
        .limit(sampleSize)
    : await supabase
        .from("users")
        .select("id,full_name,email,status")
        .order("full_name", { ascending: true })
        .limit(sampleSize);

  if (!withStatus.error) {
    return (withStatus.data || []) as MentionUserRow[];
  }

  const withoutStatus = normalizedQuery.length
    ? await supabase
        .from("users")
        .select("id,full_name,email")
        .or(userSearchFilter)
        .order("full_name", { ascending: true })
        .limit(sampleSize)
    : await supabase
        .from("users")
        .select("id,full_name,email")
        .order("full_name", { ascending: true })
        .limit(sampleSize);

  if (withoutStatus.error) {
    throw new Error(withoutStatus.error.message);
  }
  return (withoutStatus.data || []) as MentionUserRow[];
}

export async function GET(req: Request) {
  const supabase = createSupabaseServerClient();
  const auth = await requireApiUser(supabase, "mentions.suggestions.auth");
  if (auth.response) return auth.response;

  const { searchParams } = new URL(req.url);
  const rawQuery = String(searchParams.get("q") || "");
  const query = normalizeSearchValue(rawQuery);
  const rawLimit = Number(searchParams.get("limit") || DEFAULT_LIMIT);
  const limit = Number.isFinite(rawLimit)
    ? Math.max(1, Math.min(MAX_LIMIT, rawLimit))
    : DEFAULT_LIMIT;

  let users: MentionUserRow[] = [];
  try {
    users = await fetchMentionUsers(query, limit);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load mentions";
    return NextResponse.json({ error: message }, { status: 500 });
  }

  const activeUsers = users.filter(
    (user) => normalizeSearchValue(String(user.status || "active")) !== "disabled"
  );
  const usedHandles = new Set<string>();
  const suggestions: MentionSuggestionItem[] = [];
  for (const user of activeUsers) {
    const handleCandidates = deriveMentionHandleCandidates(user);
    const handle = handleCandidates.find((candidate) => !usedHandles.has(candidate));
    if (!handle) {
      continue;
    }
    usedHandles.add(handle);
    suggestions.push({
      id: user.id,
      handle,
      full_name: user.full_name || null,
      email: user.email || null,
    });
  }

  const filtered = query
    ? suggestions
        .map((item) => ({
          item,
          score: getRelevanceScore(item, query),
        }))
        .filter((entry) => entry.score < 6)
        .sort((a, b) => {
          if (a.score !== b.score) return a.score - b.score;
          const aName = normalizeSearchValue(a.item.full_name || a.item.email || a.item.handle);
          const bName = normalizeSearchValue(b.item.full_name || b.item.email || b.item.handle);
          return aName.localeCompare(bName);
        })
        .map((entry) => entry.item)
    : suggestions;

  return NextResponse.json({
    items: filtered.slice(0, limit),
  });
}
