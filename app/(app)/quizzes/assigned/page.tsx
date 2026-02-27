import Link from "next/link";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type QuizzesSearchParams = {
  error?: string;
  success?: string;
};

type AssignmentRow = {
  id: string;
  quiz_version_id: string;
  assignment_mode: "required" | "optional";
  available_from: string | null;
  due_at: string | null;
  expires_at: string | null;
  created_at: string;
};

type QuizVersionRow = {
  id: string;
  quiz_id: string;
  version_number: number;
  title: string;
  lifecycle_status: "draft" | "published" | "retired";
};

type QuizRow = {
  id: string;
  title: string;
  max_attempts: number;
  passing_score_percent: number;
};

type AttemptRow = {
  id: string;
  quiz_version_id: string;
  status:
    | "in_progress"
    | "submitted"
    | "auto_scored"
    | "partially_scored"
    | "final_scored"
    | "expired"
    | "cancelled";
  attempt_number: number;
  score_percent: number | null;
  passed: boolean | null;
  started_at: string;
  submitted_at: string | null;
  requires_manual_review: boolean;
};

function extractUuid(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return uuidRegex.test(trimmed) ? trimmed : null;
  }
  if (Array.isArray(value)) {
    for (const nested of value) {
      const result = extractUuid(nested);
      if (result) return result;
    }
    return null;
  }
  if (value && typeof value === "object") {
    for (const nested of Object.values(value as Record<string, unknown>)) {
      const result = extractUuid(nested);
      if (result) return result;
    }
  }
  return null;
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return "N/A";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "N/A";
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function statusLabel(status: AttemptRow["status"]) {
  if (status === "in_progress") return "In progress";
  if (status === "submitted") return "Submitted";
  if (status === "auto_scored") return "Auto-scored";
  if (status === "partially_scored") return "Partially scored";
  if (status === "final_scored") return "Final scored";
  if (status === "expired") return "Expired";
  return "Cancelled";
}

function resultLabel(attempt: AttemptRow) {
  if (attempt.passed == null) {
    return attempt.requires_manual_review ? "Pending review" : "Pending";
  }
  return attempt.passed ? "Pass" : "Fail";
}

