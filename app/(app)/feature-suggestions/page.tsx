import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import MentionTextareaField from "@/app/(app)/_components/MentionTextareaField";
import { notifyMentionedUsersFromTextChange } from "@/lib/mentionNotifications";
import {
  buildPostgrestIlikeContainsFilter,
  buildPostgrestOrFilter,
} from "@/lib/postgrestFilters";
import { parseCsvParam, setCsvParam } from "@/lib/queryParams";
import { getCurrentRequestUser } from "@/lib/supabase/currentUser";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { logError } from "@/lib/vercelLogger";
import {
  isSupabaseMissingColumnError,
  isSupabaseMissingFunctionError,
} from "@/lib/supabaseErrors";
import FeatureSuggestionsTable from "./FeatureSuggestionsTable";
import {
  buildStatusColorMap,
  buildHiddenStatusValues,
  buildStatusOptionsWithMetadata,
  DEFAULT_FEATURE_SUGGESTION_STATUS_OPTIONS,
  normalizeStatusValue,
} from "@/lib/statusOptions";

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

type SortKey = "title" | "status" | "type" | "score" | "created_at";
type SortDir = "asc" | "desc";

const typeOptions = ["bug", "improvement", "new_feature"] as const;

type StatusOptionRow = {
  entity_type: "feature_suggestion";
  value: string;
  position: number;
  is_visible?: boolean | null;
  counts_as_completed?: boolean | null;
  color_hex?: string | null;
};

type StatusOptionsResult = {
  data: Array<StatusOptionRow> | null;
  error: {
    message: string;
    code?: string;
    details?: string | null;
    hint?: string | null;
  } | null;
};

