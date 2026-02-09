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
  created_by: string | null;
};

type SuggestionCommentRow = {
  id: string;
  suggestion_id: string;
  user_id: string;
  body: string;
  created_at: string;
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
  }>;
}) {
  const searchParams = await props.searchParams;
  const supabase = createSupabaseServerClient();
  const { data: authData } = await supabase.auth.getUser();
  const authEmail = authData.user?.email;
  const hideCompleted = (searchParams?.hide ?? "1").trim() !== "0";
  const selectedSort = (searchParams?.sort || "latest").trim();
  const openCommentsForSuggestionId = (searchParams?.open || "").trim();
  const selectedStatusParam = (searchParams?.status || "all").trim();
  const selectedTypeParam = (searchParams?.type || "all").trim();
  const selectedSubmittedByParam = (searchParams?.submitted_by || "all").trim();
  const queryParam = (searchParams?.q || "").trim();
  const dateFromParam = (searchParams?.date_from || "").trim();
  const dateToParam = (searchParams?.date_to || "").trim();
  const onlyMyVotes = (searchParams?.my_votes || "0").trim() === "1";
  const onlyWithComments = (searchParams?.has_comments || "0").trim() === "1";

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

  const isAdmin = currentUser.role === "admin";

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
  const returnBaseQuery = baseParams.toString();
  const returnTo = buildFeatureSuggestionsReturnUrl(returnBaseQuery);

  const resetParams = new URLSearchParams();
  resetParams.set("hide", hideCompleted ? "1" : "0");
  if (selectedSort && selectedSort !== "latest") {
    resetParams.set("sort", selectedSort);
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

  let suggestionsQuery = supabase
    .from("feature_suggestions")
    .select("id,title,details,status,type,created_at,created_by")
    .order("created_at", { ascending: false });

  if (selectedStatus !== "all") {
    suggestionsQuery = suggestionsQuery.eq("status", selectedStatus);
  } else if (hideCompleted) {
    suggestionsQuery = suggestionsQuery.not("status", "in", "(completed,rejected)");
  }

  if (selectedType !== "all") {
    suggestionsQuery = suggestionsQuery.eq("type", selectedType);
  }

  if (selectedSubmittedBy !== "all") {
    const submittedByUserId =
      selectedSubmittedBy === "me" ? currentUser.id : selectedSubmittedBy;
    suggestionsQuery = suggestionsQuery.eq("created_by", submittedByUserId);
  }

  if (query) {
    suggestionsQuery = suggestionsQuery.or(
      `title.ilike.%${query}%,details.ilike.%${query}%`
    );
  }

  if (dateFrom) {
    suggestionsQuery = suggestionsQuery.gte("created_at", `${dateFrom}T00:00:00Z`);
  }

  if (dateTo) {
    suggestionsQuery = suggestionsQuery.lte("created_at", `${dateTo}T23:59:59.999Z`);
  }

  const { data: suggestions, error: suggestionsError } = await suggestionsQuery;

  let suggestionRows = (suggestions || []) as SuggestionRow[];
  const suggestionIds = suggestionRows.map((row) => row.id);

  const votes: { suggestion_id: string; user_id: string }[] = suggestionIds.length
    ? ((
        await supabase
          .from("feature_suggestion_votes")
          .select("suggestion_id,user_id")
          .in("suggestion_id", suggestionIds)
      ).data as { suggestion_id: string; user_id: string }[]) || []
    : [];

  const voteCounts = new Map<string, number>();
  const userVotes = new Set<string>();

  (votes || []).forEach((vote) => {
    voteCounts.set(
      vote.suggestion_id,
      (voteCounts.get(vote.suggestion_id) || 0) + 1
    );
    if (vote.user_id === currentUser.id) {
      userVotes.add(vote.suggestion_id);
    }
  });

  const comments: SuggestionCommentRow[] = suggestionIds.length
    ? ((
        await supabase
          .from("feature_suggestion_comments")
          .select("id,suggestion_id,user_id,body,created_at")
          .in("suggestion_id", suggestionIds)
          .order("created_at", { ascending: true })
      ).data as SuggestionCommentRow[]) || []
    : [];

  const commentCounts = new Map<string, number>();
  const commentsBySuggestionId = new Map<string, SuggestionCommentRow[]>();

  (comments || []).forEach((comment) => {
    commentCounts.set(
      comment.suggestion_id,
      (commentCounts.get(comment.suggestion_id) || 0) + 1
    );
    const existing = commentsBySuggestionId.get(comment.suggestion_id);
    if (existing) {
      existing.push(comment);
    } else {
      commentsBySuggestionId.set(comment.suggestion_id, [comment]);
    }
  });

  if (onlyMyVotes) {
    suggestionRows = suggestionRows.filter((suggestion) => userVotes.has(suggestion.id));
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
      .select("suggestion_id")
      .eq("suggestion_id", suggestionId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (existing) {
      const { error } = await supabase
        .from("feature_suggestion_votes")
        .delete()
        .eq("suggestion_id", suggestionId)
        .eq("user_id", user.id);

      if (error) {
        redirect(
          buildFeatureSuggestionsReturnUrl(returnBaseQuery, { error: error.message })
        );
      }
    } else {
      const { error } = await supabase.from("feature_suggestion_votes").insert({
        suggestion_id: suggestionId,
        user_id: user.id,
      });

      if (error) {
        redirect(
          buildFeatureSuggestionsReturnUrl(returnBaseQuery, { error: error.message })
        );
      }
    }

    revalidatePath("/feature-suggestions");
    redirect(returnTo);
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

    const { error } = await supabase
      .from("feature_suggestions")
      .update({ status })
      .eq("id", suggestionId);

    if (error) {
      redirect(
        buildFeatureSuggestionsReturnUrl(returnBaseQuery, { error: error.message })
      );
    }

    revalidatePath("/feature-suggestions");
    redirect(returnTo);
  }

  async function updateSuggestion(formData: FormData) {
    "use server";
    const supabase = createSupabaseServerClient();
    const suggestionId = String(formData.get("suggestion_id") || "").trim();
    const title = String(formData.get("title") || "").trim();
    const details = String(formData.get("details") || "").trim();

    if (!suggestionId) {
      redirect(
        buildFeatureSuggestionsReturnUrl(returnBaseQuery, {
          error: "Missing suggestion id",
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

    const { data: editorUser } = await supabase
      .from("users")
      .select("id,role")
      .eq("email", authEmail)
      .maybeSingle();

    if (!editorUser?.id) {
      redirect(
        buildFeatureSuggestionsReturnUrl(returnBaseQuery, {
          error: "Missing user profile",
        })
      );
    }

    const { data: existing, error: existingError } = await supabase
      .from("feature_suggestions")
      .select("id,created_by")
      .eq("id", suggestionId)
      .maybeSingle();

    if (existingError) {
      redirect(
        buildFeatureSuggestionsReturnUrl(returnBaseQuery, {
          error: existingError.message,
        })
      );
    }

    if (!existing?.id) {
      redirect(
        buildFeatureSuggestionsReturnUrl(returnBaseQuery, {
          error: "Suggestion not found",
        })
      );
    }

    const canEdit = editorUser.role === "admin" || existing.created_by === editorUser.id;
    if (!canEdit) {
      redirect(
        buildFeatureSuggestionsReturnUrl(returnBaseQuery, {
          error: "Not allowed to edit this idea",
        })
      );
    }

    const { error } = await supabase
      .from("feature_suggestions")
      .update({
        title,
        details: details || null,
      })
      .eq("id", suggestionId);

    if (error) {
      redirect(
        buildFeatureSuggestionsReturnUrl(returnBaseQuery, { error: error.message })
      );
    }

    revalidatePath("/feature-suggestions");
    redirect(buildFeatureSuggestionsReturnUrl(returnBaseQuery, { success: "Saved" }));
  }

  const userIds = Array.from(
    new Set(
      [
        ...suggestionRows.map((row) => row.created_by).filter(Boolean),
        ...comments.map((comment) => comment.user_id).filter(Boolean),
      ] as string[]
    )
  );
  const userMap = new Map<string, { full_name?: string | null; email?: string | null }>();

  if (userIds.length) {
    const { data: users } = await supabase
      .from("users")
      .select("id,full_name,email")
      .in("id", userIds);
    (users || []).forEach((user) => {
      userMap.set(user.id, { full_name: user.full_name, email: user.email });
    });
  }

  if (selectedSort === "most_upvoted") {
    suggestionRows = [...suggestionRows].sort((a, b) => {
      const aVotes = voteCounts.get(a.id) || 0;
      const bVotes = voteCounts.get(b.id) || 0;
      if (bVotes !== aVotes) {
        return bVotes - aVotes;
      }
      return a.created_at < b.created_at ? 1 : -1;
    });
  }

  async function createComment(formData: FormData) {
    "use server";
    const supabase = createSupabaseServerClient();
    const suggestionId = String(formData.get("suggestion_id") || "").trim();
    const body = String(formData.get("body") || "").trim();

    const params = new URLSearchParams(returnBaseQuery);
    if (suggestionId) {
      params.set("open", suggestionId);
    }
    const baseQueryWithOpen = params.toString();

    if (!suggestionId) {
      redirect(
        buildFeatureSuggestionsReturnUrl(baseQueryWithOpen, {
          error: "Missing suggestion id",
        })
      );
    }

    if (!body) {
      redirect(
        buildFeatureSuggestionsReturnUrl(baseQueryWithOpen, {
          error: "Comment is required",
        })
      );
    }

    const { data: authData } = await supabase.auth.getUser();
    if (!authData.user?.id) {
      redirect("/login");
    }

    const authUserId = authData.user.id;
    const authEmail = authData.user.email || "";
    const authFullName =
      (authData.user.user_metadata?.full_name as string | undefined) ||
      authEmail.split("@")[0] ||
      "Team member";

    let { data: profile } = await supabase
      .from("users")
      .select("id")
      .eq("id", authUserId)
      .maybeSingle();

    if (!profile) {
      const { data: emailMatch } = await supabase
        .from("users")
        .select("id")
        .eq("email", authEmail)
        .maybeSingle();

      if (emailMatch?.id) {
        profile = emailMatch;
      } else {
        const { error: insertError } = await supabase.from("users").insert({
          id: authUserId,
          email: authEmail,
          full_name: authFullName,
          role: "member",
          status: "active",
        });

        if (insertError) {
          redirect(
            buildFeatureSuggestionsReturnUrl(baseQueryWithOpen, {
              error: insertError.message,
            })
          );
        }

        profile = { id: authUserId };
      }
    }

    if (!profile?.id) {
      redirect(
        buildFeatureSuggestionsReturnUrl(baseQueryWithOpen, {
          error: "Missing user profile",
        })
      );
    }

    const { error } = await supabase.from("feature_suggestion_comments").insert({
      suggestion_id: suggestionId,
      user_id: profile.id,
      body,
    });

    if (error) {
      redirect(
        buildFeatureSuggestionsReturnUrl(baseQueryWithOpen, { error: error.message })
      );
    }

    revalidatePath("/feature-suggestions");
    redirect(
      buildFeatureSuggestionsReturnUrl(baseQueryWithOpen, { success: "Comment added" })
    );
  }

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
            <FeatureSuggestionControls
              hideCompleted={hideCompleted}
              selectedSort={selectedSort === "most_upvoted" ? "most_upvoted" : "latest"}
            />
          </div>
        </div>
        <div className="border-b border-slate-200 px-6 py-4">
          <form className="flex flex-wrap items-end gap-3">
            <input type="hidden" name="hide" value={hideCompleted ? "1" : "0"} />
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
        <div className="divide-y divide-slate-200">
          {suggestionRows.length ? (
            suggestionRows.map((suggestion) => {
              const votesForSuggestion = voteCounts.get(suggestion.id) || 0;
              const hasVoted = userVotes.has(suggestion.id);
              const author = suggestion.created_by
                ? userMap.get(suggestion.created_by)
                : null;
              const authorName = author?.full_name || author?.email || "Unknown";
              const commentCount = commentCounts.get(suggestion.id) || 0;
              const suggestionComments =
                commentsBySuggestionId.get(suggestion.id) || [];
              return (
                <div key={suggestion.id} className="flex flex-col gap-4 px-6 py-4 md:flex-row md:items-start md:justify-between">
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-base font-semibold text-slate-900">
                        {suggestion.title}
                      </p>
                      <span className="rounded-full border border-slate-300 px-2 py-0.5 text-xs font-semibold uppercase text-slate-600">
                        {(suggestion.type || "new_feature").replace("_", " ")}
                      </span>
                      <span className="rounded-full border border-slate-300 px-2 py-0.5 text-xs font-semibold uppercase text-slate-600">
                        {formatStatusLabel(suggestion.status || "idea")}
                      </span>
                      <span className="rounded-full border border-slate-300 bg-slate-50 px-2 py-0.5 text-xs font-semibold text-slate-600">
                        {commentCount} comment{commentCount === 1 ? "" : "s"}
                      </span>
                    </div>
                    {suggestion.details ? (
                      <p className="text-sm text-slate-600">
                        {suggestion.details}
                      </p>
                    ) : null}
                    <p className="text-xs text-slate-500">
                      Suggested by {authorName}
                    </p>
                    <FeatureSuggestionStatus
                      suggestionId={suggestion.id}
                      defaultStatus={suggestion.status || "idea"}
                      statusOptions={statusOptions}
                      onUpdate={updateStatus}
                    />
                    <details
                      open={openCommentsForSuggestionId === suggestion.id}
                      className="mt-2 rounded-md border border-slate-200 bg-slate-50 p-3"
                    >
                      <summary className="cursor-pointer select-none text-xs font-semibold text-slate-700">
                        Comments ({commentCount})
                      </summary>
                      <div className="mt-3 space-y-3">
                        {suggestionComments.length ? (
                          <div className="space-y-2">
                            {suggestionComments.map((comment) => {
                              const commenter = userMap.get(comment.user_id);
                              const commenterName =
                                commenter?.full_name ||
                                commenter?.email ||
                                "Unknown";
                              return (
                                <div
                                  key={comment.id}
                                  className="rounded-md border border-slate-200 bg-white p-3"
                                >
                                  <p className="text-xs text-slate-500">
                                    {commenterName} -{" "}
                                    {new Date(comment.created_at).toLocaleString()}
                                  </p>
                                  <p className="mt-1 whitespace-pre-wrap text-sm text-slate-700">
                                    {comment.body}
                                  </p>
                                </div>
                              );
                            })}
                          </div>
                        ) : (
                          <p className="text-sm text-slate-500">
                            No comments yet.
                          </p>
                        )}

                        <form action={createComment} className="grid gap-2">
                          <input
                            type="hidden"
                            name="suggestion_id"
                            value={suggestion.id}
                          />
                          <textarea
                            name="body"
                            rows={3}
                            placeholder="Add a comment..."
                            className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
                            required
                          />
                          <button
                            type="submit"
                            className="w-fit rounded-md btn-primary px-4 py-2 text-sm font-semibold text-white"
                          >
                            Add comment
                          </button>
                        </form>
                      </div>
                    </details>
                    {isAdmin || suggestion.created_by === currentUser.id ? (
                      <details className="mt-2 rounded-md border border-slate-200 bg-slate-50 p-3">
                        <summary className="cursor-pointer select-none text-xs font-semibold text-slate-700">
                          Edit idea
                        </summary>
                        <form action={updateSuggestion} className="mt-3 grid gap-3">
                          <input
                            type="hidden"
                            name="suggestion_id"
                            value={suggestion.id}
                          />
                          <input
                            name="title"
                            defaultValue={suggestion.title}
                            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                            required
                          />
                          <textarea
                            name="details"
                            rows={4}
                            defaultValue={suggestion.details || ""}
                            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                          />
                          <button
                            type="submit"
                            className="w-fit rounded-md btn-primary px-4 py-2 text-sm font-semibold text-white"
                          >
                            Save changes
                          </button>
                        </form>
                      </details>
                    ) : null}
                  </div>
                  <form action={toggleVote} className="flex items-center gap-3">
                    <input
                      type="hidden"
                      name="suggestion_id"
                      value={suggestion.id}
                    />
                    <span className="text-sm text-slate-600">
                      {votesForSuggestion} vote{votesForSuggestion === 1 ? "" : "s"}
                    </span>
                    <button
                      type="submit"
                      className={`rounded-md px-3 py-1.5 text-xs font-semibold ${
                        hasVoted
                          ? "bg-slate-900 text-white"
                          : "border border-slate-300 text-slate-700 hover:border-slate-400"
                      }`}
                    >
                      {hasVoted ? "Upvoted" : "Upvote"}
                    </button>
                  </form>
                </div>
              );
            })
          ) : (
            <p className="px-6 py-6 text-sm text-slate-500">
              No suggestions yet. Be the first to submit one.
            </p>
          )}
        </div>
      </section>
    </div>
  );
}
