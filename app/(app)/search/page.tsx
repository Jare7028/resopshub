import Link from "next/link";
import {
  buildPostgrestIlikeContainsFilter,
  buildPostgrestOrFilter,
} from "@/lib/postgrestFilters";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

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

type SearchHistoryRow = {
  query: string;
  search_type: string;
  section_id: string | null;
  client_id: string | null;
  last_used_at: string | null;
};

function toSnippet(value: string | null | undefined, limit = 180) {
  if (!value) {
    return "";
  }
  const clean = value.replace(/\s+/g, " ").trim();
  if (clean.length <= limit) {
    return clean;
  }
  return `${clean.slice(0, limit - 3)}...`;
}

function formatDate(value: string | null | undefined) {
  if (!value) {
    return "-";
  }
  return new Date(value).toLocaleString("en-US");
}

function normalizeType(value: string) {
  if (value === "personal" || value === "task" || value === "all") {
    return value;
  }
  return "all";
}

function buildSearchLink(params: {
  query: string;
  type: string;
  sectionId: string | null;
  clientId: string | null;
}) {
  const searchParams = new URLSearchParams();
  searchParams.set("q", params.query);
  if (params.type !== "all") {
    searchParams.set("type", params.type);
  }
  if (params.sectionId) {
    searchParams.set("section", params.sectionId);
  }
  if (params.clientId) {
    searchParams.set("client", params.clientId);
  }
  return `/search?${searchParams.toString()}`;
}

