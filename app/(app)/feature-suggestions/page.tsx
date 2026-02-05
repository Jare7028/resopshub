import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type SuggestionRow = {
  id: string;
  title: string;
  details: string | null;
  status: string | null;
  created_at: string;
  created_by: string | null;
  users?: { full_name?: string | null; email?: string | null } | null;
};

const statusOptions = ["idea", "planned", "completed", "rejected"] as const;

export default async function FeatureSuggestionsPage(props: {
  searchParams?: Promise<{ error?: string; success?: string }>;
}) {
  const searchParams = await props.searchParams;
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

  const { data: suggestions } = await supabase
    .from("feature_suggestions")
    .select("id,title,details,status,created_at,created_by,users(full_name,email)")
    .order("created_at", { ascending: false });

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
      redirect("/feature-suggestions?error=Title%20is%20required");
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
      redirect("/feature-suggestions?error=Missing%20user%20profile");
    }

    const { error } = await supabase.from("feature_suggestions").insert({
      title,
      details: details || null,
      created_by: user.id,
    });

    if (error) {
      redirect(`/feature-suggestions?error=${encodeURIComponent(error.message)}`);
    }

    revalidatePath("/feature-suggestions");
    redirect("/feature-suggestions?success=Suggestion%20submitted");
  }

  async function toggleVote(formData: FormData) {
    "use server";
    const supabase = createSupabaseServerClient();
    const suggestionId = String(formData.get("suggestion_id") || "").trim();

    if (!suggestionId) {
      redirect("/feature-suggestions?error=Missing%20suggestion%20id");
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
      redirect("/feature-suggestions?error=Missing%20user%20profile");
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
        redirect(`/feature-suggestions?error=${encodeURIComponent(error.message)}`);
      }
    } else {
      const { error } = await supabase.from("feature_suggestion_votes").insert({
        suggestion_id: suggestionId,
        user_id: user.id,
      });

      if (error) {
        redirect(`/feature-suggestions?error=${encodeURIComponent(error.message)}`);
      }
    }

    revalidatePath("/feature-suggestions");
    redirect("/feature-suggestions");
  }

  async function updateStatus(formData: FormData) {
    "use server";
    const supabase = createSupabaseServerClient();
    const suggestionId = String(formData.get("suggestion_id") || "").trim();
    const status = String(formData.get("status") || "").trim();

    if (!suggestionId || !status) {
      redirect("/feature-suggestions?error=Missing%20status%20update");
    }

    if (!statusOptions.includes(status as (typeof statusOptions)[number])) {
      redirect("/feature-suggestions?error=Invalid%20status");
    }

    const { error } = await supabase
      .from("feature_suggestions")
      .update({ status })
      .eq("id", suggestionId);

    if (error) {
      redirect(`/feature-suggestions?error=${encodeURIComponent(error.message)}`);
    }

    revalidatePath("/feature-suggestions");
    redirect("/feature-suggestions");
  }

  const suggestionRows = (suggestions || []) as SuggestionRow[];

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
          <h2 className="text-lg font-semibold text-slate-900">Ideas</h2>
        </div>
        <div className="divide-y divide-slate-200">
          {suggestionRows.length ? (
            suggestionRows.map((suggestion) => {
              const votesForSuggestion = voteCounts.get(suggestion.id) || 0;
              const hasVoted = userVotes.has(suggestion.id);
              const authorName =
                suggestion.users?.full_name ||
                suggestion.users?.email ||
                "Unknown";
              return (
                <div key={suggestion.id} className="flex flex-col gap-4 px-6 py-4 md:flex-row md:items-start md:justify-between">
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-base font-semibold text-slate-900">
                        {suggestion.title}
                      </p>
                      <span className="rounded-full border border-slate-300 px-2 py-0.5 text-xs font-semibold uppercase text-slate-600">
                        {suggestion.status || "idea"}
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
                    <form action={updateStatus} className="flex flex-wrap items-center gap-2">
                      <input
                        type="hidden"
                        name="suggestion_id"
                        value={suggestion.id}
                      />
                      <select
                        name="status"
                        defaultValue={suggestion.status || "idea"}
                        className="rounded-md border border-slate-300 px-2 py-1 text-xs"
                      >
                        {statusOptions.map((status) => (
                          <option key={status} value={status}>
                            {status}
                          </option>
                        ))}
                      </select>
                      <button
                        type="submit"
                        className="rounded-md border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-700 hover:border-slate-400"
                      >
                        Update status
                      </button>
                    </form>
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
