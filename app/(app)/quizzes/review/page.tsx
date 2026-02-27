import Link from "next/link";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type ReviewSearchParams = {
  error?: string;
  success?: string;
};

type TaskRow = {
  id: string;
  attempt_answer_id: string;
  status: "pending" | "in_review" | "completed";
  created_at: string;
};

type AnswerRow = {
  id: string;
  attempt_id: string;
  quiz_version_question_id: string;
  selected_option_ids: string[];
  answer_text: string | null;
  answer_boolean: boolean | null;
  points_possible: number;
  points_earned: number;
  needs_manual_review: boolean;
  feedback_text: string | null;
};

type AttemptRow = {
  id: string;
  quiz_version_id: string;
  user_id: string;
  attempt_number: number;
  status: string;
  score_percent: number | null;
  requires_manual_review: boolean;
};

type QuestionRow = {
  id: string;
  position: number;
  prompt: string;
  question_type: "single_choice" | "multi_select" | "true_false" | "short_answer" | "scenario";
  option_snapshot_json: unknown;
};

type VersionRow = {
  id: string;
  quiz_id: string;
  version_number: number;
  title: string;
};

type QuizRow = {
  id: string;
  title: string;
  passing_score_percent: number;
};

type UserRow = {
  id: string;
  full_name: string | null;
  email: string | null;
};

type OptionItem = {
  id: string;
  label: string;
};

function parseOptionsSnapshot(value: unknown): OptionItem[] {
  if (!Array.isArray(value)) return [];
  const parsed: OptionItem[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") continue;
    const row = entry as Record<string, unknown>;
    const idRaw = String(row.id ?? "").trim();
    if (!uuidRegex.test(idRaw)) continue;
    const labelRaw = String(row.label ?? row.option_text ?? row.value ?? idRaw).trim();
    parsed.push({ id: idRaw, label: labelRaw || idRaw });
  }
  return parsed;
}

