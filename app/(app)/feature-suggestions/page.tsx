import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import FeatureSuggestionControls from "./FeatureSuggestionControls";
import FeatureSuggestionStatus from "./FeatureSuggestionStatus";

type SuggestionRow = {
  id: string;
  title: string;
  details: string | null;
  status: string | null;
  created_at: string;
  created_by: string | null;
};

const statusOptions = ["idea", "needs_checking", "planned", "completed", "rejected"] as const;

const formatStatusLabel = (status: string) =>
  status
    .split("_")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");

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
  searchParams?: Promise<{ error?: string; success?: string; hide?: string; sort?: string }>;
}) {
  const searchParams = await props.searchParams;
  const supabase = createSupabaseServerClient();
  const { data: authData } = await supabase.auth.getUser();
  const authEmail = authData.user?.email;
  const hideCompleted = (searchParams?.hide ?? "1").trim() !== "0";
  const selectedSort = (searchParams?.sort || "latest").trim();

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

  const baseParams = new URLSearchParams();
  baseParams.set("hide", hideCompleted ? "1" : "0");
  if (selectedSort && selectedSort !== "latest") {
    baseParams.set("sort", selectedSort);
  }
  const returnBaseQuery = baseParams.toString();
  const returnTo = buildFeatureSuggestionsReturnUrl(returnBaseQuery);

  let suggestionsQuery = supabase
    .from("feature_suggestions")
    .select("id,title,details,status,created_at,created_by")
    .order("created_at", { ascending: false });

  if (hideCompleted) {
    suggestionsQuery = suggestionsQuery.not("status", "in", "(completed,rejected)");
  }

  const { data: suggestions, error: suggestionsError } = await suggestionsQuery;

  const { data: votes } = await supabase
    .from("feature_suggestion_votes")
    .select("suggestion_id,user_id");

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

  async function createSuggestion(formData: FormData) {
    "use server";
    const supabase = createSupabaseServerClient();
    const title = String(formData.get("title") || "").trim();
    const details = String(formData.get("details") || "").trim();

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

  let suggestionRows = (suggestions || []) as SuggestionRow[];
  const authorIds = Array.from(
    new Set(
      suggestionRows.map((row) => row.created_by).filter(Boolean) as string[]
    )
  );
  const authorMap = new Map<string, { full_name?: string | null; email?: string | null }>();

  if (authorIds.length) {
    const { data: authors } = await supabase
      .from("users")
      .select("id,full_name,email")
      .in("id", authorIds);
    (authors || []).forEach((author) => {
      authorMap.set(author.id, { full_name: author.full_name, email: author.email });
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
        <div className="divide-y divide-slate-200">
          {suggestionRows.length ? (
            suggestionRows.map((suggestion) => {
              const votesForSuggestion = voteCounts.get(suggestion.id) || 0;
              const hasVoted = userVotes.has(suggestion.id);
              const author = suggestion.created_by
                ? authorMap.get(suggestion.created_by)
                : null;
              const authorName = author?.full_name || author?.email || "Unknown";
              return (
                <div key={suggestion.id} className="flex flex-col gap-4 px-6 py-4 md:flex-row md:items-start md:justify-between">
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-base font-semibold text-slate-900">
                        {suggestion.title}
                      </p>
                      <span className="rounded-full border border-slate-300 px-2 py-0.5 text-xs font-semibold uppercase text-slate-600">
                        {formatStatusLabel(suggestion.status || "idea")}
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
