import { NextResponse } from "next/server";
import {
  buildPostgrestIlikeContainsFilter,
  buildPostgrestOrFilter,
} from "@/lib/postgrestFilters";
import { requireApiUser } from "@/lib/api/requireApiUser";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type SearchResult = {
  result_type: "personal" | "task";
  result_id: string;
  title: string;
  content_text: string | null;
  rank: number | null;
  section_title: string | null;
  client_name: string | null;
  project_name: string | null;
  updated_at: string | null;
  last_edited_at: string | null;
};

type SuggestionItem = {
  id: string;
  title: string;
  type: "personal" | "task";
  href: string;
  subtitle: string;
  snippet: string;
};

function toSnippet(value: string | null | undefined, limit = 90) {
  if (!value) return "";
  const clean = value.replace(/\s+/g, " ").trim();
  if (clean.length <= limit) return clean;
  return `${clean.slice(0, limit - 3)}...`;
}

function toSubtitle(row: SearchResult) {
  if (row.result_type === "personal") {
    return row.section_title ? `Personal • ${row.section_title}` : "Personal";
  }
  const parts = [row.client_name, row.project_name].filter(Boolean);
  if (!parts.length) return "Task";
  return `Task • ${parts.join(" • ")}`;
}

function mapToSuggestion(row: SearchResult): SuggestionItem {
  return {
    id: row.result_id,
    title: row.title || "Untitled",
    type: row.result_type,
    href: row.result_type === "task" ? `/tasks/${row.result_id}` : `/personal/${row.result_id}`,
    subtitle: toSubtitle(row),
    snippet: toSnippet(row.content_text),
  };
}

function compareByDateDesc(a: SearchResult, b: SearchResult) {
  const aDate = a.last_edited_at || a.updated_at || "";
  const bDate = b.last_edited_at || b.updated_at || "";
  if (aDate === bDate) return 0;
  return aDate < bDate ? 1 : -1;
}

export async function GET(req: Request) {
  const supabase = createSupabaseServerClient();
  const auth = await requireApiUser(supabase, "search.suggestions.auth");
  if (auth.response) return auth.response;

  const { searchParams } = new URL(req.url);
  const query = String(searchParams.get("q") || "").trim();
  const limitRaw = Number(searchParams.get("limit") || 8);
  const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(12, limitRaw)) : 8;

  if (query.length < 2) {
    return NextResponse.json({ items: [] satisfies SuggestionItem[] });
  }

  const { data, error } = await supabase.rpc("search_notes", {
    query_text: query,
    filter_type: "all",
    filter_section_id: null,
    filter_client_id: null,
    result_limit: limit,
  });

  if (!error) {
    const rows = ((data || []) as SearchResult[]).slice(0, limit);
    return NextResponse.json({ items: rows.map(mapToSuggestion) });
  }

  const fallbackSearchFilter = buildPostgrestOrFilter([
    buildPostgrestIlikeContainsFilter("title", query),
    buildPostgrestIlikeContainsFilter("content_text", query),
  ]);
  const [personalResponse, taskResponse] = await Promise.all([
    supabase
      .from("personal_pages")
      .select("id,title,content_text,updated_at,last_edited_at,personal_sections(title)")
      .or(fallbackSearchFilter)
      .order("updated_at", { ascending: false })
      .limit(limit),
    supabase
      .from("tasks")
      .select("id,title,content_text,updated_at,last_edited_at,clients(name),projects(name)")
      .or(fallbackSearchFilter)
      .order("updated_at", { ascending: false })
      .limit(limit),
  ]);

  const fallbackRows: SearchResult[] = [];

  const personalRows = (personalResponse.data || []) as Array<{
    id: string;
    title: string;
    content_text: string | null;
    updated_at: string | null;
    last_edited_at: string | null;
    personal_sections?: { title?: string | null } | { title?: string | null }[] | null;
  }>;
  for (const row of personalRows) {
    const sectionTitle = Array.isArray(row.personal_sections)
      ? row.personal_sections[0]?.title
      : row.personal_sections?.title;
    fallbackRows.push({
      result_type: "personal",
      result_id: row.id,
      title: row.title,
      content_text: row.content_text,
      rank: null,
      section_title: sectionTitle || null,
      client_name: null,
      project_name: null,
      updated_at: row.updated_at,
      last_edited_at: row.last_edited_at,
    });
  }

  const taskRows = (taskResponse.data || []) as Array<{
    id: string;
    title: string;
    content_text: string | null;
    updated_at: string | null;
    last_edited_at: string | null;
    clients?: { name?: string | null } | { name?: string | null }[] | null;
    projects?: { name?: string | null } | { name?: string | null }[] | null;
  }>;
  for (const row of taskRows) {
    const clientName = Array.isArray(row.clients) ? row.clients[0]?.name : row.clients?.name;
    const projectName = Array.isArray(row.projects) ? row.projects[0]?.name : row.projects?.name;
    fallbackRows.push({
      result_type: "task",
      result_id: row.id,
      title: row.title,
      content_text: row.content_text,
      rank: null,
      section_title: null,
      client_name: clientName || null,
      project_name: projectName || null,
      updated_at: row.updated_at,
      last_edited_at: row.last_edited_at,
    });
  }

  fallbackRows.sort(compareByDateDesc);
  return NextResponse.json({ items: fallbackRows.slice(0, limit).map(mapToSuggestion) });
}