function sanitizeSearchQuery(value: string) {
  return value
    .replace(/[^a-zA-Z0-9\s\-_]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isMissingFeatureSuggestionClosedAtColumnError(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const message = String((error as { message?: unknown }).message || "").toLowerCase();
  return (
    message.includes("feature_suggestions.closed_at") &&
    message.includes("does not exist")
  );
}

function normalizeSortKey(value: string | undefined): SortKey {
  if (value === "title" || value === "status" || value === "type" || value === "score") {
    return value;
  }
  return "created_at";
}

function normalizeSortDir(value: string | undefined, sortKey: SortKey): SortDir {
  if (value === "asc" || value === "desc") {
    return value;
  }
  return sortKey === "title" || sortKey === "status" || sortKey === "type" ? "asc" : "desc";
}

export default async function FeatureSuggestionsPage(props: {
  searchParams?: Promise<{
    error?: string;
    success?: string;
    view?: string;
    hide?: string;
    sort?: string;
    dir?: string;
    status?: string | string[];
    type?: string | string[];
    q?: string;
  }>;
}) {
  const searchParams = await props.searchParams;
  const supabase = createSupabaseServerClient();
  const authUser = await getCurrentRequestUser(supabase, "feature_suggestions.page.auth");
  const authEmail = authUser?.email;

  if (!authEmail) {
    redirect("/login");
  }

  const { data: currentUser } = await supabase
    .from("users")
    .select("id")
    .eq("email", authEmail)
    .maybeSingle();

  if (!currentUser?.id) {
    redirect("/tasks?error=Missing%20user%20profile");
  }

  const canEditResult = await supabase.rpc("can_edit_page", {
    p_page_key: "feature_suggestions",
  });

  let canEditFeatureSuggestions = true;
  let featureSuggestionsPermissionErrorMessage: string | null = null;

  if (canEditResult.error) {
    if (!isSupabaseMissingFunctionError(canEditResult.error)) {
      featureSuggestionsPermissionErrorMessage = `Could not verify page edit permission (${canEditResult.error.message}).`;
    }
  } else {
    canEditFeatureSuggestions = Boolean(canEditResult.data);
  }

  const hideCompleted = (searchParams?.hide ?? "1").trim() !== "0";
  const viewRaw = String(searchParams?.view || "").trim().toLowerCase();
  const selectedView: "table" | "gantt" | "board" =
    viewRaw === "gantt" || viewRaw === "board" || viewRaw === "table"
      ? (viewRaw as "table" | "gantt" | "board")
      : "table";
  const hasExplicitView = typeof searchParams?.view !== "undefined";
  const sortKey = normalizeSortKey((searchParams?.sort || "").trim());
  const sortDir = normalizeSortDir((searchParams?.dir || "").trim(), sortKey);

  let statusOptionsResult: StatusOptionsResult = (await supabase
    .from("status_options")
    .select("entity_type,value,position,is_visible,counts_as_completed,color_hex")
    .eq("entity_type", "feature_suggestion")
    .order("position", { ascending: true })
    .order("value", { ascending: true })) as StatusOptionsResult;

  if (statusOptionsResult.error && isSupabaseMissingColumnError(statusOptionsResult.error)) {
    const legacyStatusOptions = await supabase
      .from("status_options")
      .select("entity_type,value,position")
      .eq("entity_type", "feature_suggestion")
      .order("position", { ascending: true })
      .order("value", { ascending: true });
    statusOptionsResult = {
      data: legacyStatusOptions.data as Array<StatusOptionRow> | null,
      error: legacyStatusOptions.error as StatusOptionsResult["error"],
    };
  }

  const featureSuggestionStatusOptions = buildStatusOptionsWithMetadata(
    "feature_suggestion",
    ((statusOptionsResult.data || []) as Array<StatusOptionRow>) || [],
    DEFAULT_FEATURE_SUGGESTION_STATUS_OPTIONS
  );
  const featureSuggestionStatusColorMap = buildStatusColorMap(
    "feature_suggestion",
    featureSuggestionStatusOptions
  );
  const statusValues = featureSuggestionStatusOptions.map((status) => status.value);
  const hiddenStatusValues = buildHiddenStatusValues(
    "feature_suggestion",
    featureSuggestionStatusOptions
  );

  const selectedStatuses = parseCsvParam(searchParams?.status).filter((status) =>
    statusValues.includes(normalizeStatusValue(status))
  );
  const selectedTypes = parseCsvParam(searchParams?.type).filter((type) =>
    typeOptions.includes(type as (typeof typeOptions)[number])
  );
  const query = sanitizeSearchQuery((searchParams?.q || "").trim());

  const buildReturnQuery = () => {
    const params = new URLSearchParams();
    setCsvParam(params, "status", selectedStatuses);
    setCsvParam(params, "type", selectedTypes);
    if (query) {
      params.set("q", query);
    }
    params.set("hide", hideCompleted ? "1" : "0");
    params.set("sort", sortKey);
    params.set("dir", sortDir);
    if (selectedView !== "table") {
      params.set("view", selectedView);
    }
    return params.toString();
  };

  const returnBaseQuery = buildReturnQuery();
  const returnTo = returnBaseQuery ? `/feature-suggestions?${returnBaseQuery}` : "/feature-suggestions";

  const buildSuggestionsQuery = (includeClosedAt: boolean) => {
    let queryBuilder = supabase
      .from("feature_suggestions")
      .select(
        includeClosedAt
          ? "id,title,details,status,type,created_at,closed_at,created_by"
          : "id,title,details,status,type,created_at,created_by"
      );

    if (selectedStatuses.length) {
      queryBuilder = queryBuilder.in("status", selectedStatuses);
    } else if (hideCompleted) {
      const normalizedHiddenStatuses = hiddenStatusValues
        .map((status) => normalizeStatusValue(status))
        .filter(Boolean);
      if (normalizedHiddenStatuses.length) {
        queryBuilder = queryBuilder.not(
          "status",
          "in",
          `(${normalizedHiddenStatuses.join(",")})`
        );
      }
    }

    if (selectedTypes.length) {
      queryBuilder = queryBuilder.in("type", selectedTypes);
    }

    if (query) {
      queryBuilder = queryBuilder.or(
        buildPostgrestOrFilter([
          buildPostgrestIlikeContainsFilter("title", query),
          buildPostgrestIlikeContainsFilter("details", query),
        ])
      );
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
  const userVotes = new Map<string, number>();

  (votes || []).forEach((vote) => {
    const value = vote.value === -1 ? -1 : 1;
    voteScores.set(vote.suggestion_id, (voteScores.get(vote.suggestion_id) || 0) + value);
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
    commentCounts.set(comment.suggestion_id, (commentCounts.get(comment.suggestion_id) || 0) + 1);
  });

  const byText = (value: string | null) => (value || "").toLowerCase();
  suggestionRows = [...suggestionRows].sort((a, b) => {
    let result = 0;

    if (sortKey === "title") {
      result = byText(a.title).localeCompare(byText(b.title));
    } else if (sortKey === "status") {
      result = byText(a.status).localeCompare(byText(b.status));
    } else if (sortKey === "type") {
      result = byText(a.type).localeCompare(byText(b.type));
    } else if (sortKey === "score") {
      result = (voteScores.get(a.id) || 0) - (voteScores.get(b.id) || 0);
      if (result === 0) {
        result = a.created_at.localeCompare(b.created_at);
      }
    } else {
      result = a.created_at.localeCompare(b.created_at);
    }

    return sortDir === "asc" ? result : -result;
  });

  async function createSuggestion(formData: FormData): Promise<void> {
    "use server";
    const supabase = createSupabaseServerClient();
    const title = String(formData.get("title") || "").trim();
    const details = String(formData.get("details") || "").trim();
    const type = String(formData.get("type") || "new_feature").trim();

    const canEditResult = await supabase.rpc("can_edit_page", {
      p_page_key: "feature_suggestions",
    });
    if (!canEditResult.error && !canEditResult.data) {
      redirect(
        `${returnTo}${returnTo.includes("?") ? "&" : "?"}error=You%20only%20have%20view%20access%20to%20Feature%20Suggestions`
      );
    }

    if (!typeOptions.includes(type as (typeof typeOptions)[number])) {
      redirect(`${returnTo}${returnTo.includes("?") ? "&" : "?"}error=Invalid%20request%20type`);
    }

    if (!title) {
      redirect(`${returnTo}${returnTo.includes("?") ? "&" : "?"}error=Title%20is%20required`);
    }

    const authUser = await getCurrentRequestUser(
      supabase,
      "feature_suggestions.create.auth"
    );
    const authEmail = authUser?.email;
    const authUserId = authUser?.id || null;

    if (!authEmail) {
      redirect("/login");
    }

    const { data: user } = await supabase
      .from("users")
      .select("id")
      .eq("email", authEmail)
      .maybeSingle();

    if (!user?.id) {
      redirect(`${returnTo}${returnTo.includes("?") ? "&" : "?"}error=Missing%20user%20profile`);
    }

    const { data: insertedSuggestion, error } = await supabase
      .from("feature_suggestions")
      .insert({
        title,
        details: details || null,
        type,
        created_by: user.id,
      })
      .select("id,title")
      .single();

    if (error) {
      redirect(`${returnTo}${returnTo.includes("?") ? "&" : "?"}error=${encodeURIComponent(error.message)}`);
    }

    if (insertedSuggestion?.id) {
      const nextMentionText = [title, details].filter(Boolean).join("\n\n");
      try {
        await notifyMentionedUsersFromTextChange({
          actorAuthUserId: authUserId,
          previousText: null,
          nextText: nextMentionText,
          sourceType: "feature_suggestion",
          sourceId: insertedSuggestion.id,
          sourceUrl: `/feature-suggestions/${insertedSuggestion.id}`,
          sourceTitle: String(insertedSuggestion?.title || title || "Feature suggestion"),
        });
      } catch (notifyError) {
        const message =
          notifyError instanceof Error ? notifyError.message : String(notifyError);
        logError("feature_suggestions.create.mentions_notify_failed", {
          suggestionId: insertedSuggestion.id,
          message,
        });
      }
    }

    revalidatePath("/feature-suggestions");
    redirect(`${returnTo}${returnTo.includes("?") ? "&" : "?"}success=Suggestion%20submitted`);
  }

  async function toggleVote(formData: FormData): Promise<void> {
    "use server";
    const supabase = createSupabaseServerClient();
    const suggestionId = String(formData.get("suggestion_id") || "").trim();
    const direction = String(formData.get("vote") || "up").trim().toLowerCase();
    const desiredValue = direction === "down" ? -1 : 1;

    const canEditResult = await supabase.rpc("can_edit_page", {
      p_page_key: "feature_suggestions",
    });
    if (!canEditResult.error && !canEditResult.data) {
      redirect(
        `${returnTo}${returnTo.includes("?") ? "&" : "?"}error=You%20only%20have%20view%20access%20to%20Feature%20Suggestions`
      );
    }

    if (!suggestionId) {
      redirect(`${returnTo}${returnTo.includes("?") ? "&" : "?"}error=Missing%20suggestion%20id`);
    }

    const authUser = await getCurrentRequestUser(
      supabase,
      "feature_suggestions.votes.toggle.auth"
    );
    const authEmail = authUser?.email;

    if (!authEmail) {
      redirect("/login");
    }

    const { data: user } = await supabase
      .from("users")
      .select("id")
      .eq("email", authEmail)
      .maybeSingle();

    if (!user?.id) {
      redirect(`${returnTo}${returnTo.includes("?") ? "&" : "?"}error=Missing%20user%20profile`);
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
        redirect(`${returnTo}${returnTo.includes("?") ? "&" : "?"}error=${encodeURIComponent(error.message)}`);
      }
    } else if (existingValue !== null) {
      const { error } = await supabase
        .from("feature_suggestion_votes")
        .update({ value: desiredValue })
        .eq("suggestion_id", suggestionId)
        .eq("user_id", user.id);

      if (error) {
        redirect(`${returnTo}${returnTo.includes("?") ? "&" : "?"}error=${encodeURIComponent(error.message)}`);
      }
    } else {
      const { error } = await supabase.from("feature_suggestion_votes").insert({
        suggestion_id: suggestionId,
        user_id: user.id,
        value: desiredValue,
      });

      if (error) {
        redirect(`${returnTo}${returnTo.includes("?") ? "&" : "?"}error=${encodeURIComponent(error.message)}`);
      }
    }

    revalidatePath("/feature-suggestions");
  }

  async function updateStatus(formData: FormData): Promise<void> {
    "use server";
    const supabase = createSupabaseServerClient();
    const suggestionId = String(formData.get("suggestion_id") || "").trim();
    const status = String(formData.get("status") || "").trim();

    const canEditResult = await supabase.rpc("can_edit_page", {
      p_page_key: "feature_suggestions",
    });
    if (!canEditResult.error && !canEditResult.data) {
      redirect(
        `${returnTo}${returnTo.includes("?") ? "&" : "?"}error=You%20only%20have%20view%20access%20to%20Feature%20Suggestions`
      );
    }

    if (!suggestionId || !status) {
      redirect(`${returnTo}${returnTo.includes("?") ? "&" : "?"}error=Missing%20status%20update`);
    }

    if (!statusValues.includes(normalizeStatusValue(status))) {
      redirect(`${returnTo}${returnTo.includes("?") ? "&" : "?"}error=Invalid%20status`);
    }

    const normalizedStatus = normalizeStatusValue(status);
    const statusMeta = featureSuggestionStatusOptions.find(
      (statusOption) => normalizeStatusValue(statusOption.value) === normalizedStatus
    );
    const shouldClose = statusMeta ? statusMeta.countsAsCompleted : false;
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
      redirect(`${returnTo}${returnTo.includes("?") ? "&" : "?"}error=${encodeURIComponent(error.message)}`);
    }

    revalidatePath("/feature-suggestions");
  }

  async function updateType(formData: FormData): Promise<void> {
    "use server";
    const supabase = createSupabaseServerClient();
    const suggestionId = String(formData.get("suggestion_id") || "").trim();
    const type = String(formData.get("type") || "").trim();

    const canEditResult = await supabase.rpc("can_edit_page", {
      p_page_key: "feature_suggestions",
    });
    if (!canEditResult.error && !canEditResult.data) {
      redirect(
        `${returnTo}${returnTo.includes("?") ? "&" : "?"}error=You%20only%20have%20view%20access%20to%20Feature%20Suggestions`
      );
    }

    if (!suggestionId || !type) {
      redirect(`${returnTo}${returnTo.includes("?") ? "&" : "?"}error=Missing%20type%20update`);
    }

    if (!typeOptions.includes(type as (typeof typeOptions)[number])) {
      redirect(`${returnTo}${returnTo.includes("?") ? "&" : "?"}error=Invalid%20type`);
    }

    const { error } = await supabase
      .from("feature_suggestions")
      .update({ type })
      .eq("id", suggestionId);

    if (error) {
      redirect(`${returnTo}${returnTo.includes("?") ? "&" : "?"}error=${encodeURIComponent(error.message)}`);
    }

    revalidatePath("/feature-suggestions");
  }

  const tableRows = suggestionRows.map((suggestion) => ({
    id: suggestion.id,
    title: suggestion.title,
    details: suggestion.details,
    status: suggestion.status || "idea",
    type: suggestion.type || "new_feature",
    created_at: suggestion.created_at,
    closed_at: suggestion.closed_at,
    score: voteScores.get(suggestion.id) || 0,
    userVote: userVotes.get(suggestion.id) || 0,
    commentCount: commentCounts.get(suggestion.id) || 0,
  }));

  return (
    <div className="space-y-8">
      <section className="space-y-2">
        <h1 className="text-2xl font-semibold text-slate-900">Feature suggestions</h1>
        <p className="text-sm text-slate-600">Share ideas and vote on what should be built next.</p>
      </section>

      {(searchParams?.error ||
        searchParams?.success ||
        suggestionsError ||
        featureSuggestionsPermissionErrorMessage) && (
        <div className="space-y-2">
          {featureSuggestionsPermissionErrorMessage ? (
            <p className="rounded-md border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
              {featureSuggestionsPermissionErrorMessage}
            </p>
          ) : null}
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
        {!canEditFeatureSuggestions ? (
          <p className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            You have view-only access to Feature Suggestions.
          </p>
        ) : null}
        <form action={createSuggestion} className="mt-4 grid gap-4">
          <input
            name="title"
            placeholder="Short title"
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            disabled={!canEditFeatureSuggestions}
            required
          />
          <select
            name="type"
            defaultValue="new_feature"
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            disabled={!canEditFeatureSuggestions}
          >
            <option value="bug">Bug</option>
            <option value="improvement">Improvement</option>
            <option value="new_feature">New feature</option>
          </select>
          <MentionTextareaField
            name="details"
            rows={4}
            placeholder="Describe the problem and ideal outcome."
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            disabled={!canEditFeatureSuggestions}
          />
          <button
            type="submit"
            className="w-fit rounded-md btn-primary px-4 py-2 text-sm font-semibold text-white"
            disabled={!canEditFeatureSuggestions}
          >
            Submit suggestion
          </button>
        </form>
      </section>

      <FeatureSuggestionsTable
        rows={tableRows}
        hideCompleted={hideCompleted}
        sortKey={sortKey}
        sortDir={sortDir}
        initialView={selectedView}
        initialFilters={{
          status: selectedStatuses,
          type: selectedTypes,
          q: query,
        }}
        statusOptions={featureSuggestionStatusOptions}
        statusColorMap={featureSuggestionStatusColorMap}
        typeOptions={typeOptions}
        onVote={toggleVote}
        onUpdateStatus={updateStatus}
        onUpdateType={updateType}
        hasExplicitView={hasExplicitView}
        viewPreferenceScope="feature-suggestions"
        canEdit={canEditFeatureSuggestions}
      />
    </div>
  );
}
