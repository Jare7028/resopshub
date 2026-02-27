import Link from "next/link";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import SimpleQuestionBuilder from "./_components/SimpleQuestionBuilder";

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
  title: string;
  created_at: string;
  published_at: string | null;
};

type QuestionRow = {
  id: string;
  quiz_version_id: string;
  question_type: "single_choice" | "multi_select" | "true_false" | "short_answer" | "scenario";
  manual_review_required: boolean;
};

type AssignmentRow = {
  id: string;
  quiz_version_id: string;
  assigned_user_id: string;
  assignment_mode: "required" | "optional";
  due_at: string | null;
  available_from: string | null;
  expires_at: string | null;
  created_at: string;
};

type UserRow = {
  id: string;
  full_name: string | null;
  email: string | null;
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

function dayInputToIso(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return null;
  return `${trimmed}T00:00:00.000Z`;
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
  let canAssign = false;
  let pageLoadError = clientsError?.message || "";

  if (!pageLoadError && selectedClient) {
    const [manageResult, assignResult] = await Promise.all([
      supabase.rpc("quiz_can_manage_client", { client_uuid: selectedClient.id }),
      supabase.rpc("quiz_can_assign_client", { client_uuid: selectedClient.id }),
    ]);

    if (manageResult.error || assignResult.error) {
      pageLoadError = manageResult.error?.message || assignResult.error?.message || "";
    } else {
      canManage = Boolean(manageResult.data);
      canAssign = Boolean(assignResult.data);
    }
  }

  let quizzes: QuizRow[] = [];
  let versions: VersionRow[] = [];
  let questions: QuestionRow[] = [];
  let assignments: AssignmentRow[] = [];
  let assignableUsers: UserRow[] = [];

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
      .select("id,quiz_id,version_number,lifecycle_status,title,created_at,published_at")
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

    const [questionsResult, assignmentsResult] = await Promise.all([
      supabase
        .from("quiz_version_questions")
        .select("id,quiz_version_id,question_type,manual_review_required")
        .in("quiz_version_id", versionIds),
      supabase
        .from("quiz_assignments")
        .select("id,quiz_version_id,assigned_user_id,assignment_mode,due_at,available_from,expires_at,created_at")
        .in("quiz_version_id", versionIds)
        .order("created_at", { ascending: false }),
    ]);

    if (questionsResult.error || assignmentsResult.error) {
      pageLoadError = questionsResult.error?.message || assignmentsResult.error?.message || "";
    } else {
      questions = (questionsResult.data || []) as QuestionRow[];
      assignments = (assignmentsResult.data || []) as AssignmentRow[];
    }
  }

  if (!pageLoadError && selectedClient) {
    const clientUsersResult = await supabase
      .from("client_users")
      .select("user_id")
      .eq("client_id", selectedClient.id);

    if (!clientUsersResult.error) {
      const userIds = Array.from(
        new Set((clientUsersResult.data || []).map((row) => row.user_id).filter(Boolean))
      );
      if (userIds.length > 0) {
        const usersResult = await supabase
          .from("users")
          .select("id,full_name,email")
          .in("id", userIds)
          .order("full_name", { ascending: true });

        if (usersResult.error) {
          pageLoadError = usersResult.error.message;
        } else {
          assignableUsers = (usersResult.data || []) as UserRow[];
        }
      }
    }
  }

  const usersById = new Map(
    assignableUsers.map((user) => [user.id, user.full_name || user.email || user.id])
  );
  const versionsByQuizId = versions.reduce<Record<string, VersionRow[]>>((acc, version) => {
    acc[version.quiz_id] ||= [];
    acc[version.quiz_id].push(version);
    return acc;
  }, {});
  const questionCountByVersionId = questions.reduce<Record<string, number>>((acc, question) => {
    acc[question.quiz_version_id] = (acc[question.quiz_version_id] || 0) + 1;
    return acc;
  }, {});
  const manualReviewCountByVersionId = questions.reduce<Record<string, number>>((acc, question) => {
    if (question.manual_review_required) {
      acc[question.quiz_version_id] = (acc[question.quiz_version_id] || 0) + 1;
    }
    return acc;
  }, {});
  const assignmentCountByVersionId = assignments.reduce<Record<string, number>>((acc, assignment) => {
    acc[assignment.quiz_version_id] = (acc[assignment.quiz_version_id] || 0) + 1;
    return acc;
  }, {});
  const publishedVersions = versions.filter((version) => version.lifecycle_status === "published");
  const readyToPublishVersions = versions.filter(
    (version) => version.lifecycle_status === "draft" && (questionCountByVersionId[version.id] || 0) > 0
  );
  const versionOptions = versions.map((version) => {
    const quiz = quizzes.find((row) => row.id === version.quiz_id);
    const questionCount = questionCountByVersionId[version.id] || 0;
    return {
      id: version.id,
      label:
        (quiz?.title || version.title) +
        ` - v${version.version_number} (${version.lifecycle_status}, ${questionCount} q)`,
    };
  });

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
    const multiSelectMode = String(formData.get("multi_select_scoring_mode") || "all_or_nothing").trim();

    const supabase = createSupabaseServerClient();
    const { error } = await supabase.rpc("quiz_create_definition_with_version", {
      p_client_id: clientId,
      p_title: title,
      p_description: description || null,
      p_passing_score_percent: Number.isFinite(passingScore) ? passingScore : 70,
      p_max_attempts: Number.isInteger(maxAttempts) ? maxAttempts : 1,
      p_time_limit_seconds: timeLimit,
      p_multi_select_scoring_mode: multiSelectMode,
    });

    revalidatePath("/quizzes");
    revalidatePath("/quizzes/manage");

    if (error) {
      redirect(buildManagePath({ clientId, error: error.message }));
    }
    redirect(buildManagePath({ clientId, success: "Quiz created with draft version 1" }));
  }

  async function addQuestionAction(formData: FormData) {
    "use server";
    const clientId = String(formData.get("client_id") || "").trim();
    const quizVersionId = String(formData.get("quiz_version_id") || "").trim();
    const prompt = String(formData.get("prompt") || "").trim();
    const uiQuestionType = String(formData.get("ui_question_type") || "free_text").trim();
    const points = Number.parseFloat(String(formData.get("points") || "1"));
    const questionType = uiQuestionType === "multi_select" ? "multi_select" : "short_answer";
    const manualReviewRequired = questionType === "short_answer";
    const scoringMode = "all_or_nothing";

    if (!uuidRegex.test(clientId) || !uuidRegex.test(quizVersionId)) {
      redirect(buildManagePath({ clientId: selectedClient?.id, error: "Invalid client or quiz version" }));
    }

    if (!prompt) {
      redirect(buildManagePath({ clientId, error: "Question text is required" }));
    }

    const rawOptionLabels = formData
      .getAll("option_label")
      .map((value) => String(value || "").trim());
    const selectedRawPositions = new Set(
      formData
        .getAll("correct_option_positions")
        .map((value) => Number.parseInt(String(value || "").trim(), 10))
        .filter((value) => Number.isInteger(value) && value > 0)
    );

    const optionLabels: string[] = [];
    const correctOptionPositions: number[] = [];
    let compactedPosition = 0;
    for (let idx = 0; idx < rawOptionLabels.length; idx += 1) {
      const label = rawOptionLabels[idx] || "";
      if (!label) continue;
      compactedPosition += 1;
      optionLabels.push(label);
      if (selectedRawPositions.has(idx + 1)) {
        correctOptionPositions.push(compactedPosition);
      }
    }

    if (questionType === "multi_select") {
      if (optionLabels.length < 2) {
        redirect(buildManagePath({ clientId, error: "Multi select needs at least 2 options" }));
      }
      if (correctOptionPositions.length === 0) {
        redirect(buildManagePath({ clientId, error: "Select at least one correct option" }));
      }
    }

    const supabase = createSupabaseServerClient();
    const { error } = await supabase.rpc("quiz_add_version_question", {
      p_quiz_version_id: quizVersionId,
      p_prompt: prompt,
      p_question_type: questionType,
      p_points: Number.isFinite(points) ? points : 1,
      p_scoring_mode: scoringMode,
      p_option_labels: optionLabels,
      p_correct_option_positions: correctOptionPositions,
      p_correct_boolean: null,
      p_accepted_text_answers: [],
      p_manual_review_required: manualReviewRequired,
    });

    revalidatePath("/quizzes/manage");
    revalidatePath("/quizzes");

    if (error) {
      redirect(buildManagePath({ clientId, error: error.message }));
    }
    redirect(buildManagePath({ clientId, success: "Question added to quiz version" }));
  }

  async function publishVersionAction(formData: FormData) {
    "use server";
    const clientId = String(formData.get("client_id") || "").trim();
    const quizVersionId = String(formData.get("quiz_version_id") || "").trim();

    if (!uuidRegex.test(clientId) || !uuidRegex.test(quizVersionId)) {
      redirect(buildManagePath({ clientId: selectedClient?.id, error: "Invalid publish request" }));
    }

    const supabase = createSupabaseServerClient();
    const { error } = await supabase.rpc("quiz_publish_version", {
      p_quiz_version_id: quizVersionId,
    });

    revalidatePath("/quizzes");
    revalidatePath("/quizzes/manage");

    if (error) {
      redirect(buildManagePath({ clientId, error: error.message }));
    }
    redirect(buildManagePath({ clientId, success: "Quiz version published" }));
  }

  async function assignVersionAction(formData: FormData) {
    "use server";
    const clientId = String(formData.get("client_id") || "").trim();
    const quizVersionId = String(formData.get("quiz_version_id") || "").trim();
    const userId = String(formData.get("assigned_user_id") || "").trim();
    const assignmentMode = String(formData.get("assignment_mode") || "required").trim();
    const availableFrom = dayInputToIso(String(formData.get("available_from") || ""));
    const dueAt = dayInputToIso(String(formData.get("due_at") || ""));
    const expiresAt = dayInputToIso(String(formData.get("expires_at") || ""));

    if (!uuidRegex.test(clientId) || !uuidRegex.test(quizVersionId) || !uuidRegex.test(userId)) {
      redirect(buildManagePath({ clientId: selectedClient?.id, error: "Invalid assignment request" }));
    }

    const supabase = createSupabaseServerClient();
    const { error } = await supabase.rpc("quiz_assign_version_to_user", {
      p_quiz_version_id: quizVersionId,
      p_assigned_user_id: userId,
      p_assignment_mode: assignmentMode,
      p_available_from: availableFrom,
      p_due_at: dueAt,
      p_expires_at: expiresAt,
    });

    revalidatePath("/quizzes");
    revalidatePath("/quizzes/manage");

    if (error) {
      redirect(buildManagePath({ clientId, error: error.message }));
    }
    redirect(buildManagePath({ clientId, success: "Quiz assignment saved" }));
  }

  return (
    <div className="space-y-5">
      <header className="space-y-2 rounded-2xl border border-slate-200 bg-white p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
              Quiz Builder
            </p>
            <h1 className="mt-1 text-2xl font-semibold text-slate-900">Build, publish, assign</h1>
          </div>
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
          Use a guided 4-step flow to create quizzes without exposing every setting upfront.
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
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Workspace
        </p>
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
              <h2 className="text-base font-semibold text-slate-900">Step 1 - Create quiz shell</h2>
              <p className="mt-1 text-sm text-slate-600">
                Start with title and description. Keep advanced scoring hidden unless you need it.
              </p>
              <form action={createQuizAction} className="mt-3 grid gap-3">
                <input type="hidden" name="client_id" value={selectedClient.id} />
                <label className="text-sm text-slate-700">
                  Quiz title
                  <input
                    name="title"
                    required
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-800"
                    placeholder="Quarterly Safety Check"
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
                <input type="hidden" name="multi_select_scoring_mode" value="all_or_nothing" />
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

          {canManage && versions.length > 0 ? (
            <section className="rounded-xl border border-slate-200 bg-white p-4">
              <h2 className="text-base font-semibold text-slate-900">Step 2 - Add questions</h2>
              <p className="mt-1 text-sm text-slate-600">
                Choose Free text or Multi select. Free text is manual review. Multi select supports marking correct answers.
              </p>
              <SimpleQuestionBuilder
                action={addQuestionAction}
                clientId={selectedClient.id}
                versions={versionOptions}
              />
            </section>
          ) : canManage ? (
            <section className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-600">
              Create a quiz first. A draft version is generated automatically and appears in Step 2.
            </section>
          ) : null}

          <section className="rounded-xl border border-slate-200 bg-white p-4">
            <h2 className="text-base font-semibold text-slate-900">Step 3 - Publish ready versions</h2>
            <p className="mt-1 text-sm text-slate-600">
              Draft versions with at least one question can be published and assigned.
            </p>
            <p className="mt-1 text-xs text-slate-500">
              Ready drafts: {readyToPublishVersions.length} - Published: {publishedVersions.length}
            </p>
            {quizzes.length === 0 ? (
              <p className="mt-3 text-sm text-slate-600">No quizzes created for this client yet.</p>
            ) : (
              <div className="mt-3 space-y-4">
                {quizzes.map((quiz) => {
                  const quizVersions = (versionsByQuizId[quiz.id] || []).sort(
                    (a, b) => b.version_number - a.version_number
                  );
                  return (
                    <article key={quiz.id} className="rounded-lg border border-slate-200 p-3">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div>
                          <h3 className="text-sm font-semibold text-slate-900">{quiz.title}</h3>
                          <p className="text-xs text-slate-600">
                            Status: {quiz.status} - Pass: {quiz.passing_score_percent}% - Max attempts:{" "}
                            {quiz.max_attempts}
                          </p>
                          <p className="text-xs text-slate-500">
                            Published version: {quiz.published_version_number || 0} - Published at:{" "}
                            {formatDateTime(quiz.published_at)}
                          </p>
                        </div>
                      </div>

                      <div className="mt-3 space-y-2">
                        {quizVersions.map((version) => (
                          <div
                            key={version.id}
                            className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-slate-200 px-3 py-2"
                          >
                            <div>
                              <p className="text-sm font-semibold text-slate-900">
                                v{version.version_number} - {version.lifecycle_status}
                              </p>
                              <p className="text-xs text-slate-600">
                                Questions {questionCountByVersionId[version.id] || 0} - Manual review{" "}
                                {manualReviewCountByVersionId[version.id] || 0} - Assignments{" "}
                                {assignmentCountByVersionId[version.id] || 0}
                              </p>
                              <p className="text-xs text-slate-500">
                                Published: {formatDateTime(version.published_at)}
                              </p>
                            </div>
                            {canManage ? (
                              <form action={publishVersionAction}>
                                <input type="hidden" name="client_id" value={selectedClient.id} />
                                <input type="hidden" name="quiz_version_id" value={version.id} />
                                <button
                                  type="submit"
                                  disabled={(questionCountByVersionId[version.id] || 0) === 0}
                                  className="rounded border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                  Publish
                                </button>
                              </form>
                            ) : (
                              <span className="text-xs text-slate-400">View only</span>
                            )}
                          </div>
                        ))}
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </section>

          {canAssign ? (
            <section className="rounded-xl border border-slate-200 bg-white p-4">
              <h2 className="text-base font-semibold text-slate-900">Step 4 - Assign published versions</h2>
              <p className="mt-1 text-sm text-slate-600">
                Assign only published versions so employees always receive a stable answer key.
              </p>

              {publishedVersions.length === 0 ? (
                <p className="mt-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
                  Publish a version first, then assignment will appear here.
                </p>
              ) : (
                <form action={assignVersionAction} className="mt-3 grid gap-3 md:grid-cols-2">
                  <input type="hidden" name="client_id" value={selectedClient.id} />
                  <label className="text-sm text-slate-700">
                    Published version
                    <select
                      name="quiz_version_id"
                      required
                      className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-800"
                    >
                      {publishedVersions.map((version) => {
                        const quiz = quizzes.find((row) => row.id === version.quiz_id);
                        return (
                          <option key={version.id} value={version.id}>
                            {(quiz?.title || version.title) + ` - v${version.version_number}`}
                          </option>
                        );
                      })}
                    </select>
                  </label>
                  <label className="text-sm text-slate-700">
                    Employee
                    <select
                      name="assigned_user_id"
                      required
                      className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-800"
                    >
                      {assignableUsers.length ? (
                        assignableUsers.map((user) => (
                          <option key={user.id} value={user.id}>
                            {user.full_name || user.email || user.id}
                          </option>
                        ))
                      ) : (
                        <option value="">No client users found</option>
                      )}
                    </select>
                  </label>
                  <label className="text-sm text-slate-700">
                    Assignment mode
                    <select
                      name="assignment_mode"
                      defaultValue="required"
                      className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-800"
                    >
                      <option value="required">Required</option>
                      <option value="optional">Optional</option>
                    </select>
                  </label>
                  <label className="text-sm text-slate-700">
                    Available from
                    <input
                      name="available_from"
                      type="date"
                      className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-800"
                    />
                  </label>
                  <label className="text-sm text-slate-700">
                    Due at
                    <input
                      name="due_at"
                      type="date"
                      className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-800"
                    />
                  </label>
                  <label className="text-sm text-slate-700">
                    Expires at
                    <input
                      name="expires_at"
                      type="date"
                      className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-800"
                    />
                  </label>
                  <div className="md:col-span-2">
                    <button
                      type="submit"
                      className="rounded-md bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-800"
                    >
                      Save assignment
                    </button>
                  </div>
                </form>
              )}
            </section>
          ) : null}

          {assignments.length > 0 ? (
            <details className="rounded-xl border border-slate-200 bg-white p-4">
              <summary className="cursor-pointer text-base font-semibold text-slate-900">
                Recent assignments
              </summary>
              <div className="mt-3 overflow-x-auto">
                <table className="min-w-full text-left text-xs">
                  <thead className="bg-slate-50 text-slate-500">
                    <tr>
                      <th className="px-2 py-1.5">User</th>
                      <th className="px-2 py-1.5">Version</th>
                      <th className="px-2 py-1.5">Mode</th>
                      <th className="px-2 py-1.5">Available</th>
                      <th className="px-2 py-1.5">Due</th>
                      <th className="px-2 py-1.5">Expires</th>
                    </tr>
                  </thead>
                  <tbody>
                    {assignments.slice(0, 25).map((assignment) => {
                      const version = versions.find((entry) => entry.id === assignment.quiz_version_id);
                      return (
                        <tr key={assignment.id} className="border-t border-slate-200">
                          <td className="px-2 py-1.5 text-slate-700">
                            {usersById.get(assignment.assigned_user_id) || assignment.assigned_user_id}
                          </td>
                          <td className="px-2 py-1.5 text-slate-700">
                            {version ? `v${version.version_number}` : assignment.quiz_version_id}
                          </td>
                          <td className="px-2 py-1.5 text-slate-700">{assignment.assignment_mode}</td>
                          <td className="px-2 py-1.5 text-slate-700">{formatDateTime(assignment.available_from)}</td>
                          <td className="px-2 py-1.5 text-slate-700">{formatDateTime(assignment.due_at)}</td>
                          <td className="px-2 py-1.5 text-slate-700">{formatDateTime(assignment.expires_at)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </details>
          ) : null}
        </>
      ) : (
        <section className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-600">
          Select a client to manage quizzes.
        </section>
      )}
    </div>
  );
}
