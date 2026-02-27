import Link from "next/link";
import { revalidatePath } from "next/cache";
import { notFound, redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isSupabaseMissingColumnError } from "@/lib/supabaseErrors";
import {
  buildStatusOptionsWithMetadata,
  DEFAULT_FEATURE_SUGGESTION_STATUS_OPTIONS,
  type StatusOptionRow,
  normalizeStatusValue,
} from "@/lib/statusOptions";

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

function isMissingFeatureSuggestionClosedAtColumnError(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const message = String((error as { message?: unknown }).message || "").toLowerCase();
  return (
    message.includes("feature_suggestions.closed_at") &&
    message.includes("does not exist")
  );
}

export default async function FeatureSuggestionDetailPage(props: {
  params: Promise<{ suggestionId: string }>;
  searchParams?: Promise<{ return_to?: string; error?: string; success?: string }>;
}) {
  const { suggestionId } = await props.params;
  const searchParams = await props.searchParams;
  const returnToRaw = String(searchParams?.return_to || "").trim();
  const returnTo =
    returnToRaw.startsWith("/feature-suggestions") ? returnToRaw : "/feature-suggestions";

  const supabase = createSupabaseServerClient();
  const { data: authData } = await supabase.auth.getUser();
  const authEmail = authData.user?.email;

  if (!authEmail) {
    redirect("/login");
  }

  const { data: currentUser } = await supabase
    .from("users")
    .select("id,full_name,email")
    .eq("email", authEmail)
    .maybeSingle();

  if (!currentUser?.id) {
    redirect("/tasks?error=Missing%20user%20profile");
  }

  type StatusOptionsResponse = {
    data: Array<StatusOptionRow> | null;
    error: {
      message: string;
      code?: string;
      details?: string | null;
      hint?: string | null;
    } | null;
  };

  const statusOptionsResult: StatusOptionsResponse = await supabase
    .from("status_options")
    .select("entity_type,value,position,is_visible,counts_as_completed")
    .eq("entity_type", "feature_suggestion")
    .order("position", { ascending: true })
    .order("value", { ascending: true });

  let statusOptionsRowsResult = statusOptionsResult;
  if (statusOptionsResult.error && isSupabaseMissingColumnError(statusOptionsResult.error)) {
    statusOptionsRowsResult = (await supabase
      .from("status_options")
      .select("entity_type,value,position")
      .eq("entity_type", "feature_suggestion")
      .order("position", { ascending: true })
      .order("value", { ascending: true })) as StatusOptionsResponse;
  }

  const featureSuggestionStatusOptions = buildStatusOptionsWithMetadata(
    "feature_suggestion",
    ((statusOptionsRowsResult.data || []) as Array<StatusOptionRow>) || [],
    DEFAULT_FEATURE_SUGGESTION_STATUS_OPTIONS
  );

  const suggestionWithClosedAt = await supabase
    .from("feature_suggestions")
    .select("id,title,details,status,type,created_at,closed_at,created_by")
    .eq("id", suggestionId)
    .maybeSingle();

  let suggestion = suggestionWithClosedAt.data as
    | {
        id: string;
        title: string;
        details: string | null;
        status: string | null;
        type: string | null;
        created_at: string;
        closed_at: string | null;
        created_by: string | null;
      }
    | null;
  let suggestionError = suggestionWithClosedAt.error;

  if (suggestionError && isMissingFeatureSuggestionClosedAtColumnError(suggestionError)) {
    const fallback = await supabase
      .from("feature_suggestions")
      .select("id,title,details,status,type,created_at,created_by")
      .eq("id", suggestionId)
      .maybeSingle();

    suggestionError = fallback.error;
    const fallbackData = fallback.data as
      | {
          id: string;
          title: string;
          details: string | null;
          status: string | null;
          type: string | null;
          created_at: string;
          created_by: string | null;
        }
      | null;

    suggestion = fallbackData ? { ...fallbackData, closed_at: null } : null;
  }

  if (suggestionError) {
    notFound();
  }

  if (!suggestion) {
    notFound();
  }

  const [votesResult, commentsResult] = await Promise.all([
    supabase
      .from("feature_suggestion_votes")
      .select("user_id,value")
      .eq("suggestion_id", suggestionId),
    supabase
      .from("feature_suggestion_comments")
      .select("id,user_id,body,created_at")
      .eq("suggestion_id", suggestionId)
      .order("created_at", { ascending: true }),
  ]);

  const votes = (votesResult.data || []) as Array<{ user_id: string; value: number | null }>;
  const comments = (commentsResult.data || []) as Array<{
    id: string;
    user_id: string;
    body: string;
    created_at: string;
  }>;

  const userIds = Array.from(
    new Set([suggestion.created_by, ...comments.map((comment) => comment.user_id)].filter(Boolean))
  ) as string[];

  const { data: users } = userIds.length
    ? await supabase.from("users").select("id,full_name,email").in("id", userIds)
    : { data: [] as Array<{ id: string; full_name: string | null; email: string | null }> };

  const userMap = new Map<string, string>();
  (users || []).forEach((user) => {
    userMap.set(user.id, user.full_name || user.email || "Unknown user");
  });

  const score = votes.reduce((sum, vote) => sum + (vote.value === -1 ? -1 : 1), 0);
  const currentUserVote =
    votes.find((vote) => vote.user_id === currentUser.id)?.value === -1 ? -1 :
    votes.find((vote) => vote.user_id === currentUser.id)?.value === 1 ? 1 : 0;

  const detailPath = `/feature-suggestions/${suggestionId}`;

  async function updateSuggestion(formData: FormData) {
    "use server";
    const supabase = createSupabaseServerClient();

    const title = String(formData.get("title") || "").trim();
    const details = String(formData.get("details") || "").trim();
    const status = String(formData.get("status") || "").trim();
    const type = String(formData.get("type") || "").trim();
    const detailParams = new URLSearchParams();
    detailParams.set("return_to", returnTo);

    if (!title) {
      detailParams.set("error", "Title is required");
      redirect(`${detailPath}?${detailParams.toString()}`);
    }
    const normalizedStatus = normalizeStatusValue(status);
    const availableStatus = featureSuggestionStatusOptions.find(
      (option) => normalizeStatusValue(option.value) === normalizedStatus
    );
    if (!availableStatus) {
      detailParams.set("error", "Invalid status");
      redirect(`${detailPath}?${detailParams.toString()}`);
    }
    if (!typeOptions.includes(type as (typeof typeOptions)[number])) {
      detailParams.set("error", "Invalid type");
      redirect(`${detailPath}?${detailParams.toString()}`);
    }

    const shouldClose = availableStatus?.countsAsCompleted ?? false;
    let { error } = await supabase
      .from("feature_suggestions")
      .update({
        title,
        details: details || null,
        status,
        type,
        closed_at: shouldClose ? new Date().toISOString() : null,
      })
      .eq("id", suggestionId);

    if (error && isMissingFeatureSuggestionClosedAtColumnError(error)) {
      const retry = await supabase
        .from("feature_suggestions")
        .update({
          title,
          details: details || null,
          status,
          type,
        })
        .eq("id", suggestionId);
      error = retry.error;
    }

    if (error) {
      detailParams.set("error", error.message);
      redirect(`${detailPath}?${detailParams.toString()}`);
    }

    revalidatePath("/feature-suggestions");
    revalidatePath(`/feature-suggestions/${suggestionId}`);
    detailParams.set("success", "Idea updated");
    redirect(`${detailPath}?${detailParams.toString()}`);
  }

  async function addComment(formData: FormData) {
    "use server";
    const supabase = createSupabaseServerClient();
    const body = String(formData.get("body") || "").trim();
    const detailParams = new URLSearchParams();
    detailParams.set("return_to", returnTo);

    if (!body) {
      detailParams.set("error", "Comment cannot be empty");
      redirect(`${detailPath}?${detailParams.toString()}`);
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
      detailParams.set("error", "Missing user profile");
      redirect(`${detailPath}?${detailParams.toString()}`);
    }

    const { error } = await supabase.from("feature_suggestion_comments").insert({
      suggestion_id: suggestionId,
      user_id: user.id,
      body,
    });

    if (error) {
      detailParams.set("error", error.message);
      redirect(`${detailPath}?${detailParams.toString()}`);
    }

    revalidatePath(`/feature-suggestions/${suggestionId}`);
    revalidatePath("/feature-suggestions");
    detailParams.set("success", "Comment added");
    redirect(`${detailPath}?${detailParams.toString()}`);
  }

  async function toggleVote(formData: FormData) {
    "use server";
    const supabase = createSupabaseServerClient();
    const direction = String(formData.get("vote") || "up").trim().toLowerCase();
    const desiredValue = direction === "down" ? -1 : 1;
    const detailParams = new URLSearchParams();
    detailParams.set("return_to", returnTo);

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
      detailParams.set("error", "Missing user profile");
      redirect(`${detailPath}?${detailParams.toString()}`);
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
        detailParams.set("error", error.message);
        redirect(`${detailPath}?${detailParams.toString()}`);
      }
    } else if (existingValue !== null) {
      const { error } = await supabase
        .from("feature_suggestion_votes")
        .update({ value: desiredValue })
        .eq("suggestion_id", suggestionId)
        .eq("user_id", user.id);
      if (error) {
        detailParams.set("error", error.message);
        redirect(`${detailPath}?${detailParams.toString()}`);
      }
    } else {
      const { error } = await supabase.from("feature_suggestion_votes").insert({
        suggestion_id: suggestionId,
        user_id: user.id,
        value: desiredValue,
      });
      if (error) {
        detailParams.set("error", error.message);
        redirect(`${detailPath}?${detailParams.toString()}`);
      }
    }

    revalidatePath(`/feature-suggestions/${suggestionId}`);
    revalidatePath("/feature-suggestions");
    redirect(`${detailPath}?${detailParams.toString()}`);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Feature idea</p>
          <h1 className="text-2xl font-semibold text-slate-900">{suggestion.title}</h1>
          <p className="mt-1 text-sm text-slate-600">
            Submitted by {userMap.get(suggestion.created_by || "") || "Unknown user"} on {new Date(suggestion.created_at).toLocaleDateString()}
          </p>
        </div>
        <Link
          href={returnTo}
          className="rounded-md border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:border-slate-400 hover:text-slate-900"
        >
          Back to ideas
        </Link>
      </div>

      {(searchParams?.error || searchParams?.success) && (
        <div className="space-y-2">
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

      <section className="rounded-lg border border-slate-200 bg-white">
        <div className="border-b border-slate-200 px-6 py-4">
          <h2 className="text-lg font-semibold text-slate-900">Idea details</h2>
        </div>
        <form action={updateSuggestion} className="grid gap-4 px-6 py-4 md:grid-cols-2">
          <label className="md:col-span-2 text-xs font-semibold uppercase tracking-wide text-slate-600">
            Title
            <input
              name="title"
              defaultValue={suggestion.title}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
              required
            />
          </label>
          <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
            Status
            <select
              name="status"
              defaultValue={suggestion.status || "idea"}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
            >
              {featureSuggestionStatusOptions.map((status) => (
                <option key={status.value} value={status.value}>
                  {formatStatusLabel(status.value)}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
            Type
            <select
              name="type"
              defaultValue={suggestion.type || "new_feature"}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
            >
              {typeOptions.map((type) => (
                <option key={type} value={type}>
                  {formatTypeLabel(type)}
                </option>
              ))}
            </select>
          </label>
          <label className="md:col-span-2 text-xs font-semibold uppercase tracking-wide text-slate-600">
            Description
            <textarea
              name="details"
              rows={8}
              defaultValue={suggestion.details || ""}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
            />
          </label>
          <div className="md:col-span-2">
            <button
              type="submit"
              className="rounded-md btn-primary px-4 py-2 text-sm font-semibold text-white"
            >
              Save changes
            </button>
          </div>
        </form>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-6 py-4">
          <h2 className="text-lg font-semibold text-slate-900">Votes</h2>
          <form action={toggleVote} className="flex items-center gap-2">
            <span className="min-w-8 text-right text-sm font-semibold text-slate-700">{score}</span>
            <button
              type="submit"
              name="vote"
              value="up"
              className={`rounded-md px-2 py-1 text-xs font-semibold ${
                currentUserVote === 1
                  ? "bg-slate-900 text-white"
                  : "border border-slate-300 text-slate-700 hover:border-slate-400"
              }`}
            >
              <svg
                aria-hidden="true"
                viewBox="0 0 20 20"
                fill="currentColor"
                className="h-4 w-4"
              >
                <path d="M8.3 3.3c.5-1.2 2.2-.8 2.2.5v2.8h4.2c1.1 0 1.9 1 1.7 2l-1.1 6.5a2 2 0 0 1-2 1.7H8a2 2 0 0 1-2-2V9.5l2.3-6.2ZM3.5 9.5a1 1 0 0 1 1-1H5v8H4.5a1 1 0 0 1-1-1v-6Z" />
              </svg>
            </button>
            <button
              type="submit"
              name="vote"
              value="down"
              className={`rounded-md px-2 py-1 text-xs font-semibold ${
                currentUserVote === -1
                  ? "bg-slate-900 text-white"
                  : "border border-slate-300 text-slate-700 hover:border-slate-400"
              }`}
            >
              <svg
                aria-hidden="true"
                viewBox="0 0 20 20"
                fill="currentColor"
                className="h-4 w-4"
              >
                <path d="M11.7 16.7c-.5 1.2-2.2.8-2.2-.5v-2.8H5.3c-1.1 0-1.9-1-1.7-2l1.1-6.5a2 2 0 0 1 2-1.7H12a2 2 0 0 1 2 2v5.3l-2.3 6.2ZM16.5 10.5a1 1 0 0 1-1 1H15v-8h.5a1 1 0 0 1 1 1v6Z" />
              </svg>
            </button>
          </form>
        </div>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white">
        <div className="border-b border-slate-200 px-6 py-4">
          <h2 className="text-lg font-semibold text-slate-900">Comments</h2>
        </div>
        <div className="space-y-4 px-6 py-4">
          <form action={addComment} className="space-y-3">
            <textarea
              name="body"
              rows={3}
              placeholder="Add a comment"
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              required
            />
            <button
              type="submit"
              className="rounded-md btn-primary px-4 py-2 text-sm font-semibold text-white"
            >
              Add comment
            </button>
          </form>

          <div className="space-y-3">
            {comments.length ? (
              comments.map((comment) => (
                <article key={comment.id} className="rounded-md border border-slate-200 p-3">
                  <p className="text-xs text-slate-500">
                    {userMap.get(comment.user_id) || "Unknown user"} - {new Date(comment.created_at).toLocaleString()}
                  </p>
                  <p className="mt-1 whitespace-pre-wrap text-sm text-slate-800">{comment.body}</p>
                </article>
              ))
            ) : (
              <p className="text-sm text-slate-500">No comments yet.</p>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