export default async function SearchPage(props: {
  searchParams?: Promise<{
    q?: string;
    type?: string;
    section?: string;
    client?: string;
  }>;
}) {
  const searchParams = await props.searchParams;
  const supabase = createSupabaseServerClient();
  const rawQuery = typeof searchParams?.q === "string" ? searchParams.q : "";
  const query = rawQuery.trim();
  const typeFilter = normalizeType(
    typeof searchParams?.type === "string" ? searchParams.type : "all"
  );
  const sectionFilter = typeof searchParams?.section === "string" ? searchParams.section : "";
  const clientFilter = typeof searchParams?.client === "string" ? searchParams.client : "";

  const sectionId = sectionFilter && sectionFilter !== "all" ? sectionFilter : null;
  const clientId = clientFilter && clientFilter !== "all" ? clientFilter : null;

  const { data: sections } = await supabase
    .from("personal_sections")
    .select("id,title")
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });

  const { data: clients } = await supabase
    .from("clients")
    .select("id,name")
    .order("name", { ascending: true });

  const sectionMap = new Map(
    (sections || []).map((section) => [section.id, section.title || "Section"])
  );
  const clientMap = new Map(
    (clients || []).map((client) => [client.id, client.name || "Client"])
  );

  let results: SearchResult[] = [];
  let searchError: string | null = null;

  if (query) {
    const { data: authData } = await supabase.auth.getUser();
    if (authData.user) {
      await supabase.from("search_history").upsert(
        {
          user_id: authData.user.id,
          query,
          search_type: typeFilter,
          section_id: sectionId,
          client_id: clientId,
          last_used_at: new Date().toISOString(),
        },
        { onConflict: "user_id,query,search_type,section_id,client_id" }
      );
    }

    const { data, error } = await supabase.rpc("search_notes", {
      query_text: query,
      filter_type: typeFilter,
      filter_section_id: sectionId,
      filter_client_id: clientId,
      result_limit: 60,
    });

    if (error) {
      searchError = error.message;
    } else {
      results = (data || []) as SearchResult[];
    }

    if (searchError) {
      const fallbackResults: SearchResult[] = [];
      const fallbackSearchFilter = buildPostgrestOrFilter([
        buildPostgrestIlikeContainsFilter("title", query),
        buildPostgrestIlikeContainsFilter("content_text", query),
      ]);

      if (typeFilter === "all" || typeFilter === "personal") {
        let personalQuery = supabase
          .from("personal_pages")
          .select("id,title,content_text,updated_at,last_edited_at,section_id,personal_sections(title)")
          .order("updated_at", { ascending: false })
          .limit(60);

        if (sectionId) {
          personalQuery = personalQuery.eq("section_id", sectionId);
        }

        personalQuery = personalQuery.or(fallbackSearchFilter);

        const { data: personalData } = await personalQuery;
        const personalRows =
          (personalData as Array<{
            id: string;
            title: string;
            content_text: string | null;
            updated_at: string | null;
            last_edited_at: string | null;
            personal_sections?: { title?: string | null } | { title?: string | null }[] | null;
          }> | null) || [];

        personalRows.forEach((row) => {
          const sectionTitle = Array.isArray(row.personal_sections)
            ? row.personal_sections[0]?.title
            : row.personal_sections?.title;
          fallbackResults.push({
            result_type: "personal",
            result_id: row.id,
            title: row.title,
            content_text: row.content_text,
            rank: null,
            section_title: sectionTitle || "General",
            client_name: null,
            project_name: null,
            updated_at: row.updated_at,
            last_edited_at: row.last_edited_at,
          });
        });
      }

      if (typeFilter === "all" || typeFilter === "task") {
        let taskQuery = supabase
          .from("tasks")
          .select("id,title,content_text,updated_at,last_edited_at,client_id,project_id,clients(name),projects(name)")
          .order("updated_at", { ascending: false })
          .limit(60);

        if (clientId) {
          taskQuery = taskQuery.eq("client_id", clientId);
        }

        taskQuery = taskQuery.or(fallbackSearchFilter);

        const { data: taskData } = await taskQuery;
        const taskRows =
          (taskData as Array<{
            id: string;
            title: string;
            content_text: string | null;
            updated_at: string | null;
            last_edited_at: string | null;
            clients?: { name?: string | null } | { name?: string | null }[] | null;
            projects?: { name?: string | null } | { name?: string | null }[] | null;
          }> | null) || [];

        taskRows.forEach((row) => {
          const clientName = Array.isArray(row.clients)
            ? row.clients[0]?.name
            : row.clients?.name;
          const projectName = Array.isArray(row.projects)
            ? row.projects[0]?.name
            : row.projects?.name;
          fallbackResults.push({
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
        });
      }

      fallbackResults.sort((a, b) => {
        const aDate = a.last_edited_at || a.updated_at || "";
        const bDate = b.last_edited_at || b.updated_at || "";
        if (aDate === bDate) return 0;
        return aDate < bDate ? 1 : -1;
      });

      results = fallbackResults.slice(0, 60);
    }
  }

  const { data: recentHistory } = await supabase
    .from("search_history")
    .select("query,search_type,section_id,client_id,last_used_at")
    .order("last_used_at", { ascending: false })
    .limit(6);

  const recentSearches = (recentHistory || []) as SearchHistoryRow[];

  return (
    <div className="space-y-8">
      <section className="space-y-2">
        <h1 className="text-2xl font-semibold text-slate-900">Search</h1>
        <p className="text-sm text-slate-600">
          Full-text search across personal pages and task notes.
        </p>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-6">
        <form className="grid gap-3 md:grid-cols-5">
          <input
            name="q"
            placeholder="Search titles and content"
            defaultValue={rawQuery}
            className="md:col-span-2 rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
          <select
            name="type"
            defaultValue={typeFilter}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
          >
            <option value="all">All types</option>
            <option value="personal">Personal pages</option>
            <option value="task">Task notes</option>
          </select>
          <select
            name="section"
            defaultValue={sectionId || "all"}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
          >
            <option value="all">All sections</option>
            {sections?.map((section) => (
              <option key={section.id} value={section.id}>
                {section.title}
              </option>
            ))}
          </select>
          <select
            name="client"
            defaultValue={clientId || "all"}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
          >
            <option value="all">All clients</option>
            {clients?.map((client) => (
              <option key={client.id} value={client.id}>
                {client.name}
              </option>
            ))}
          </select>
          <button
            type="submit"
            className="md:col-span-5 rounded-md btn-primary px-4 py-2 text-sm font-semibold text-white"
          >
            Search
          </button>
        </form>
      </section>

      {recentSearches.length ? (
        <section className="rounded-lg border border-slate-200 bg-white p-6">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
              Recent searches
            </h2>
            <span className="text-xs text-slate-400">
              Click to re-run a search
            </span>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {recentSearches.map((item, index) => {
              const labelParts = [item.query];
              if (item.search_type && item.search_type !== "all") {
                labelParts.push(item.search_type);
              }
              if (item.section_id) {
                labelParts.push(sectionMap.get(item.section_id) || "Section");
              }
              if (item.client_id) {
                labelParts.push(clientMap.get(item.client_id) || "Client");
              }
              const href = buildSearchLink({
                query: item.query,
                type: item.search_type || "all",
                sectionId: item.section_id,
                clientId: item.client_id,
              });
              return (
                <Link
                  key={`${item.query}-${index}`}
                  href={href}
                  className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs text-slate-700 hover:bg-slate-100"
                >
                  {labelParts.join(" - ")}
                </Link>
              );
            })}
          </div>
        </section>
      ) : null}

      {!query ? (
        <p className="text-sm text-slate-500">Enter a search term to get started.</p>
      ) : (
        <section className="rounded-lg border border-slate-200 bg-white">
          <div className="border-b border-slate-200 px-6 py-4">
            <h2 className="text-lg font-semibold text-slate-900">
              Results ({results.length})
            </h2>
          </div>
          {searchError ? (
            <div className="border-b border-amber-200 bg-amber-50 px-6 py-3 text-xs text-amber-700">
              Search index is not configured. Showing fallback results. Run
              `search_rank.sql` in Supabase to enable full-text search.
            </div>
          ) : null}
          <div className="divide-y divide-slate-200">
            {results.length ? (
              results.map((result) => {
                const isPersonal = result.result_type === "personal";
                const href = isPersonal
                  ? `/personal/${result.result_id}`
                  : `/tasks/${result.result_id}`;
                const metaLine = isPersonal
                  ? `Section: ${result.section_title || "General"}`
                  : `${result.client_name || "Client"} - ${
                      result.project_name || "Project"
                    }`;
                return (
                  <div key={`${result.result_type}-${result.result_id}`} className="px-6 py-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="rounded-full bg-slate-100 px-2 py-1 text-[10px] font-semibold uppercase text-slate-500">
                          {isPersonal ? "Personal" : "Task"}
                        </span>
                        <Link
                          href={href}
                          className="text-sm font-semibold text-slate-900 hover:underline"
                        >
                          {result.title}
                        </Link>
                      </div>
                      <span className="text-xs text-slate-400">
                        Last edited {formatDate(result.last_edited_at || result.updated_at)}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-slate-500">{metaLine}</p>
                    {result.content_text ? (
                      <p className="mt-2 text-sm text-slate-600">
                        {toSnippet(result.content_text)}
                      </p>
                    ) : null}
                  </div>
                );
              })
            ) : (
              <p className="px-6 py-6 text-sm text-slate-500">
                No results found for &quot;{query}&quot;.
              </p>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
