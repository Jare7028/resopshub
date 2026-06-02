import Link from "next/link";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentRequestUser } from "@/lib/supabase/currentUser";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import QuizzesTable from "./_components/QuizzesTable";

type QuizzesSearchParams = {
  tab?: string;
  error?: string;
  success?: string;
};

type QuizTabKey = "list" | "create";

type QuizRow = {
  id: string;
  title: string;
  status: "draft" | "published" | "archived";
  passing_score_percent: number;
  max_attempts: number;
  published_at: string | null;
  created_at: string;
};

type VersionRow = {
  id: string;
  quiz_id: string;
  version_number: number;
  lifecycle_status: "draft" | "published" | "retired";
};

type QuizTableRow = {
  id: string;
  title: string;
  status: "draft" | "published" | "archived";
  passingScorePercent: number;
  maxAttempts: number;
  publishedAt: string | null;
  questions: number;
  submissions: number;
  openHref: string;
};

type QuestionRow = {
  id: string;
  quiz_version_id: string;
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
};

function normalizeQuizTabKey(value: string | undefined): QuizTabKey {
  return String(value || "")
    .trim()
    .toLowerCase() === "create"
    ? "create"
    : "list";
}

function buildQuizzesPath(args: { tab?: QuizTabKey; error?: string; success?: string }) {
  const params = new URLSearchParams();
  if (args.tab && args.tab !== "list") params.set("tab", args.tab);
  if (args.error) params.set("error", args.error);
  if (args.success) params.set("success", args.success);
  const query = params.toString();
  return query ? `/quizzes?${query}` : "/quizzes";
}

function isSubmissionStatus(status: AttemptRow["status"]) {
  return status !== "in_progress" && status !== "cancelled" && status !== "expired";
}

