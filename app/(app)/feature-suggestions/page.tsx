import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import FeatureSuggestionControls from "./FeatureSuggestionControls";
import FeatureSuggestionStatus from "./FeatureSuggestionStatus";
import Link from "next/link";

type SuggestionRow = {
  id: string;
  title: string;
  details: string | null;
  status: string | null;
  type: string | null;
  created_at: string;
  closed_at: string | null;
  created_by: string | null;
};

type SuggestionVoteRow = {
  suggestion_id: string;
  user_id: string;
  value: number | null;
};

const statusOptions = ["idea", "needs_checking", "planned", "completed", "rejected"] as const;
const typeOptions = ["bug", "improvement", "new_feature"] as const;

const formatStatusLabel = (status: string) =>
  status
    .split("_")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");

const formatTypeLabel = (type: string) =>
  type
    .split("_")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");

const summarizeDescription = (value: string | null, maxLength = 120) => {
  if (!value) return "";
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) return "";

  const punctuationIndexes = [".", "!", "?"]
    .map((char) => normalized.indexOf(char))
    .filter((index) => index >= 0);
  const firstSentenceEnd = punctuationIndexes.length
    ? Math.min(...punctuationIndexes) + 1
    : normalized.length;

  let summary = normalized.slice(0, firstSentenceEnd).trim();
  if (summary.length > maxLength) {
    summary = `${summary.slice(0, maxLength - 3).trimEnd()}...`;
  }
  return summary;
};

type SuggestionUserRow = {
  id: string;
  full_name: string | null;
  email: string | null;
};

type SuggestionAuthorRow = { created_by: string | null };

const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const dateRegex = /^\d{4}-\d{2}-\d{2}$/;

