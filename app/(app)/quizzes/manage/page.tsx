import Link from "next/link";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type ManageSearchParams = {
  client_id?: string;
  error?: string;
  success?: string;
};

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
  created_at: string;
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

function buildManagePath(args: {
  clientId?: string;
  error?: string;
  success?: string;
}) {
  const params = new URLSearchParams();
  if (args.clientId) params.set("client_id", args.clientId);
  if (args.error) params.set("error", args.error);
  if (args.success) params.set("success", args.success);
  const query = params.toString();
  return query ? `/quizzes/manage?${query}` : "/quizzes/manage";
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

function isSubmissionStatus(status: AttemptRow["status"]) {
  return status !== "in_progress" && status !== "cancelled" && status !== "expired";
}

function quizStatusBadgeClass(status: QuizRow["status"]) {
  if (status === "published") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (status === "draft") return "border-amber-200 bg-amber-50 text-amber-700";
  return "border-slate-200 bg-slate-50 text-slate-600";
}

export default async function QuizManagePage({
  searchParams,
}: {
  searchParams?: Promise<ManageSearchParams>;
}) {
  const resolvedSearch = await searchParams;
  const selectedClientIdRaw = String(resolvedSearch?.client_id || "").trim();
  const selectedClientId = uuidRegex.test(selectedClientIdRaw) ? selectedClientIdRaw : "";
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
  const selectedClient =
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
      .select("id,quiz_id,version_number,lifecycle_status,created_at")
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

  async function createQuizAction(formData: FormData) {
    "use server";
    const clientId = String(formData.get("client_id") || "").trim();
    if (!uuidRegex.test(clientId)) {
      redirect(buildManagePath({ clientId: selectedClient?.id, error: "Invalid client id" }));
    }

    const title = String(formData.get("title") || "").trim();
    const description = String(formData.get("description") || "").trim();
    const passingScore = Number.parseFloat(String(formData.get("passing_score_percent") || "70"));
    const maxAttempts = Number.parseInt(String(formData.get("max_attempts") || "1"), 10);
    const timeLimitRaw = String(formData.get("time_limit_seconds") || "").trim();
    const timeLimit = timeLimitRaw ? Number.parseInt(timeLimitRaw, 10) : null;

    if (!title) {
      redirect(buildManagePath({ clientId, error: "Quiz title is required" }));
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
    revalidatePath("/quizzes/manage");

    if (error) {
      redirect(buildManagePath({ clientId, error: error.message }));
    }
    redirect(buildManagePath({ clientId, success: "Quiz created with draft version 1" }));
  }

  return (
    <div className="space-y-5">
      <header className="space-y-2 rounded-2xl border border-slate-200 bg-white p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-2xl font-semibold text-slate-900">Quiz Management</h1>
          <div className="flex flex-wrap gap-2">
            <Link
              href="/quizzes"
              className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Employee view
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
          Create quizzes, then open each quiz to manage questions and view submissions.
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
      {pageLoadError ? (
        <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {pageLoadError}
        </p>
      ) : null}

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Workspace</p>
        {clients.length ? (
          <form method="get" className="mt-3 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
            <label className="text-sm text-slate-700">
              Client
              <select
                name="client_id"
                defaultValue={selectedClient?.id || ""}
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
              Switch client
            </button>
          </form>
        ) : (
          <p className="mt-2 text-sm text-slate-600">No accessible clients found.</p>
        )}
      </section>

      {selectedClient ? (
        <>
          {canManage ? (
            <section className="rounded-xl border border-slate-200 bg-white p-4">
              <h2 className="text-base font-semibold text-slate-900">Create quiz</h2>
              <form action={createQuizAction} className="mt-3 grid gap-3">
                <input type="hidden" name="client_id" value={selectedClient.id} />
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
          )}

          <section className="rounded-xl border border-slate-200 bg-white p-4">
            <h2 className="text-base font-semibold text-slate-900">Quizzes</h2>
            {quizzes.length === 0 ? (
              <p className="mt-3 text-sm text-slate-600">No quizzes created for this client yet.</p>
            ) : (
              <div className="mt-3 overflow-x-auto">
                <table className="min-w-full text-left text-sm">
                  <thead className="bg-slate-50 text-slate-600">
                    <tr>
                      <th className="px-3 py-2">Quiz</th>
                      <th className="px-3 py-2">Status</th>
                      <th className="px-3 py-2">Versions</th>
                      <th className="px-3 py-2">Questions</th>
                      <th className="px-3 py-2">Submissions</th>
                      <th className="px-3 py-2">Published</th>
                      <th className="px-3 py-2">Open</th>
                    </tr>
                  </thead>
                  <tbody>
                    {quizzes.map((quiz) => {
                      const quizVersions = versionsByQuizId[quiz.id] || [];
                      const totalQuestions = quizVersions.reduce((sum, version) => {
                        return sum + (questionCountByVersionId[version.id] || 0);
                      }, 0);
                      const totalSubmissions = quizVersions.reduce((sum, version) => {
                        return sum + (submissionCountByVersionId[version.id] || 0);
                      }, 0);
                      const openHref = `/quizzes/manage/${quiz.id}?${new URLSearchParams({
                        client_id: selectedClient.id,
                      }).toString()}`;

                      return (
                        <tr key={quiz.id} className="border-t border-slate-200">
                          <td className="px-3 py-2">
                            <p className="font-medium text-slate-900">{quiz.title}</p>
                            <p className="text-xs text-slate-500">
                              Pass {quiz.passing_score_percent}% - Max attempts {quiz.max_attempts}
                            </p>
                          </td>
                          <td className="px-3 py-2">
                            <span
                              className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-semibold ${quizStatusBadgeClass(quiz.status)}`}
                            >
                              {quiz.status}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-slate-700">{quizVersions.length}</td>
                          <td className="px-3 py-2 text-slate-700">{totalQuestions}</td>
                          <td className="px-3 py-2 text-slate-700">{totalSubmissions}</td>
                          <td className="px-3 py-2 text-slate-700">{formatDateTime(quiz.published_at)}</td>
                          <td className="px-3 py-2">
                            <Link
                              href={openHref}
                              className="rounded-md border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                            >
                              Open quiz
                            </Link>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      ) : (
        <section className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-600">
          Select a client to manage quizzes.
        </section>
      )}
    </div>
  );
}