export default async function QuizzesPage({
  searchParams,
}: {
  searchParams?: Promise<QuizzesSearchParams>;
}) {
  const resolvedSearch = await searchParams;
  const errorMessage = String(resolvedSearch?.error || "").trim();
  const successMessage = String(resolvedSearch?.success || "").trim();

  const supabase = createSupabaseServerClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user?.id) redirect("/login");

  const userId = authData.user.id;

  const { data: assignmentsData, error: assignmentsError } = await supabase
    .from("quiz_assignments")
    .select("id,quiz_version_id,assignment_mode,available_from,due_at,expires_at,created_at")
    .eq("assigned_user_id", userId)
    .order("due_at", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: false });

  const assignments = (assignmentsData || []) as AssignmentRow[];
  let loadError = assignmentsError?.message || "";

  let versionsById = new Map<string, QuizVersionRow>();
  let quizzesById = new Map<string, QuizRow>();
  const attemptsByVersion = new Map<string, AttemptRow[]>();

  const versionIds = Array.from(new Set(assignments.map((row) => row.quiz_version_id).filter(Boolean)));
  if (!loadError && versionIds.length > 0) {
    const { data: versionsData, error: versionsError } = await supabase
      .from("quiz_versions")
      .select("id,quiz_id,version_number,title,lifecycle_status")
      .in("id", versionIds);

    if (versionsError) {
      loadError = versionsError.message;
    } else {
      const versions = (versionsData || []) as QuizVersionRow[];
      versionsById = new Map(versions.map((row) => [row.id, row]));

      const quizIds = Array.from(new Set(versions.map((row) => row.quiz_id).filter(Boolean)));
      if (quizIds.length > 0) {
        const { data: quizzesData, error: quizzesError } = await supabase
          .from("quiz_definitions")
          .select("id,title,max_attempts,passing_score_percent")
          .in("id", quizIds);

        if (quizzesError) {
          loadError = quizzesError.message;
        } else {
          const quizzes = (quizzesData || []) as QuizRow[];
          quizzesById = new Map(quizzes.map((row) => [row.id, row]));
        }
      }
    }
  }

  if (!loadError && versionIds.length > 0) {
    const { data: attemptsData, error: attemptsError } = await supabase
      .from("quiz_attempts")
      .select("id,quiz_version_id,status,attempt_number,score_percent,passed,started_at,submitted_at,requires_manual_review")
      .eq("user_id", userId)
      .in("quiz_version_id", versionIds)
      .order("attempt_number", { ascending: false })
      .order("started_at", { ascending: false });

    if (attemptsError) {
      loadError = attemptsError.message;
    } else {
      const attempts = (attemptsData || []) as AttemptRow[];
      for (const attempt of attempts) {
        const existing = attemptsByVersion.get(attempt.quiz_version_id) || [];
        existing.push(attempt);
        attemptsByVersion.set(attempt.quiz_version_id, existing);
      }
      for (const entry of attemptsByVersion.values()) {
        entry.sort((a, b) => {
          if (a.attempt_number !== b.attempt_number) {
            return b.attempt_number - a.attempt_number;
          }
          return new Date(b.started_at).getTime() - new Date(a.started_at).getTime();
        });
      }
    }
  }

  async function startAttemptAction(formData: FormData) {
    "use server";
    const assignmentId = String(formData.get("assignment_id") || "").trim();
    if (!uuidRegex.test(assignmentId)) {
      redirect("/quizzes/assigned?error=Invalid assignment id");
    }

    const supabase = createSupabaseServerClient();
    const { data, error } = await supabase.rpc("quiz_start_attempt", {
      p_assignment_id: assignmentId,
    });

    if (error) {
      redirect(`/quizzes/assigned?error=${encodeURIComponent(error.message)}`);
    }

    const attemptId = extractUuid(data);
    if (!attemptId) {
      redirect("/quizzes/assigned?error=Unable to start attempt");
    }

    revalidatePath("/quizzes/assigned");
    redirect(`/quizzes/attempts/${attemptId}?success=${encodeURIComponent("Attempt ready")}`);
  }

  const assignmentCards = assignments.map((assignment) => {
    const version = versionsById.get(assignment.quiz_version_id);
    const quiz = version ? quizzesById.get(version.quiz_id) : null;
    const attempts = attemptsByVersion.get(assignment.quiz_version_id) || [];
    const inProgressAttempt = attempts.find((row) => row.status === "in_progress") || null;
    const latestAttempt = attempts[0] || null;
    const primaryAttempt = inProgressAttempt || latestAttempt;
    const needsReview = latestAttempt ? resultLabel(latestAttempt) === "Pending review" : false;
    const isComplete =
      latestAttempt != null &&
      latestAttempt.status !== "in_progress" &&
      latestAttempt.status !== "submitted" &&
      !needsReview;
    const needsAttention = inProgressAttempt != null || latestAttempt == null || needsReview;

    return {
      assignment,
      version,
      quiz,
      inProgressAttempt,
      latestAttempt,
      primaryAttempt,
      needsReview,
      isComplete,
      needsAttention,
    };
  });

  const attentionCards = assignmentCards.filter((card) => card.needsAttention);
  const completedCards = assignmentCards.filter((card) => card.isComplete);
  const pendingReviewCount = assignmentCards.filter((card) => card.needsReview).length;
  const orderedAssignmentCards = [...assignmentCards].sort((left, right) => {
    if (left.needsAttention !== right.needsAttention) {
      return left.needsAttention ? -1 : 1;
    }
    if (left.assignment.due_at && right.assignment.due_at) {
      return new Date(left.assignment.due_at).getTime() - new Date(right.assignment.due_at).getTime();
    }
    if (left.assignment.due_at) return -1;
    if (right.assignment.due_at) return 1;
    return new Date(right.assignment.created_at).getTime() - new Date(left.assignment.created_at).getTime();
  });

  return (
    <div className="space-y-4">
      <header className="space-y-2 rounded-2xl border border-slate-200 bg-white p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-2xl font-semibold text-slate-900">My Quiz Assignments</h1>
          <div className="flex flex-wrap gap-2">
            <Link
              href="/quizzes"
              className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Manage quizzes
            </Link>
            <Link
              href="/quizzes/review"
              className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Review Queue
            </Link>
          </div>
        </div>
        <p className="text-sm text-slate-600">
          Track assigned quizzes, continue in-progress attempts, and see scoring outcomes.
        </p>
      </header>

      {errorMessage ? (
        <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {errorMessage}
        </p>
      ) : null}
      {successMessage ? (
        <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          {successMessage}
        </p>
      ) : null}
      {loadError ? (
        <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {loadError}
        </p>
      ) : null}

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Assigned</p>
          <p className="mt-2 text-2xl font-semibold text-slate-900">{assignmentCards.length}</p>
          <p className="text-xs text-slate-600">Total active assignments</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Needs Attention</p>
          <p className="mt-2 text-2xl font-semibold text-slate-900">{attentionCards.length}</p>
          <p className="text-xs text-slate-600">No attempt yet, in progress, or review pending</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Pending Review</p>
          <p className="mt-2 text-2xl font-semibold text-slate-900">{pendingReviewCount}</p>
          <p className="text-xs text-slate-600">Awaiting manual marking</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Completed</p>
          <p className="mt-2 text-2xl font-semibold text-slate-900">{completedCards.length}</p>
          <p className="text-xs text-slate-600">Scored attempts with final outcomes</p>
        </div>
      </section>

      <section className="space-y-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Assignments (sorted by urgency)
        </p>
        {assignments.length === 0 ? (
          <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-600">
            No quiz assignments yet.
          </div>
        ) : (
          orderedAssignmentCards.map((card) => {
            return (
              <article key={card.assignment.id} className="rounded-xl border border-slate-200 bg-white p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="space-y-1">
                    <h2 className="text-base font-semibold text-slate-900">
                      {card.quiz?.title || card.version?.title || "Untitled quiz"}
                    </h2>
                    <p className="text-xs text-slate-500">
                      Version {card.version?.version_number ?? "?"} -{" "}
                      {card.assignment.assignment_mode === "required" ? "Required" : "Optional"}
                    </p>
                    <p className="text-xs text-slate-500">
                      Available: {formatDateTime(card.assignment.available_from)} - Due:{" "}
                      {formatDateTime(card.assignment.due_at)}
                    </p>
                    {card.assignment.expires_at ? (
                      <p className="text-xs text-slate-500">
                        Expires: {formatDateTime(card.assignment.expires_at)}
                      </p>
                    ) : null}
                    {card.quiz ? (
                      <p className="text-xs text-slate-500">
                        Passing score: {card.quiz.passing_score_percent}% - Max attempts: {card.quiz.max_attempts}
                      </p>
                    ) : null}
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    {card.primaryAttempt ? (
                      <Link
                        href={`/quizzes/attempts/${card.primaryAttempt.id}`}
                        className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
                      >
                        {card.inProgressAttempt ? "Continue attempt" : "View attempt"}
                      </Link>
                    ) : null}
                    <form action={startAttemptAction}>
                      <input type="hidden" name="assignment_id" value={card.assignment.id} />
                      <button
                        type="submit"
                        className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-semibold text-white hover:bg-slate-800"
                      >
                        {card.primaryAttempt ? "Start another attempt" : "Start attempt"}
                      </button>
                    </form>
                  </div>
                </div>

                {card.latestAttempt ? (
                  <div className="mt-3 grid gap-2 rounded-lg border border-slate-100 bg-slate-50 p-3 text-xs text-slate-600 sm:grid-cols-4">
                    <p>
                      <span className="font-semibold text-slate-700">Latest status:</span>{" "}
                      {statusLabel(card.latestAttempt.status)}
                    </p>
                    <p>
                      <span className="font-semibold text-slate-700">Attempt #:</span>{" "}
                      {card.latestAttempt.attempt_number}
                    </p>
                    <p>
                      <span className="font-semibold text-slate-700">Score:</span>{" "}
                      {card.latestAttempt.score_percent == null
                        ? "Pending"
                        : `${card.latestAttempt.score_percent}%`}
                    </p>
                    <p>
                      <span className="font-semibold text-slate-700">Result:</span>{" "}
                      {resultLabel(card.latestAttempt)}
                    </p>
                  </div>
                ) : null}
              </article>
            );
          })
        )}
      </section>
    </div>
  );
}