export default async function QuizzesPage({
  searchParams,
}: {
  searchParams?: Promise<QuizzesSearchParams>;
}) {
  const resolvedSearch = await searchParams;
  const activeTab = normalizeQuizTabKey(resolvedSearch?.tab);
  const errorMessage = String(resolvedSearch?.error || "").trim();
  const successMessage = String(resolvedSearch?.success || "").trim();

  const supabase = createSupabaseServerClient();
  const authUser = await getCurrentRequestUser(supabase, "quizzes.list.auth");
  if (!authUser?.id) redirect("/login");

  const manageResult = await supabase.rpc("can_edit_page", { p_page_key: "quizzes" });
  let canManage = false;
  let pageLoadError = "";
  if (manageResult.error) {
    pageLoadError = manageResult.error.message;
  } else {
    canManage = Boolean(manageResult.data);
  }

  if (!pageLoadError && !canManage) {
    redirect("/quizzes/assigned");
  }

  let quizzes: QuizRow[] = [];
  let versions: VersionRow[] = [];
  let questions: QuestionRow[] = [];
  let attempts: AttemptRow[] = [];

  if (!pageLoadError) {
    const quizzesResult = await supabase
      .from("quiz_definitions")
      .select(
        "id,title,status,passing_score_percent,max_attempts,published_at,created_at"
      )
      .order("created_at", { ascending: false });

    if (quizzesResult.error) {
      pageLoadError = quizzesResult.error.message;
    } else {
      quizzes = (quizzesResult.data || []) as QuizRow[];
    }
  }

  if (!pageLoadError && quizzes.length > 0) {
    const quizIds = quizzes.map((quiz) => quiz.id);
    const versionsResult = await supabase
      .from("quiz_versions")
      .select("id,quiz_id,version_number,lifecycle_status")
      .in("quiz_id", quizIds)
      .order("version_number", { ascending: false });

    if (versionsResult.error) {
      pageLoadError = versionsResult.error.message;
    } else {
      versions = (versionsResult.data || []) as VersionRow[];
    }
  }

  if (!pageLoadError && versions.length > 0) {
    const versionIds = versions.map((version) => version.id);
    const [questionsResult, attemptsResult] = await Promise.all([
      supabase
        .from("quiz_version_questions")
        .select("id,quiz_version_id")
        .in("quiz_version_id", versionIds),
      supabase
        .from("quiz_attempts")
        .select("id,quiz_version_id,status")
        .in("quiz_version_id", versionIds),
    ]);

    if (questionsResult.error || attemptsResult.error) {
      pageLoadError = questionsResult.error?.message || attemptsResult.error?.message || "";
    } else {
      questions = (questionsResult.data || []) as QuestionRow[];
      attempts = (attemptsResult.data || []) as AttemptRow[];
    }
  }

  const versionsByQuizId = versions.reduce<Record<string, VersionRow[]>>((acc, version) => {
    acc[version.quiz_id] ||= [];
    acc[version.quiz_id].push(version);
    return acc;
  }, {});

  const questionCountByVersionId = questions.reduce<Record<string, number>>((acc, question) => {
    acc[question.quiz_version_id] = (acc[question.quiz_version_id] || 0) + 1;
    return acc;
  }, {});

  const submissionCountByVersionId = attempts.reduce<Record<string, number>>((acc, attempt) => {
    if (!isSubmissionStatus(attempt.status)) return acc;
    acc[attempt.quiz_version_id] = (acc[attempt.quiz_version_id] || 0) + 1;
    return acc;
  }, {});

  const quizRows: QuizTableRow[] = quizzes.map((quiz) => {
    const quizVersions = versionsByQuizId[quiz.id] || [];
    const totalQuestions = quizVersions.reduce((sum, version) => {
      return sum + (questionCountByVersionId[version.id] || 0);
    }, 0);
    const totalSubmissions = quizVersions.reduce((sum, version) => {
      return sum + (submissionCountByVersionId[version.id] || 0);
    }, 0);
    const openHref = `/quizzes/${quiz.id}?${new URLSearchParams({
      return_to: buildQuizzesPath({ tab: "list" }),
    }).toString()}`;

    return {
      id: quiz.id,
      title: quiz.title,
      status: quiz.status,
      passingScorePercent: quiz.passing_score_percent,
      maxAttempts: quiz.max_attempts,
      publishedAt: quiz.published_at,
      questions: totalQuestions,
      submissions: totalSubmissions,
      openHref,
    };
  });

  async function createQuizAction(formData: FormData) {
    "use server";
    const title = String(formData.get("title") || "").trim();
    const description = String(formData.get("description") || "").trim();
    const passingScore = Number.parseFloat(String(formData.get("passing_score_percent") || "70"));
    const maxAttempts = Number.parseInt(String(formData.get("max_attempts") || "1"), 10);
    const timeLimitRaw = String(formData.get("time_limit_seconds") || "").trim();
    const timeLimit = timeLimitRaw ? Number.parseInt(timeLimitRaw, 10) : null;

    if (!title) {
      redirect(buildQuizzesPath({ tab: "create", error: "Quiz title is required" }));
    }

    const supabase = createSupabaseServerClient();
    const { error } = await supabase.rpc("quiz_create_definition_with_version", {
      p_title: title,
      p_description: description || null,
      p_passing_score_percent: Number.isFinite(passingScore) ? passingScore : 70,
      p_max_attempts: Number.isInteger(maxAttempts) ? maxAttempts : 1,
      p_time_limit_seconds: timeLimit,
      p_multi_select_scoring_mode: "all_or_nothing",
    });

    revalidatePath("/quizzes");
    revalidatePath("/quizzes/assigned");

    if (error) {
      redirect(buildQuizzesPath({ tab: "create", error: error.message }));
    }
    redirect(buildQuizzesPath({ tab: "list", success: "Quiz created" }));
  }

  const tabUrls: Record<QuizTabKey, string> = {
    list: buildQuizzesPath({ tab: "list" }),
    create: buildQuizzesPath({ tab: "create" }),
  };

  return (
    <div className="space-y-5">
      <section className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-2xl font-semibold text-slate-900">Quizzes</h1>
          <div className="flex flex-wrap gap-2">
            <Link
              href="/quizzes/assigned"
              className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              My assignments
            </Link>
            <Link
              href="/quizzes/review"
              className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Review queue
            </Link>
          </div>
        </div>
        <p className="text-sm text-slate-600">
          Manage quizzes in the same flow as forms: list existing quizzes or create a new one.
        </p>
      </section>

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
      {pageLoadError ? (
        <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {pageLoadError}
        </p>
      ) : null}

      <nav className="flex flex-wrap gap-2 border-b border-slate-200 pb-4 text-sm">
        <Link
          href={tabUrls.list}
          className={`rounded-md px-3 py-1.5 font-medium ${
            activeTab === "list"
              ? "tab-active"
              : "border border-slate-200 text-slate-700 hover:bg-slate-100"
          }`}
        >
          Quizzes
        </Link>
        <Link
          href={tabUrls.create}
          className={`rounded-md px-3 py-1.5 font-medium ${
            activeTab === "create"
              ? "tab-active"
              : "border border-slate-200 text-slate-700 hover:bg-slate-100"
          }`}
        >
          Create quiz
        </Link>
      </nav>

      {activeTab === "create" ? (
        canManage ? (
          <section className="rounded-xl border border-slate-200 bg-white p-4">
            <h2 className="text-base font-semibold text-slate-900">Create quiz</h2>
            <form action={createQuizAction} className="mt-3 grid gap-3">
              <label className="text-sm text-slate-700">
                Quiz title
                <input
                  name="title"
                  required
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-800"
                  placeholder="Quarterly Safety Quiz"
                />
              </label>
              <label className="text-sm text-slate-700">
                Description
                <textarea
                  name="description"
                  rows={2}
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-800"
                  placeholder="Optional context shown to employees"
                />
              </label>
              <details className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                <summary className="cursor-pointer text-sm font-medium text-slate-700">
                  Advanced settings
                </summary>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <label className="text-sm text-slate-700">
                    Passing score (%)
                    <input
                      name="passing_score_percent"
                      type="number"
                      min={0}
                      max={100}
                      step="0.01"
                      defaultValue={70}
                      className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-800"
                    />
                  </label>
                  <label className="text-sm text-slate-700">
                    Max attempts
                    <input
                      name="max_attempts"
                      type="number"
                      min={1}
                      defaultValue={1}
                      className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-800"
                    />
                  </label>
                  <label className="text-sm text-slate-700">
                    Time limit (seconds)
                    <input
                      name="time_limit_seconds"
                      type="number"
                      min={1}
                      className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-800"
                    />
                  </label>
                </div>
              </details>
              <div>
                <button
                  type="submit"
                  className="rounded-md bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-800"
                >
                  Create draft quiz
                </button>
              </div>
            </form>
          </section>
        ) : (
          <section className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
            You do not have manage access for quizzes.
          </section>
        )
      ) : null}

      {activeTab === "list" ? (
        <section className="rounded-xl border border-slate-200 bg-white p-4">
          {quizzes.length === 0 ? (
            <p className="mt-3 text-sm text-slate-600">No quizzes created yet.</p>
          ) : (
            <div className="mt-3">
              <QuizzesTable rows={quizRows} />
            </div>
          )}
        </section>
      ) : null}
    </div>
  );
}