function buildReviewPath(args: { error?: string; success?: string }) {
  const params = new URLSearchParams();
  if (args.error) params.set("error", args.error);
  if (args.success) params.set("success", args.success);
  const query = params.toString();
  return query ? `/quizzes/review?${query}` : "/quizzes/review";
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

function formatAnswerPreview(answer: AnswerRow, question: QuestionRow | null) {
  if (!question) return "Question unavailable";
  if (question.question_type === "true_false") {
    if (answer.answer_boolean === true) return "True";
    if (answer.answer_boolean === false) return "False";
  }
  if (question.question_type === "single_choice" || question.question_type === "multi_select") {
    const optionsById = new Map(parseOptionsSnapshot(question.option_snapshot_json).map((opt) => [opt.id, opt.label]));
    const labels = (answer.selected_option_ids || []).map((id) => optionsById.get(id) || id);
    return labels.length ? labels.join(", ") : "(no option selected)";
  }
  if (answer.answer_text && answer.answer_text.trim()) return answer.answer_text.trim();
  return "(no answer provided)";
}

export default async function QuizReviewPage({
  searchParams,
}: {
  searchParams?: Promise<ReviewSearchParams>;
}) {
  const resolvedSearch = await searchParams;
  const errorMessage = String(resolvedSearch?.error || "").trim();
  const successMessage = String(resolvedSearch?.success || "").trim();

  const supabase = createSupabaseServerClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user?.id) redirect("/login");

  let canReview = false;
  let pageLoadError = "";
  const reviewResult = await supabase.rpc("can_edit_page", { p_page_key: "quizzes" });
  if (reviewResult.error) {
    pageLoadError = reviewResult.error.message;
  } else {
    canReview = Boolean(reviewResult.data);
  }

  let tasks: TaskRow[] = [];
  let answers: AnswerRow[] = [];
  let attempts: AttemptRow[] = [];
  let questions: QuestionRow[] = [];
  let versions: VersionRow[] = [];
  let quizzes: QuizRow[] = [];
  let users: UserRow[] = [];

  if (!pageLoadError && canReview) {
    const tasksResult = await supabase
      .from("quiz_manual_review_tasks")
      .select("id,attempt_answer_id,status,created_at")
      .neq("status", "completed")
      .order("created_at", { ascending: true });
    if (tasksResult.error) {
      pageLoadError = tasksResult.error.message;
    } else {
      tasks = (tasksResult.data || []) as TaskRow[];
    }
  }

  if (!pageLoadError && tasks.length > 0) {
    const answerIds = Array.from(new Set(tasks.map((task) => task.attempt_answer_id)));
    const answersResult = await supabase
      .from("quiz_attempt_answers")
      .select(
        "id,attempt_id,quiz_version_question_id,selected_option_ids,answer_text,answer_boolean,points_possible,points_earned,needs_manual_review,feedback_text"
      )
      .in("id", answerIds);
    if (answersResult.error) {
      pageLoadError = answersResult.error.message;
    } else {
      answers = (answersResult.data || []) as AnswerRow[];
    }
  }

  if (!pageLoadError && answers.length > 0) {
    const attemptIds = Array.from(new Set(answers.map((answer) => answer.attempt_id)));
    const questionIds = Array.from(new Set(answers.map((answer) => answer.quiz_version_question_id)));

    const [attemptsResult, questionsResult] = await Promise.all([
      supabase
        .from("quiz_attempts")
        .select("id,quiz_version_id,user_id,attempt_number,status,score_percent,requires_manual_review")
        .in("id", attemptIds),
      supabase
        .from("quiz_version_questions")
        .select("id,position,prompt,question_type,option_snapshot_json")
        .in("id", questionIds),
    ]);

    if (attemptsResult.error || questionsResult.error) {
      pageLoadError = attemptsResult.error?.message || questionsResult.error?.message || "";
    } else {
      attempts = (attemptsResult.data || []) as AttemptRow[];
      questions = (questionsResult.data || []) as QuestionRow[];
    }
  }

  if (!pageLoadError && attempts.length > 0) {
    const versionIds = Array.from(new Set(attempts.map((attempt) => attempt.quiz_version_id)));
    const versionsResult = await supabase
      .from("quiz_versions")
      .select("id,quiz_id,version_number,title")
      .in("id", versionIds);
    if (versionsResult.error) {
      pageLoadError = versionsResult.error.message;
    } else {
      versions = (versionsResult.data || []) as VersionRow[];
    }
  }

  if (!pageLoadError && versions.length > 0) {
    const quizIds = Array.from(new Set(versions.map((version) => version.quiz_id)));
    const quizzesResult = await supabase
      .from("quiz_definitions")
      .select("id,title,passing_score_percent")
      .in("id", quizIds);
    if (quizzesResult.error) {
      pageLoadError = quizzesResult.error.message;
    } else {
      quizzes = (quizzesResult.data || []) as QuizRow[];
    }
  }

  if (!pageLoadError && attempts.length > 0) {
    const userIds = Array.from(new Set(attempts.map((attempt) => attempt.user_id)));
    const usersResult = await supabase
      .from("users")
      .select("id,full_name,email")
      .in("id", userIds);
    if (usersResult.error) {
      pageLoadError = usersResult.error.message;
    } else {
      users = (usersResult.data || []) as UserRow[];
    }
  }

  const answersById = new Map(answers.map((answer) => [answer.id, answer]));
  const attemptsById = new Map(attempts.map((attempt) => [attempt.id, attempt]));
  const questionsById = new Map(questions.map((question) => [question.id, question]));
  const versionsById = new Map(versions.map((version) => [version.id, version]));
  const quizzesById = new Map(quizzes.map((quiz) => [quiz.id, quiz]));
  const usersById = new Map(users.map((user) => [user.id, user.full_name || user.email || user.id]));

  const filteredTasks = tasks.filter((task) => {
    const answer = answersById.get(task.attempt_answer_id);
    if (!answer) return false;
    const attempt = attemptsById.get(answer.attempt_id);
    if (!attempt) return false;
    const version = versionsById.get(attempt.quiz_version_id);
    if (!version) return false;
    const quiz = quizzesById.get(version.quiz_id);
    return Boolean(quiz);
  });

  const tasksByAttemptId = filteredTasks.reduce<Record<string, TaskRow[]>>((acc, task) => {
    const answer = answersById.get(task.attempt_answer_id);
    if (!answer) return acc;
    acc[answer.attempt_id] ||= [];
    acc[answer.attempt_id].push(task);
    return acc;
  }, {});

  const orderedAttemptIds = Object.keys(tasksByAttemptId).sort((leftId, rightId) => {
    const leftTasks = tasksByAttemptId[leftId] || [];
    const rightTasks = tasksByAttemptId[rightId] || [];
    const leftDate = leftTasks[0]?.created_at || "";
    const rightDate = rightTasks[0]?.created_at || "";
    return new Date(leftDate).getTime() - new Date(rightDate).getTime();
  });
  const pendingTaskCount = filteredTasks.length;
  const pendingAttemptCount = orderedAttemptIds.length;

  async function reviewAnswerAction(formData: FormData) {
    "use server";
    const attemptAnswerId = String(formData.get("attempt_answer_id") || "").trim();
    const pointsRaw = String(formData.get("points_earned") || "").trim();
    const feedbackText = String(formData.get("feedback_text") || "").trim();
    const markCorrectRaw = String(formData.get("mark_correct") || "").trim();

    if (!uuidRegex.test(attemptAnswerId)) {
      redirect(buildReviewPath({ error: "Invalid attempt answer id" }));
    }

    const pointsEarned = Number.parseFloat(pointsRaw);
    if (!Number.isFinite(pointsEarned) || pointsEarned < 0) {
      redirect(buildReviewPath({ error: "points_earned must be a non-negative number" }));
    }

    const markCorrect =
      markCorrectRaw === "true" ? true : markCorrectRaw === "false" ? false : null;

    const supabase = createSupabaseServerClient();
    const { error } = await supabase.rpc("quiz_review_attempt_answer", {
      p_attempt_answer_id: attemptAnswerId,
      p_points_earned: pointsEarned,
      p_feedback_text: feedbackText || null,
      p_mark_correct: markCorrect,
    });

    revalidatePath("/quizzes/review");
    revalidatePath("/quizzes");
    revalidatePath("/quizzes/assigned");

    if (error) {
      redirect(buildReviewPath({ error: error.message }));
    }
    redirect(buildReviewPath({ success: "Answer reviewed" }));
  }

  async function finalizeAttemptAction(formData: FormData) {
    "use server";
    const attemptId = String(formData.get("attempt_id") || "").trim();
    if (!uuidRegex.test(attemptId)) {
      redirect(buildReviewPath({ error: "Invalid attempt id" }));
    }

    const supabase = createSupabaseServerClient();
    const { error } = await supabase.rpc("quiz_finalize_attempt_scoring", {
      p_attempt_id: attemptId,
    });

    revalidatePath("/quizzes/review");
    revalidatePath("/quizzes");
    revalidatePath("/quizzes/assigned");
    revalidatePath(`/quizzes/attempts/${attemptId}`);

    if (error) {
      redirect(buildReviewPath({ error: error.message }));
    }
    redirect(buildReviewPath({ success: "Attempt finalized" }));
  }

  return (
    <div className="space-y-5">
      <header className="space-y-2 rounded-2xl border border-slate-200 bg-white p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-2xl font-semibold text-slate-900">Quiz Review Queue</h1>
          <div className="flex flex-wrap gap-2">
            <Link
              href="/quizzes/assigned"
              className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Employee view
            </Link>
            <Link
              href="/quizzes"
              className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Manage quizzes
            </Link>
          </div>
        </div>
        <p className="text-sm text-slate-600">
          Review only the items that need human grading, then finalize attempts when complete.
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

      {canReview ? (
        <section className="grid gap-3 md:grid-cols-3">
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Pending Tasks</p>
            <p className="mt-2 text-2xl font-semibold text-slate-900">{pendingTaskCount}</p>
            <p className="text-xs text-slate-600">Answers needing manual scoring</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Open Attempts</p>
            <p className="mt-2 text-2xl font-semibold text-slate-900">{pendingAttemptCount}</p>
            <p className="text-xs text-slate-600">Attempts blocked by pending tasks</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Queue Access</p>
            <p className="mt-2 text-sm font-semibold text-slate-900">Enabled</p>
            <p className="text-xs text-slate-600">You can score and finalize attempts</p>
          </div>
        </section>
      ) : null}

      {!canReview ? (
        <section className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          You do not have review access for quizzes.
        </section>
      ) : null}

      {canReview ? (
        <section className="space-y-4">
          {orderedAttemptIds.length === 0 ? (
            <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-600">
              No pending manual review items.
            </div>
          ) : (
            orderedAttemptIds.map((attemptId) => {
              const attempt = attemptsById.get(attemptId);
              if (!attempt) return null;
              const version = versionsById.get(attempt.quiz_version_id);
              const quiz = version ? quizzesById.get(version.quiz_id) : null;
              const taskRows = tasksByAttemptId[attemptId] || [];
              return (
                <article key={attemptId} className="rounded-xl border border-slate-200 bg-white p-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <h2 className="text-base font-semibold text-slate-900">
                        {quiz?.title || "Quiz"} - Attempt #{attempt.attempt_number}
                      </h2>
                      <p className="text-xs text-slate-600">
                        Employee: {usersById.get(attempt.user_id) || attempt.user_id} - Status:{" "}
                        {attempt.status} - Score:{" "}
                        {attempt.score_percent == null ? "Pending" : `${attempt.score_percent}%`}
                      </p>
                    </div>
                    <form action={finalizeAttemptAction}>
                      <input type="hidden" name="attempt_id" value={attempt.id} />
                      <button
                        type="submit"
                        className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
                      >
                        Finalize attempt
                      </button>
                    </form>
                  </div>

                  <div className="mt-3 space-y-3">
                    {taskRows.map((task) => {
                      const answer = answersById.get(task.attempt_answer_id);
                      if (!answer) return null;
                      const question = questionsById.get(answer.quiz_version_question_id) || null;
                      const preview = formatAnswerPreview(answer, question);
                      return (
                        <div key={task.id} className="rounded-lg border border-slate-200 p-3">
                          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                            Q{question?.position ?? "?"} - {question?.question_type || "question"} - Opened{" "}
                            {formatDateTime(task.created_at)}
                          </p>
                          <p className="mt-1 text-sm font-medium text-slate-900">
                            {question?.prompt || "Question not found"}
                          </p>
                          <p className="mt-2 whitespace-pre-wrap rounded-md border border-slate-100 bg-slate-50 px-3 py-2 text-sm text-slate-700">
                            {preview}
                          </p>
                          <form action={reviewAnswerAction} className="mt-3 grid gap-2 md:grid-cols-3">
                            <input type="hidden" name="attempt_answer_id" value={answer.id} />
                            <label className="text-xs text-slate-600">
                              Points Earned (max {answer.points_possible})
                              <input
                                name="points_earned"
                                type="number"
                                min={0}
                                max={answer.points_possible}
                                step="0.25"
                                defaultValue={answer.points_earned}
                                className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm text-slate-800"
                              />
                            </label>
                            <label className="text-xs text-slate-600">
                              Mark Correct
                              <select
                                name="mark_correct"
                                defaultValue=""
                                className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm text-slate-800"
                              >
                                <option value="">Auto from points</option>
                                <option value="true">Correct</option>
                                <option value="false">Incorrect</option>
                              </select>
                            </label>
                            <label className="text-xs text-slate-600 md:col-span-1">
                              Feedback
                              <input
                                name="feedback_text"
                                defaultValue={answer.feedback_text || ""}
                                className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm text-slate-800"
                                placeholder="Optional reviewer note"
                              />
                            </label>
                            <div className="md:col-span-3">
                              <button
                                type="submit"
                                className="rounded-md bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-800"
                              >
                                Save Review
                              </button>
                            </div>
                          </form>
                        </div>
                      );
                    })}
                  </div>
                </article>
              );
            })
          )}
        </section>
      ) : null}
    </div>
  );
}
