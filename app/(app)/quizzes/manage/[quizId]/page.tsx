import Link from "next/link";
import { revalidatePath } from "next/cache";
import { notFound, redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import SimpleQuestionBuilder from "../_components/SimpleQuestionBuilder";

const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type ManageDetailSearchParams = {
  client_id?: string;
  version_id?: string;
  error?: string;
  success?: string;
};

type QuizRow = {
  id: string;
  client_id: string;
  title: string;
  status: "draft" | "published" | "archived";
  passing_score_percent: number;
  max_attempts: number;
  published_version_number: number;
  published_at: string | null;
};

type VersionRow = {
  id: string;
  quiz_id: string;
  version_number: number;
  lifecycle_status: "draft" | "published" | "retired";
  created_at: string;
  published_at: string | null;
};

type QuestionRow = {
  id: string;
  quiz_version_id: string;
  position: number;
  prompt: string;
  question_type: "single_choice" | "multi_select" | "true_false" | "short_answer" | "scenario";
  option_snapshot_json: unknown;
};

type AttemptRow = {
  id: string;
  quiz_version_id: string;
  user_id: string;
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
  submitted_at: string | null;
  started_at: string;
};

type AnswerRow = {
  id: string;
  attempt_id: string;
  quiz_version_question_id: string;
  selected_option_ids: string[];
  answer_text: string | null;
  answer_boolean: boolean | null;
};

type UserRow = {
  id: string;
  full_name: string | null;
  email: string | null;
};

type OptionSnapshot = {
  id: string;
  label: string;
};

function buildManagePath(clientId?: string) {
  return clientId ? `/quizzes/manage?client_id=${clientId}` : "/quizzes/manage";
}

function buildDetailPath(args: {
  quizId: string;
  clientId: string;
  versionId?: string;
  error?: string;
  success?: string;
}) {
  const params = new URLSearchParams();
  params.set("client_id", args.clientId);
  if (args.versionId) params.set("version_id", args.versionId);
  if (args.error) params.set("error", args.error);
  if (args.success) params.set("success", args.success);
  return `/quizzes/manage/${args.quizId}?${params.toString()}`;
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

function parseOptionSnapshot(value: unknown): OptionSnapshot[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => {
      if (!entry || typeof entry !== "object") return null;
      const row = entry as Record<string, unknown>;
      const idRaw = String(row.id ?? "").trim();
      if (!uuidRegex.test(idRaw)) return null;
      const labelRaw = String(row.label ?? row.option_text ?? row.value ?? idRaw).trim();
      return {
        id: idRaw,
        label: labelRaw || idRaw,
      };
    })
    .filter(Boolean) as OptionSnapshot[];
}

function formatSubmissionAnswer(answer: AnswerRow | null, question: QuestionRow): string {
  if (!answer) return "-";
  if (question.question_type === "true_false") {
    if (answer.answer_boolean === true) return "True";
    if (answer.answer_boolean === false) return "False";
    return "-";
  }

  if (question.question_type === "single_choice" || question.question_type === "multi_select") {
    const optionsById = new Map(
      parseOptionSnapshot(question.option_snapshot_json).map((option) => [option.id, option.label])
    );
    const labels = (answer.selected_option_ids || []).map((optionId) => optionsById.get(optionId) || optionId);
    return labels.length ? labels.join(", ") : "-";
  }

  const text = String(answer.answer_text || "").trim();
  return text || "-";
}

export default async function QuizManageDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ quizId: string }>;
  searchParams?: Promise<ManageDetailSearchParams>;
}) {
  const resolvedParams = await params;
  const resolvedSearch = await searchParams;
  const quizId = String(resolvedParams.quizId || "").trim();
  if (!uuidRegex.test(quizId)) notFound();

  const errorMessage = String(resolvedSearch?.error || "").trim();
  const successMessage = String(resolvedSearch?.success || "").trim();

  const supabase = createSupabaseServerClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user?.id) redirect("/login");

  const { data: quizData, error: quizError } = await supabase
    .from("quiz_definitions")
    .select("id,client_id,title,status,passing_score_percent,max_attempts,published_version_number,published_at")
    .eq("id", quizId)
    .maybeSingle();

  if (quizError) {
    redirect(`/quizzes/manage?error=${encodeURIComponent(quizError.message)}`);
  }
  if (!quizData) {
    notFound();
  }
  const quiz = quizData as QuizRow;

  let canManage = false;
  let canAssign = false;
  let pageLoadError = "";

  const [manageResult, assignResult] = await Promise.all([
    supabase.rpc("quiz_can_manage_client", { client_uuid: quiz.client_id }),
    supabase.rpc("quiz_can_assign_client", { client_uuid: quiz.client_id }),
  ]);

  if (manageResult.error || assignResult.error) {
    pageLoadError = manageResult.error?.message || assignResult.error?.message || "";
  } else {
    canManage = Boolean(manageResult.data);
    canAssign = Boolean(assignResult.data);
  }

  const { data: versionsData, error: versionsError } = await supabase
    .from("quiz_versions")
    .select("id,quiz_id,version_number,lifecycle_status,created_at,published_at")
    .eq("quiz_id", quiz.id)
    .order("version_number", { ascending: false });

  if (versionsError) {
    pageLoadError ||= versionsError.message;
  }
  const versions = (versionsData || []) as VersionRow[];

  const selectedVersionIdRaw = String(resolvedSearch?.version_id || "").trim();
  const selectedVersion =
    (selectedVersionIdRaw ? versions.find((version) => version.id === selectedVersionIdRaw) : null) ||
    versions.find((version) => version.lifecycle_status === "published") ||
    versions[0] ||
    null;
  const selectedVersionId = selectedVersion?.id || "";

  let questions: QuestionRow[] = [];
  let attempts: AttemptRow[] = [];
  let answers: AnswerRow[] = [];
  let users: UserRow[] = [];
  let assignableUsers: UserRow[] = [];

  if (!pageLoadError && selectedVersionId) {
    const [questionsResult, attemptsResult] = await Promise.all([
      supabase
        .from("quiz_version_questions")
        .select("id,quiz_version_id,position,prompt,question_type,option_snapshot_json")
        .eq("quiz_version_id", selectedVersionId)
        .order("position", { ascending: true }),
      supabase
        .from("quiz_attempts")
        .select("id,quiz_version_id,user_id,status,attempt_number,score_percent,passed,submitted_at,started_at")
        .eq("quiz_version_id", selectedVersionId)
        .in("status", ["submitted", "auto_scored", "partially_scored", "final_scored"])
        .order("submitted_at", { ascending: false, nullsFirst: false })
        .order("started_at", { ascending: false }),
    ]);

    if (questionsResult.error || attemptsResult.error) {
      pageLoadError = questionsResult.error?.message || attemptsResult.error?.message || "";
    } else {
      questions = (questionsResult.data || []) as QuestionRow[];
      attempts = (attemptsResult.data || []) as AttemptRow[];
    }
  }

  if (!pageLoadError && attempts.length > 0) {
    const attemptIds = attempts.map((attempt) => attempt.id);
    const userIds = Array.from(new Set(attempts.map((attempt) => attempt.user_id).filter(Boolean)));

    const [answersResult, usersResult] = await Promise.all([
      supabase
        .from("quiz_attempt_answers")
        .select("id,attempt_id,quiz_version_question_id,selected_option_ids,answer_text,answer_boolean")
        .in("attempt_id", attemptIds),
      supabase.from("users").select("id,full_name,email").in("id", userIds),
    ]);

    if (answersResult.error || usersResult.error) {
      pageLoadError = answersResult.error?.message || usersResult.error?.message || "";
    } else {
      answers = (answersResult.data || []) as AnswerRow[];
      users = (usersResult.data || []) as UserRow[];
    }
  }

  if (!pageLoadError && canAssign) {
    const clientUsersResult = await supabase
      .from("client_users")
      .select("user_id")
      .eq("client_id", quiz.client_id);
    if (!clientUsersResult.error) {
      const assignableUserIds = Array.from(
        new Set((clientUsersResult.data || []).map((row) => row.user_id).filter(Boolean))
      );
      if (assignableUserIds.length > 0) {
        const usersResult = await supabase
          .from("users")
          .select("id,full_name,email")
          .in("id", assignableUserIds)
          .order("full_name", { ascending: true });
        if (!usersResult.error) {
          assignableUsers = (usersResult.data || []) as UserRow[];
        }
      }
    }
  }

  const usersById = new Map(users.map((user) => [user.id, user.full_name || user.email || user.id]));
  const questionCountByVersionId = questions.reduce<Record<string, number>>((acc, question) => {
    acc[question.quiz_version_id] = (acc[question.quiz_version_id] || 0) + 1;
    return acc;
  }, {});
  const answersByAttemptId = new Map<string, Map<string, AnswerRow>>();
  for (const answer of answers) {
    const mapForAttempt = answersByAttemptId.get(answer.attempt_id) || new Map<string, AnswerRow>();
    mapForAttempt.set(answer.quiz_version_question_id, answer);
    answersByAttemptId.set(answer.attempt_id, mapForAttempt);
  }

  const questionBuilderVersions = versions
    .filter((version) => version.lifecycle_status === "draft")
    .map((version) => ({
      id: version.id,
      label: `v${version.version_number} (${version.lifecycle_status})`,
    }));

  const publishedVersions = versions.filter((version) => version.lifecycle_status === "published");

  async function addQuestionAction(formData: FormData) {
    "use server";
    const clientId = String(formData.get("client_id") || "").trim();
    const quizVersionId = String(formData.get("quiz_version_id") || "").trim();
    const prompt = String(formData.get("prompt") || "").trim();
    const uiQuestionType = String(formData.get("ui_question_type") || "free_text").trim();
    const points = Number.parseFloat(String(formData.get("points") || "1"));
    const questionType = uiQuestionType === "multi_select" ? "multi_select" : "short_answer";
    const manualReviewRequired = questionType === "short_answer";

    if (!uuidRegex.test(clientId) || !uuidRegex.test(quizVersionId)) {
      redirect(buildDetailPath({ quizId, clientId: quiz.client_id, error: "Invalid version selection" }));
    }
    if (!prompt) {
      redirect(buildDetailPath({ quizId, clientId: quiz.client_id, error: "Question text is required" }));
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
        redirect(
          buildDetailPath({
            quizId,
            clientId: quiz.client_id,
            versionId: quizVersionId,
            error: "Multi select needs at least 2 options",
          })
        );
      }
      if (correctOptionPositions.length === 0) {
        redirect(
          buildDetailPath({
            quizId,
            clientId: quiz.client_id,
            versionId: quizVersionId,
            error: "Select at least one correct option",
          })
        );
      }
    }

    const supabase = createSupabaseServerClient();
    const { error } = await supabase.rpc("quiz_add_version_question", {
      p_quiz_version_id: quizVersionId,
      p_prompt: prompt,
      p_question_type: questionType,
      p_points: Number.isFinite(points) ? points : 1,
      p_scoring_mode: "all_or_nothing",
      p_option_labels: optionLabels,
      p_correct_option_positions: correctOptionPositions,
      p_correct_boolean: null,
      p_accepted_text_answers: [],
      p_manual_review_required: manualReviewRequired,
    });

    revalidatePath("/quizzes/manage");
    revalidatePath(`/quizzes/manage/${quizId}`);
    revalidatePath("/quizzes");

    if (error) {
      redirect(
        buildDetailPath({
          quizId,
          clientId: quiz.client_id,
          versionId: quizVersionId,
          error: error.message,
        })
      );
    }
    redirect(
      buildDetailPath({
        quizId,
        clientId: quiz.client_id,
        versionId: quizVersionId,
        success: "Question added",
      })
    );
  }

  async function publishVersionAction(formData: FormData) {
    "use server";
    const quizVersionId = String(formData.get("quiz_version_id") || "").trim();
    if (!uuidRegex.test(quizVersionId)) {
      redirect(buildDetailPath({ quizId, clientId: quiz.client_id, error: "Invalid version id" }));
    }

    const supabase = createSupabaseServerClient();
    const { error } = await supabase.rpc("quiz_publish_version", {
      p_quiz_version_id: quizVersionId,
    });

    revalidatePath("/quizzes/manage");
    revalidatePath(`/quizzes/manage/${quizId}`);
    revalidatePath("/quizzes");

    if (error) {
      redirect(
        buildDetailPath({
          quizId,
          clientId: quiz.client_id,
          versionId: quizVersionId,
          error: error.message,
        })
      );
    }
    redirect(
      buildDetailPath({
        quizId,
        clientId: quiz.client_id,
        versionId: quizVersionId,
        success: "Version published",
      })
    );
  }

  async function assignVersionAction(formData: FormData) {
    "use server";
    const quizVersionId = String(formData.get("quiz_version_id") || "").trim();
    const userId = String(formData.get("assigned_user_id") || "").trim();
    const assignmentMode = String(formData.get("assignment_mode") || "required").trim();
    const availableFromRaw = String(formData.get("available_from") || "").trim();
    const dueAtRaw = String(formData.get("due_at") || "").trim();
    const expiresAtRaw = String(formData.get("expires_at") || "").trim();

    if (!uuidRegex.test(quizVersionId) || !uuidRegex.test(userId)) {
      redirect(buildDetailPath({ quizId, clientId: quiz.client_id, error: "Invalid assignment request" }));
    }

    const toIsoDate = (value: string) =>
      /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00.000Z` : null;

    const supabase = createSupabaseServerClient();
    const { error } = await supabase.rpc("quiz_assign_version_to_user", {
      p_quiz_version_id: quizVersionId,
      p_assigned_user_id: userId,
      p_assignment_mode: assignmentMode,
      p_available_from: toIsoDate(availableFromRaw),
      p_due_at: toIsoDate(dueAtRaw),
      p_expires_at: toIsoDate(expiresAtRaw),
    });

    revalidatePath("/quizzes/manage");
    revalidatePath(`/quizzes/manage/${quizId}`);
    revalidatePath("/quizzes");

    if (error) {
      redirect(
        buildDetailPath({
          quizId,
          clientId: quiz.client_id,
          versionId: quizVersionId,
          error: error.message,
        })
      );
    }
    redirect(
      buildDetailPath({
        quizId,
        clientId: quiz.client_id,
        versionId: quizVersionId,
        success: "Assignment saved",
      })
    );
  }

  return (
    <div className="space-y-5">
      <header className="space-y-2 rounded-2xl border border-slate-200 bg-white p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <Link
              href={buildManagePath(quiz.client_id)}
              className="text-sm font-medium text-slate-600 hover:text-slate-900"
            >
              &larr; Back to quiz list
            </Link>
            <h1 className="mt-2 text-2xl font-semibold text-slate-900">{quiz.title}</h1>
            <p className="text-sm text-slate-600">
              Status: {quiz.status} - Pass mark: {quiz.passing_score_percent}% - Max attempts: {quiz.max_attempts}
            </p>
          </div>
          <Link
            href={`/quizzes/review?client_id=${quiz.client_id}`}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Review queue
          </Link>
        </div>
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

      {versions.length > 0 ? (
        <section className="rounded-xl border border-slate-200 bg-white p-4">
          <form method="get" className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
            <input type="hidden" name="client_id" value={quiz.client_id} />
            <label className="text-sm text-slate-700">
              Version scope for submissions table
              <select
                name="version_id"
                defaultValue={selectedVersionId}
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-800"
              >
                {versions.map((version) => (
                  <option key={version.id} value={version.id}>
                    {`v${version.version_number} (${version.lifecycle_status})`}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="submit"
              className="self-end rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Switch version
            </button>
          </form>
        </section>
      ) : (
        <section className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-600">
          This quiz has no versions yet.
        </section>
      )}

      {canManage ? (
        <section className="rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="text-base font-semibold text-slate-900">Add question</h2>
          <p className="mt-1 text-sm text-slate-600">
            Keep it simple: choose Free text or Multi select.
          </p>
          {questionBuilderVersions.length > 0 ? (
            <SimpleQuestionBuilder
              action={addQuestionAction}
              clientId={quiz.client_id}
              versions={questionBuilderVersions}
            />
          ) : (
            <p className="mt-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
              No draft version available. Create a new draft version before adding questions.
            </p>
          )}
        </section>
      ) : (
        <section className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          You do not have manage access for this quiz.
        </section>
      )}

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="text-base font-semibold text-slate-900">Versions</h2>
        {versions.length === 0 ? (
          <p className="mt-3 text-sm text-slate-600">No versions found.</p>
        ) : (
          <div className="mt-3 space-y-2">
            {versions.map((version) => (
              <div
                key={version.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-slate-200 px-3 py-2"
              >
                <div>
                  <p className="text-sm font-semibold text-slate-900">
                    {`v${version.version_number} - ${version.lifecycle_status}`}
                  </p>
                  <p className="text-xs text-slate-600">
                    Questions: {questionCountByVersionId[version.id] || 0} - Published:{" "}
                    {formatDateTime(version.published_at)}
                  </p>
                </div>
                {canManage ? (
                  <form action={publishVersionAction}>
                    <input type="hidden" name="quiz_version_id" value={version.id} />
                    <button
                      type="submit"
                      disabled={(questionCountByVersionId[version.id] || 0) === 0}
                      className="rounded border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Publish
                    </button>
                  </form>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </section>

      {canAssign ? (
        <section className="rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="text-base font-semibold text-slate-900">Assign published version</h2>
          {publishedVersions.length === 0 ? (
            <p className="mt-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
              Publish a version first, then assignment appears here.
            </p>
          ) : (
            <form action={assignVersionAction} className="mt-3 grid gap-3 md:grid-cols-2">
              <label className="text-sm text-slate-700">
                Published version
                <select
                  name="quiz_version_id"
                  required
                  defaultValue={selectedVersionId || publishedVersions[0]?.id}
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-800"
                >
                  {publishedVersions.map((version) => (
                    <option key={version.id} value={version.id}>{`v${version.version_number}`}</option>
                  ))}
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

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="text-base font-semibold text-slate-900">Submissions</h2>
        <p className="mt-1 text-sm text-slate-600">
          Columns are quiz questions, rows are submitted attempts.
        </p>
        {selectedVersion == null ? (
          <p className="mt-3 text-sm text-slate-600">Select a version to view submissions.</p>
        ) : attempts.length === 0 ? (
          <p className="mt-3 text-sm text-slate-600">No submissions yet for this version.</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="min-w-full text-left text-xs">
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  <th className="px-2 py-2">Employee</th>
                  <th className="px-2 py-2">Attempt</th>
                  <th className="px-2 py-2">Status</th>
                  <th className="px-2 py-2">Score</th>
                  <th className="px-2 py-2">Submitted</th>
                  {questions.map((question) => (
                    <th key={question.id} className="min-w-[220px] px-2 py-2">
                      {`Q${question.position}: ${question.prompt}`}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {attempts.map((attempt) => {
                  const answersForAttempt = answersByAttemptId.get(attempt.id) || new Map<string, AnswerRow>();
                  return (
                    <tr key={attempt.id} className="border-t border-slate-200 align-top">
                      <td className="px-2 py-2 text-slate-700">
                        {usersById.get(attempt.user_id) || attempt.user_id}
                      </td>
                      <td className="px-2 py-2">
                        <Link
                          href={`/quizzes/attempts/${attempt.id}`}
                          className="font-semibold text-slate-700 hover:text-slate-900"
                        >
                          #{attempt.attempt_number}
                        </Link>
                      </td>
                      <td className="px-2 py-2 text-slate-700">{statusLabel(attempt.status)}</td>
                      <td className="px-2 py-2 text-slate-700">
                        {attempt.score_percent == null ? "Pending" : `${attempt.score_percent}%`}
                      </td>
                      <td className="px-2 py-2 text-slate-700">{formatDateTime(attempt.submitted_at)}</td>
                      {questions.map((question) => (
                        <td key={`${attempt.id}-${question.id}`} className="px-2 py-2 text-slate-700">
                          {formatSubmissionAnswer(
                            answersForAttempt.get(question.id) || null,
                            question
                          )}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