function sanitizeSearchQuery(value: string) {
  return value
    .replace(/[^a-zA-Z0-9\s\-_]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildFeatureSuggestionsReturnUrl(
  baseQuery: string,
  message?: { error?: string; success?: string }
) {
  const params = new URLSearchParams(baseQuery);
  if (message?.error) {
    params.set("error", message.error);
    params.delete("success");
  }
  if (message?.success) {
    params.set("success", message.success);
    params.delete("error");
  }
  const query = params.toString();
  return query ? `/feature-suggestions?${query}` : "/feature-suggestions";
}

function isMissingFeatureSuggestionClosedAtColumnError(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const message = String((error as { message?: unknown }).message || "").toLowerCase();
  return (
    message.includes("feature_suggestions.closed_at") &&
    message.includes("does not exist")
  );
}

function normalizeFeatureView(value: string | undefined): "table" | "gantt" | "board" {
  if (value === "gantt" || value === "board") return value;
  return "table";
}

function toDate(value?: string | null) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function toDayStamp(date: Date) {
  return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
}

function diffDays(start: Date, end: Date) {
  const dayMs = 1000 * 60 * 60 * 24;
  return Math.round((toDayStamp(end) - toDayStamp(start)) / dayMs);
}

function formatTick(date: Date) {
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export default async function FeatureSuggestionsPage(props: {
  searchParams?: Promise<{
    error?: string;
    success?: string;
    hide?: string;
    sort?: string;
    open?: string;
    status?: string;
    type?: string;
    submitted_by?: string;
    q?: string;
    date_from?: string;
    date_to?: string;
    my_votes?: string;
    has_comments?: string;
    view?: string;
  }>;
}) {
  const searchParams = await props.searchParams;
  const supabase = createSupabaseServerClient();
  const { data: authData } = await supabase.auth.getUser();
  const authEmail = authData.user?.email;
  const hideCompleted = (searchParams?.hide ?? "1").trim() !== "0";
  const selectedSort = (searchParams?.sort || "latest").trim();
  const selectedStatusParam = (searchParams?.status || "all").trim();
  const selectedTypeParam = (searchParams?.type || "all").trim();
  const selectedSubmittedByParam = (searchParams?.submitted_by || "all").trim();
  const queryParam = (searchParams?.q || "").trim();
  const dateFromParam = (searchParams?.date_from || "").trim();
  const dateToParam = (searchParams?.date_to || "").trim();
  const onlyMyVotes = (searchParams?.my_votes || "0").trim() === "1";
  const onlyWithComments = (searchParams?.has_comments || "0").trim() === "1";
  const selectedView = normalizeFeatureView((searchParams?.view || "").trim());

  if (!authEmail) {
    redirect("/login");
  }

  const { data: currentUser } = await supabase
    .from("users")
    .select("id,full_name,email,role")
    .eq("email", authEmail)
    .maybeSingle();

  if (!currentUser?.id) {
    redirect("/tasks?error=Missing%20user%20profile");
  }

  const selectedStatus =
    selectedStatusParam === "all" ||
    statusOptions.includes(selectedStatusParam as (typeof statusOptions)[number])
      ? selectedStatusParam
      : "all";

  const selectedType =
    selectedTypeParam === "all" ||
    typeOptions.includes(selectedTypeParam as (typeof typeOptions)[number])
      ? selectedTypeParam
      : "all";

  const selectedSubmittedBy =
    selectedSubmittedByParam === "all" ||
    selectedSubmittedByParam === "me" ||
    uuidRegex.test(selectedSubmittedByParam)
      ? selectedSubmittedByParam
      : "all";

  const query = sanitizeSearchQuery(queryParam);
  const dateFrom = dateRegex.test(dateFromParam) ? dateFromParam : "";
  const dateTo = dateRegex.test(dateToParam) ? dateToParam : "";

  const baseParams = new URLSearchParams();
  baseParams.set("hide", hideCompleted ? "1" : "0");
  if (selectedSort && selectedSort !== "latest") {
    baseParams.set("sort", selectedSort);
  }
  if (selectedStatus !== "all") {
    baseParams.set("status", selectedStatus);
  }
  if (selectedType !== "all") {
    baseParams.set("type", selectedType);
  }
  if (selectedSubmittedBy !== "all") {
    baseParams.set("submitted_by", selectedSubmittedBy);
  }
  if (query) {
    baseParams.set("q", query);
  }
  if (dateFrom) {
    baseParams.set("date_from", dateFrom);
  }
  if (dateTo) {
    baseParams.set("date_to", dateTo);
  }
  if (onlyMyVotes) {
    baseParams.set("my_votes", "1");
  }
  if (onlyWithComments) {
    baseParams.set("has_comments", "1");
  }
  if (selectedView !== "table") {
    baseParams.set("view", selectedView);
  }
  const returnBaseQuery = baseParams.toString();
  const returnTo = buildFeatureSuggestionsReturnUrl(returnBaseQuery);

  const resetParams = new URLSearchParams();
  resetParams.set("hide", hideCompleted ? "1" : "0");
  if (selectedSort && selectedSort !== "latest") {
    resetParams.set("sort", selectedSort);
  }
  if (selectedView !== "table") {
    resetParams.set("view", selectedView);
  }
  const resetQuery = resetParams.toString();
  const resetUrl = resetQuery ? `/feature-suggestions?${resetQuery}` : "/feature-suggestions";

  const { data: authors } = await supabase
    .from("feature_suggestions")
    .select("created_by")
    .not("created_by", "is", null);

  const authorIds = Array.from(
    new Set(
      ((authors || []) as SuggestionAuthorRow[])
        .map((row) => row.created_by)
        .filter(Boolean) as string[]
    )
  );

  const { data: authorUsers } = authorIds.length
    ? await supabase
        .from("users")
        .select("id,full_name,email")
        .in("id", authorIds)
        .order("full_name", { ascending: true })
    : { data: [] as SuggestionUserRow[] };

  const buildSuggestionsQuery = (includeClosedAt: boolean) => {
    let queryBuilder = supabase
      .from("feature_suggestions")
      .select(
        includeClosedAt
          ? "id,title,details,status,type,created_at,closed_at,created_by"
          : "id,title,details,status,type,created_at,created_by"
      )
      .order("created_at", { ascending: false });

    if (selectedStatus !== "all") {
      queryBuilder = queryBuilder.eq("status", selectedStatus);
    } else if (hideCompleted) {
      queryBuilder = queryBuilder.not("status", "in", "(completed,rejected)");
    }

    if (selectedType !== "all") {
      queryBuilder = queryBuilder.eq("type", selectedType);
    }

    if (selectedSubmittedBy !== "all") {
      const submittedByUserId =
        selectedSubmittedBy === "me" ? currentUser.id : selectedSubmittedBy;
      queryBuilder = queryBuilder.eq("created_by", submittedByUserId);
    }

    if (query) {
      queryBuilder = queryBuilder.or(`title.ilike.%${query}%,details.ilike.%${query}%`);
    }

    if (dateFrom) {
      queryBuilder = queryBuilder.gte("created_at", `${dateFrom}T00:00:00Z`);
    }

    if (dateTo) {
      queryBuilder = queryBuilder.lte("created_at", `${dateTo}T23:59:59.999Z`);
    }

    return queryBuilder;
  };

  const suggestionsWithClosedAt = await buildSuggestionsQuery(true);
  let suggestions = suggestionsWithClosedAt.data as SuggestionRow[] | null;
  let suggestionsError = suggestionsWithClosedAt.error;

  if (suggestionsError && isMissingFeatureSuggestionClosedAtColumnError(suggestionsError)) {
    const suggestionsWithoutClosedAt = await buildSuggestionsQuery(false);
    suggestionsError = suggestionsWithoutClosedAt.error;
    suggestions = ((suggestionsWithoutClosedAt.data || []) as unknown as Array<
      Omit<SuggestionRow, "closed_at">
    >).map((row) => ({ ...row, closed_at: null }));
  }

  let suggestionRows = (suggestions || []) as SuggestionRow[];
  const suggestionIds = suggestionRows.map((row) => row.id);

  const votes: SuggestionVoteRow[] = suggestionIds.length
    ? ((
        await supabase
          .from("feature_suggestion_votes")
          .select("suggestion_id,user_id,value")
          .in("suggestion_id", suggestionIds)
      ).data as SuggestionVoteRow[]) || []
    : [];

  const voteScores = new Map<string, number>();
  const upvoteCounts = new Map<string, number>();
  const downvoteCounts = new Map<string, number>();
  const userVotes = new Map<string, number>();

  (votes || []).forEach((vote) => {
    const value = vote.value === -1 ? -1 : 1;

    voteScores.set(
      vote.suggestion_id,
      (voteScores.get(vote.suggestion_id) || 0) + value
    );
    if (value === 1) {
      upvoteCounts.set(
        vote.suggestion_id,
        (upvoteCounts.get(vote.suggestion_id) || 0) + 1
      );
    } else {
      downvoteCounts.set(
        vote.suggestion_id,
        (downvoteCounts.get(vote.suggestion_id) || 0) + 1
      );
    }

    if (vote.user_id === currentUser.id) {
      userVotes.set(vote.suggestion_id, value);
    }
  });

  const comments = suggestionIds.length
    ? ((
        await supabase
          .from("feature_suggestion_comments")
          .select("suggestion_id")
          .in("suggestion_id", suggestionIds)
      ).data as Array<{ suggestion_id: string }>) || []
    : [];

  const commentCounts = new Map<string, number>();

  (comments || []).forEach((comment) => {
    commentCounts.set(
      comment.suggestion_id,
      (commentCounts.get(comment.suggestion_id) || 0) + 1
    );
  });

  if (onlyMyVotes) {
    suggestionRows = suggestionRows.filter((suggestion) => userVotes.get(suggestion.id) === 1);
  }

  if (onlyWithComments) {
    suggestionRows = suggestionRows.filter(
      (suggestion) => (commentCounts.get(suggestion.id) || 0) > 0
    );
  }

  async function createSuggestion(formData: FormData) {
    "use server";
    const supabase = createSupabaseServerClient();
    const title = String(formData.get("title") || "").trim();
    const details = String(formData.get("details") || "").trim();
    const type = String(formData.get("type") || "new_feature").trim();

    if (!["bug", "improvement", "new_feature"].includes(type)) {
      redirect(
        buildFeatureSuggestionsReturnUrl(returnBaseQuery, {
          error: "Invalid request type",
        })
      );
    }

    if (!title) {
      redirect(
        buildFeatureSuggestionsReturnUrl(returnBaseQuery, {
          error: "Title is required",
        })
      );
    }

    const { data: authData } = await supabase.auth.getUser();
    const authEmail = authData.user?.email;

    if (!authEmail) {
      redirect("/login");
    }

    const { data: user } = await supabase
      .from("users")
      .select("id")
      .eq("email", authEmail)
      .maybeSingle();

    if (!user?.id) {
      redirect(
        buildFeatureSuggestionsReturnUrl(returnBaseQuery, {
          error: "Missing user profile",
        })
      );
    }

    const { error } = await supabase.from("feature_suggestions").insert({
      title,
      details: details || null,
      type,
      created_by: user.id,
    });

    if (error) {
      redirect(
        buildFeatureSuggestionsReturnUrl(returnBaseQuery, { error: error.message })
      );
    }

    revalidatePath("/feature-suggestions");
    redirect(
      buildFeatureSuggestionsReturnUrl(returnBaseQuery, {
        success: "Suggestion submitted",
      })
    );
  }

  async function toggleVote(formData: FormData) {
    "use server";
    const supabase = createSupabaseServerClient();
    const suggestionId = String(formData.get("suggestion_id") || "").trim();
    const direction = String(formData.get("vote") || "up").trim().toLowerCase();
    const desiredValue = direction === "down" ? -1 : 1;

    if (!suggestionId) {
      redirect(
        buildFeatureSuggestionsReturnUrl(returnBaseQuery, {
          error: "Missing suggestion id",
        })
      );
    }

    const { data: authData } = await supabase.auth.getUser();
    const authEmail = authData.user?.email;

    if (!authEmail) {
      redirect("/login");
    }

    const { data: user } = await supabase
      .from("users")
      .select("id")
      .eq("email", authEmail)
      .maybeSingle();

    if (!user?.id) {
      redirect(
        buildFeatureSuggestionsReturnUrl(returnBaseQuery, {
          error: "Missing user profile",
        })
      );
    }

    const { data: existing } = await supabase
      .from("feature_suggestion_votes")
      .select("value")
      .eq("suggestion_id", suggestionId)
      .eq("user_id", user.id)
      .maybeSingle();

    const existingValue = existing?.value === -1 ? -1 : existing?.value === 1 ? 1 : null;

    if (existingValue === desiredValue) {
      const { error } = await supabase
        .from("feature_suggestion_votes")
        .delete()
        .eq("suggestion_id", suggestionId)
        .eq("user_id", user.id);

      if (error) {
        redirect(buildFeatureSuggestionsReturnUrl(returnBaseQuery, { error: error.message }));
      }
    } else if (existingValue !== null) {
      const { error } = await supabase
        .from("feature_suggestion_votes")
        .update({ value: desiredValue })
        .eq("suggestion_id", suggestionId)
        .eq("user_id", user.id);

      if (error) {
        redirect(buildFeatureSuggestionsReturnUrl(returnBaseQuery, { error: error.message }));
      }
    } else {
      const { error } = await supabase.from("feature_suggestion_votes").insert({
        suggestion_id: suggestionId,
        user_id: user.id,
        value: desiredValue,
      });

      if (error) {
        redirect(buildFeatureSuggestionsReturnUrl(returnBaseQuery, { error: error.message }));
      }
    }

    revalidatePath("/feature-suggestions");
    return;
  }

  async function updateStatus(formData: FormData) {
    "use server";
    const supabase = createSupabaseServerClient();
    const suggestionId = String(formData.get("suggestion_id") || "").trim();
    const status = String(formData.get("status") || "").trim();

    if (!suggestionId || !status) {
      redirect(
        buildFeatureSuggestionsReturnUrl(returnBaseQuery, {
          error: "Missing status update",
        })
      );
    }

    if (!statusOptions.includes(status as (typeof statusOptions)[number])) {
      redirect(
        buildFeatureSuggestionsReturnUrl(returnBaseQuery, { error: "Invalid status" })
      );
    }

    const shouldClose = status === "completed" || status === "rejected";
    let { error } = await supabase
      .from("feature_suggestions")
      .update({ status, closed_at: shouldClose ? new Date().toISOString() : null })
      .eq("id", suggestionId);

    if (error && isMissingFeatureSuggestionClosedAtColumnError(error)) {
      const retry = await supabase
        .from("feature_suggestions")
        .update({ status })
        .eq("id", suggestionId);
      error = retry.error;
    }

    if (error) {
      redirect(
        buildFeatureSuggestionsReturnUrl(returnBaseQuery, { error: error.message })
      );
    }

    revalidatePath("/feature-suggestions");
    redirect(returnTo);
  }

  if (selectedSort === "most_upvoted") {
    suggestionRows = [...suggestionRows].sort((a, b) => {
      const aScore = voteScores.get(a.id) || 0;
      const bScore = voteScores.get(b.id) || 0;
      if (bScore !== aScore) {
        return bScore - aScore;
      }
      const aUp = upvoteCounts.get(a.id) || 0;
      const bUp = upvoteCounts.get(b.id) || 0;
      if (bUp !== aUp) {
        return bUp - aUp;
      }
      return a.created_at < b.created_at ? 1 : -1;
    });
  }

  const buildViewUrl = (nextView: "table" | "gantt" | "board") => {
    const params = new URLSearchParams(returnBaseQuery);
    if (nextView === "table") {
      params.delete("view");
    } else {
      params.set("view", nextView);
    }
    const query = params.toString();
    return query ? `/feature-suggestions?${query}` : "/feature-suggestions";
  };

  const ganttData = (() => {
    const normalized = suggestionRows.map((suggestion) => {
      const start = toDate(suggestion.created_at) || new Date();
      const closedAt = toDate(suggestion.closed_at);
      const end = closedAt && closedAt > start ? closedAt : start;
      return { ...suggestion, start, end };
    });

    if (!normalized.length) {
      const today = new Date();
      return { items: normalized, rangeStart: today, rangeDays: 1 };
    }

    const rangeStart = normalized.reduce(
      (min, suggestion) => (suggestion.start < min ? suggestion.start : min),
      normalized[0].start
    );
    const rangeEnd = normalized.reduce(
      (max, suggestion) => (suggestion.end > max ? suggestion.end : max),
      normalized[0].end
    );
    const rangeDays = Math.max(1, diffDays(rangeStart, rangeEnd) + 1);

    return { items: normalized, rangeStart, rangeDays };
  })();

  const timelineTicks = (() => {
    const ticks = [];
    const steps = 4;
    for (let i = 0; i <= steps; i += 1) {
      const offset = Math.round((ganttData.rangeDays - 1) * (i / steps));
      const tickDate = new Date(ganttData.rangeStart);
      tickDate.setDate(tickDate.getDate() + offset);
      ticks.push({ label: formatTick(tickDate), left: (i / steps) * 100 });
    }
    return ticks;
  })();

  const timelineWidth = Math.max(560, ganttData.rangeDays * 18);

  const boardByStatus = statusOptions.reduce<Record<string, SuggestionRow[]>>((acc, status) => {
    acc[status] = [];
    return acc;
  }, {});
  suggestionRows.forEach((suggestion) => {
    const status = suggestion.status || "idea";
    const key = boardByStatus[status] ? status : "idea";
    boardByStatus[key].push(suggestion);
  });

  return (
    <div className="space-y-8">
      <section className="space-y-2">
        <h1 className="text-2xl font-semibold text-slate-900">
          Feature suggestions
        </h1>
        <p className="text-sm text-slate-600">
          Share ideas and upvote the ones you want built next.
        </p>
      </section>

      {(searchParams?.error || searchParams?.success || suggestionsError) && (
        <div className="space-y-2">
          {suggestionsError ? (
            <p className="rounded-md border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
              {suggestionsError.message}
            </p>
          ) : null}
          {searchParams?.error ? (
            <p className="rounded-md border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
              {searchParams.error}
            </p>
          ) : null}
          {searchParams?.success ? (
            <p className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-700">
              {searchParams.success}
            </p>
          ) : null}
        </div>
      )}

      <section className="rounded-lg border border-slate-200 bg-white p-6">
        <h2 className="text-lg font-semibold text-slate-900">Submit a suggestion</h2>
        <form action={createSuggestion} className="mt-4 grid gap-4">
          <input
            name="title"
            placeholder="Short title"
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            required
          />
          <select
            name="type"
            defaultValue="new_feature"
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          >
            <option value="bug">Bug</option>
            <option value="improvement">Improvement</option>
            <option value="new_feature">New Feature</option>
          </select>
          <textarea
            name="details"
            rows={4}
            placeholder="Describe the problem, ideal solution, and why it matters."
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
          <button
            type="submit"
            className="w-fit rounded-md btn-primary px-4 py-2 text-sm font-semibold text-white"
          >
            Submit suggestion
          </button>
        </form>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white">
        <div className="border-b border-slate-200 px-6 py-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-semibold text-slate-900">Ideas</h2>
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex flex-wrap gap-2 text-sm">
                <Link
                  href={buildViewUrl("table")}
                  className={`rounded-md px-3 py-1.5 font-medium ${
                    selectedView === "table"
                      ? "tab-active"
                      : "border border-slate-200 text-slate-700 hover:bg-slate-100 hover:text-slate-900"
                  }`}
                >
                  Table
                </Link>
                <Link
                  href={buildViewUrl("gantt")}
                  className={`rounded-md px-3 py-1.5 font-medium ${
                    selectedView === "gantt"
                      ? "tab-active"
                      : "border border-slate-200 text-slate-700 hover:bg-slate-100 hover:text-slate-900"
                  }`}
                >
                  Gantt
                </Link>
                <Link
                  href={buildViewUrl("board")}
                  className={`rounded-md px-3 py-1.5 font-medium ${
                    selectedView === "board"
                      ? "tab-active"
                      : "border border-slate-200 text-slate-700 hover:bg-slate-100 hover:text-slate-900"
                  }`}
                >
                  Board
                </Link>
              </div>
              <FeatureSuggestionControls
                hideCompleted={hideCompleted}
                selectedSort={selectedSort === "most_upvoted" ? "most_upvoted" : "latest"}
              />
            </div>
          </div>
        </div>
        <div className="border-b border-slate-200 px-6 py-4">
          <form className="flex flex-wrap items-end gap-3">
            <input type="hidden" name="hide" value={hideCompleted ? "1" : "0"} />
            {selectedView !== "table" ? (
              <input type="hidden" name="view" value={selectedView} />
            ) : null}
            {selectedSort && selectedSort !== "latest" ? (
              <input type="hidden" name="sort" value={selectedSort} />
            ) : null}
            <input
              name="q"
              placeholder="Search ideas"
              defaultValue={query || ""}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm md:w-64"
            />
            <select
              name="status"
              defaultValue={selectedStatus}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm md:w-52"
            >
              <option value="all">All statuses</option>
              {statusOptions.map((status) => (
                <option key={status} value={status}>
                  {formatStatusLabel(status)}
                </option>
              ))}
            </select>
            <select
              name="type"
              defaultValue={selectedType}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm md:w-48"
            >
              <option value="all">All types</option>
              {typeOptions.map((type) => (
                <option key={type} value={type}>
                  {formatTypeLabel(type)}
                </option>
              ))}
            </select>
            <select
              name="submitted_by"
              defaultValue={selectedSubmittedBy}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm md:w-64"
            >
              <option value="all">Submitted by anyone</option>
              <option value="me">Submitted by me</option>
              {(authorUsers || []).map((user) => (
                <option key={user.id} value={user.id}>
                  {user.full_name || user.email || "Unknown user"}
                </option>
              ))}
            </select>
            <input
              type="date"
              name="date_from"
              defaultValue={dateFrom}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm md:w-44"
              title="From date"
            />
            <input
              type="date"
              name="date_to"
              defaultValue={dateTo}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm md:w-44"
              title="To date"
            />
            <label className="flex items-center gap-2 text-xs text-slate-600">
              <input type="checkbox" name="my_votes" value="1" defaultChecked={onlyMyVotes} />
              Upvoted by me
            </label>
            <label className="flex items-center gap-2 text-xs text-slate-600">
              <input
                type="checkbox"
                name="has_comments"
                value="1"
                defaultChecked={onlyWithComments}
              />
              Has comments
            </label>
            <button
              type="submit"
              className="rounded-md btn-primary px-4 py-2 text-sm font-semibold text-white"
            >
              Apply filters
            </button>
            <Link
              href={resetUrl}
              className="rounded-md border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              Clear
            </Link>
          </form>
        </div>
        <div className={selectedView === "table" ? "overflow-x-auto" : "hidden"}>
          <table className="min-w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-6 py-3">Title</th>
                <th className="px-6 py-3">Description</th>
                <th className="px-6 py-3">Status</th>
                <th className="px-6 py-3">Type</th>
                <th className="px-6 py-3 text-right">Score</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {suggestionRows.length ? (
                suggestionRows.map((suggestion) => {
                  const scoreForSuggestion = voteScores.get(suggestion.id) || 0;
                  const userVote = userVotes.get(suggestion.id) || 0;
                  return (
                    <tr key={suggestion.id}>
                      <td className="px-6 py-3 font-semibold text-slate-900">{suggestion.title}</td>
                      <td className="max-w-xl px-6 py-3 text-slate-600">
                        <p className="truncate" title={suggestion.details || ""}>
                          {summarizeDescription(suggestion.details) || "--"}
                        </p>
                      </td>
                      <td className="px-6 py-3">
                        <FeatureSuggestionStatus
                          suggestionId={suggestion.id}
                          defaultStatus={suggestion.status || "idea"}
                          statusOptions={statusOptions}
                          onUpdate={updateStatus}
                        />
                      </td>
                      <td className="px-6 py-3 text-slate-700">
                        {formatTypeLabel(suggestion.type || "new_feature")}
                      </td>
                      <td className="px-6 py-3">
                        <form action={toggleVote} className="flex items-center justify-end gap-2">
                          <input type="hidden" name="suggestion_id" value={suggestion.id} />
                          <span className="min-w-8 text-right text-sm font-semibold text-slate-700">
                            {scoreForSuggestion}
                          </span>
                          <button
                            type="submit"
                            name="vote"
                            value="up"
                            title="Upvote"
                            aria-label={`Upvote ${suggestion.title}`}
                            className={`rounded-md px-2 py-1 text-xs font-semibold ${
                              userVote === 1
                                ? "bg-slate-900 text-white"
                                : "border border-slate-300 text-slate-700 hover:border-slate-400"
                            }`}
                          >
                            👍
                          </button>
                          <button
                            type="submit"
                            name="vote"
                            value="down"
                            title="Downvote"
                            aria-label={`Downvote ${suggestion.title}`}
                            className={`rounded-md px-2 py-1 text-xs font-semibold ${
                              userVote === -1
                                ? "bg-slate-900 text-white"
                                : "border border-slate-300 text-slate-700 hover:border-slate-400"
                            }`}
                          >
                            👎
                          </button>
                        </form>
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td className="px-6 py-6 text-sm text-slate-500" colSpan={5}>
                    No suggestions yet. Be the first to submit one.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {selectedView === "gantt" ? (
          <div className="overflow-x-auto px-6 py-4">
            {ganttData.items.length ? (
              <div className="min-w-[560px]" style={{ width: timelineWidth }}>
                <div className="relative mb-2 h-8 border-b border-slate-200">
                  {timelineTicks.map((tick) => (
                    <span
                      key={`${tick.label}-${tick.left}`}
                      className="absolute top-0 -translate-x-1/2 text-xs text-slate-400"
                      style={{ left: `${tick.left}%` }}
                    >
                      {tick.label}
                    </span>
                  ))}
                </div>
                <div className="space-y-3">
                  {ganttData.items.map((suggestion) => {
                    const startOffset = diffDays(ganttData.rangeStart, suggestion.start);
                    const duration = Math.max(1, diffDays(suggestion.start, suggestion.end) + 1);
                    const leftPercent = (startOffset / ganttData.rangeDays) * 100;
                    const widthPercent = (duration / ganttData.rangeDays) * 100;
                    return (
                      <div key={suggestion.id} className="grid grid-cols-[260px_1fr] items-center gap-3">
                        <div className="truncate text-sm font-medium text-slate-700">
                          {suggestion.title}
                        </div>
                        <div className="relative h-8 rounded-md bg-slate-100">
                          <div
                            className="absolute top-1 h-6 rounded-md bg-slate-900/80 px-2 text-xs font-semibold leading-6 text-white"
                            style={{
                              left: `${Math.max(0, leftPercent)}%`,
                              width: `${Math.max(2, widthPercent)}%`,
                            }}
                            title={`${new Date(suggestion.created_at).toLocaleDateString()} -> ${
                              suggestion.closed_at
                                ? new Date(suggestion.closed_at).toLocaleDateString()
                                : new Date(suggestion.created_at).toLocaleDateString()
                            }`}
                          >
                            {formatStatusLabel(suggestion.status || "idea")}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : (
              <p className="py-4 text-sm text-slate-500">No suggestions yet.</p>
            )}
          </div>
        ) : null}
        {selectedView === "board" ? (
          <div className="overflow-x-auto px-6 py-4">
            {suggestionRows.length ? (
              <div className="grid min-w-[960px] grid-cols-5 gap-4">
                {statusOptions.map((status) => {
                  const items = boardByStatus[status] || [];
                  return (
                    <section
                      key={status}
                      className="rounded-lg border border-slate-200 bg-slate-50 p-3"
                    >
                      <h3 className="mb-3 text-sm font-semibold text-slate-700">
                        {formatStatusLabel(status)} ({items.length})
                      </h3>
                      <div className="space-y-3">
                        {items.length ? (
                          items.map((suggestion) => {
                            const score = voteScores.get(suggestion.id) || 0;
                            return (
                              <div
                                key={suggestion.id}
                                className="rounded-md border border-slate-200 bg-white p-3"
                              >
                                <p className="text-sm font-semibold text-slate-900">
                                  {suggestion.title}
                                </p>
                                <p className="mt-1 text-xs text-slate-500">
                                  {formatTypeLabel(suggestion.type || "new_feature")} - Score {score}
                                </p>
                                <p className="mt-1 text-xs text-slate-500">
                                  {new Date(suggestion.created_at).toLocaleDateString()}
                                  {suggestion.closed_at
                                    ? ` -> ${new Date(suggestion.closed_at).toLocaleDateString()}`
                                    : ""}
                                </p>
                                <div className="mt-2">
                                  <FeatureSuggestionStatus
                                    suggestionId={suggestion.id}
                                    defaultStatus={suggestion.status || "idea"}
                                    statusOptions={statusOptions}
                                    onUpdate={updateStatus}
                                  />
                                </div>
                              </div>
                            );
                          })
                        ) : (
                          <p className="text-xs text-slate-500">No suggestions</p>
                        )}
                      </div>
                    </section>
                  );
                })}
              </div>
            ) : (
              <p className="py-4 text-sm text-slate-500">No suggestions yet.</p>
            )}
          </div>
        ) : null}
      </section>
    </div>
  );
}
