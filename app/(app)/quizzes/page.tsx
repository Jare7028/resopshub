import Link from "next/link";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import QuizzesTable from "./_components/QuizzesTable";

const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type QuizzesSearchParams = {
  client_id?: string;
  tab?: string;
  error?: string;
  success?: string;
};

type QuizTabKey = "list" | "create";

type ClientRow = {
  id: string;
  name: string;
};

type QuizRow = {
  id: string;
  title: string;
  status: "draft" | "published" | "archived";
  passing_score_percent: number;
  max_attempts: number;
  published_version_number: number;
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
  versions: number;
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

function buildQuizzesPath(args: {
  clientId?: string;
  tab?: QuizTabKey;
  error?: string;
  success?: string;
}) {
  const params = new URLSearchParams();
  if (args.clientId) params.set("client_id", args.clientId);
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
  const selectedClientIdRaw = String(resolvedSearch?.client_id || "").trim();
  const selectedClientId = uuidRegex.test(selectedClientIdRaw) ? selectedClientIdRaw : "";
  const activeTab = normalizeQuizTabKey(resolvedSearch?.tab);
  const errorMessage = String(resolvedSearch?.error || "").trim();
  const successMessage = String(resolvedSearch?.success || "").trim();

  const supabase = createSupabaseServerClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user?.id) redirect("/login");

  const { data: clientsData, error: clientsError } = await supabase
    .from("clients")
    .select("id,name")
    .order("name", { ascending: true });

  const clients = (clientsData || []) as ClientRow[];
  let selectedClient =
    (selectedClientId ? clients.find((client) => client.id === selectedClientId) : null) ||
    clients[0] ||
    null;

  let canManage = false;
  let pageLoadError = clientsError?.message || "";

  if (!pageLoadError && selectedClient) {
    const manageResult = await supabase.rpc("quiz_can_manage_client", {
      client_uuid: selectedClient.id,
    });
    if (manageResult.error) {
      pageLoadError = manageResult.error.message;
    } else {
      canManage = Boolean(manageResult.data);
    }
  }

  if (!pageLoadError && clients.length > 0 && !canManage) {
    for (const candidate of clients) {
      if (selectedClient && candidate.id === selectedClient.id) continue;
      const manageResult = await supabase.rpc("quiz_can_manage_client", {
        client_uuid: candidate.id,
      });
      if (manageResult.error) {
        pageLoadError = manageResult.error.message;
        break;
      }
      if (manageResult.data) {
        selectedClient = candidate;
        canManage = true;
        break;
      }
    }
  }

  if (!pageLoadError && clients.length > 0 && !canManage) {
    redirect("/quizzes/assigned");
  }

  let quizzes: QuizRow[] = [];
  let versions: VersionRow[] = [];
  let questions: QuestionRow[] = [];
  let attempts: AttemptRow[] = [];

  if (!pageLoadError && selectedClient) {
    const quizzesResult = await supabase
      .from("quiz_definitions")
      .select(
        "id,title,status,passing_score_percent,max_attempts,published_version_number,published_at,created_at"
      )
      .eq("client_id", selectedClient.id)
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
      return_to: buildQuizzesPath({ clientId: selectedClient?.id, tab: "list" }),
    }).toString()}`;

    return {
      id: quiz.id,
      title: quiz.title,
      status: quiz.status,
      passingScorePercent: quiz.passing_score_percent,
      maxAttempts: quiz.max_attempts,
      publishedAt: quiz.published_at,
      versions: quizVersions.length,
      questions: totalQuestions,
      submissions: totalSubmissions,
      openHref,
    };
  });

  async function createQuizAction(formData: FormData) {
    "use server";
    const clientId = String(formData.get("client_id") || "").trim();
    if (!uuidRegex.test(clientId)) {
      redirect(buildQuizzesPath({ clientId: selectedClient?.id, tab: "create", error: "Invalid client id" }));
    }

    const title = String(formData.get("title") || "").trim();
    const description = String(formData.get("description") || "").trim();
    const passingScore = Number.parseFloat(String(formData.get("passing_score_percent") || "70"));
    const maxAttempts = Number.parseInt(String(formData.get("max_attempts") || "1"), 10);
    const timeLimitRaw = String(formData.get("time_limit_seconds") || "").trim();
    const timeLimit = timeLimitRaw ? Number.parseInt(timeLimitRaw, 10) : null;

    if (!title) {
      redirect(buildQuizzesPath({ clientId, tab: "create", error: "Quiz title is required" }));
    }

    const supabase = createSupabaseServerClient();
    const { error } = await supabase.rpc("quiz_create_definition_with_version", {
      p_client_id: clientId,
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
      redirect(buildQuizzesPath({ clientId, tab: "create", error: error.message }));
    }
    redirect(buildQuizzesPath({ clientId, tab: "list", success: "Quiz created with draft version 1" }));
  }

  const tabUrls: Record<QuizTabKey, string> = {
    list: buildQuizzesPath({ clientId: selectedClient?.id, tab: "list" }),
    create: buildQuizzesPath({ clientId: selectedClient?.id, tab: "create" }),
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
              href={selectedClient ? `/quizzes/review?client_id=${selectedClient.id}` : "/quizzes/review"}
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

      {!selectedClient ? (
        <section className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-600">
          No accessible clients found.
        </section>
      ) : null}

      {activeTab === "create" && selectedClient ? (
        canManage ? (
          <section className="rounded-xl border border-slate-200 bg-white p-4">
            <h2 className="text-base font-semibold text-slate-900">Create quiz</h2>
            <form action={createQuizAction} className="mt-3 grid gap-3">
              <label className="text-sm text-slate-700">
                Client
                <select
                  name="client_id"
                  defaultValue={selectedClient.id}
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-800"
                >
                  {clients.map((client) => (
                    <option key={client.id} value={client.id}>
                      {client.name}
                    </option>
                  ))}
                </select>
              </label>
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
            You do not have manage access for this client.
          </section>
        )
      ) : null}

      {activeTab === "list" && selectedClient ? (
        <section className="rounded-xl border border-slate-200 bg-white p-4">
          <form method="get" className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
            <input type="hidden" name="tab" value="list" />
            <label className="text-sm text-slate-700">
              Client
              <select
                name="client_id"
                defaultValue={selectedClient.id}
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-800"
              >
                {clients.map((client) => (
                  <option key={client.id} value={client.id}>
                    {client.name}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="submit"
              className="self-end rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Apply
            </button>
          </form>

          {quizzes.length === 0 ? (
            <p className="mt-3 text-sm text-slate-600">No quizzes created for this client yet.</p>
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
