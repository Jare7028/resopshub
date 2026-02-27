import Link from "next/link";
import { revalidatePath } from "next/cache";
import { notFound, redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type AttemptSearchParams = {
  error?: string;
  success?: string;
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
  started_at: string;
  submitted_at: string | null;
  total_points: number;
  earned_points: number;
  score_percent: number | null;
  passed: boolean | null;
  requires_manual_review: boolean;
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

type QuestionRow = {
  id: string;
  position: number;
  prompt: string;
  question_type: "single_choice" | "multi_select" | "true_false" | "short_answer" | "scenario";
  points: number;
  manual_review_required: boolean;
  option_snapshot_json: unknown;
};

type AnswerRow = {
  id: string;
  quiz_version_question_id: string;
  selected_option_ids: string[];
  answer_text: string | null;
  answer_boolean: boolean | null;
  auto_graded: boolean;
  needs_manual_review: boolean;
  is_correct: boolean | null;
  points_possible: number;
  points_earned: number;
  feedback_text: string | null;
  graded_at: string | null;
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
    const idRaw = String(row.id ?? row.option_id ?? row.value ?? "").trim();
    if (!uuidRegex.test(idRaw)) continue;
    const labelRaw = String(
      row.label ?? row.option_text ?? row.text ?? row.value ?? row.id ?? "Option"
    ).trim();
    parsed.push({
      id: idRaw,
      label: labelRaw || "Option",
    });
  }
  return parsed;
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

export default async function QuizAttemptPage({
  params,
  searchParams,
}: {
  params: Promise<{ attemptId: string }>;
  searchParams?: Promise<AttemptSearchParams>;
}) {
  const resolvedParams = await params;
  const resolvedSearch = await searchParams;
  const attemptId = String(resolvedParams.attemptId || "").trim();
  if (!uuidRegex.test(attemptId)) notFound();

  const errorMessage = String(resolvedSearch?.error || "").trim();
  const successMessage = String(resolvedSearch?.success || "").trim();

  const supabase = createSupabaseServerClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user?.id) redirect("/login");

  const { data: attemptData, error: attemptError } = await supabase
    .from("quiz_attempts")
    .select(
      "id,quiz_version_id,status,attempt_number,started_at,submitted_at,total_points,earned_points,score_percent,passed,requires_manual_review"
    )
    .eq("id", attemptId)
    .maybeSingle();

  if (attemptError) {
    redirect(`/quizzes/assigned?error=${encodeURIComponent(attemptError.message)}`);
  }
  if (!attemptData) {
    notFound();
  }

  const attempt = attemptData as AttemptRow;

  const { data: versionData, error: versionError } = await supabase
    .from("quiz_versions")
    .select("id,quiz_id,version_number,title")
    .eq("id", attempt.quiz_version_id)
    .maybeSingle();

  if (versionError || !versionData) {
    redirect(
      `/quizzes/assigned?error=${encodeURIComponent(versionError?.message || "Quiz not found")}`
    );
  }
  const version = versionData as VersionRow;

  const { data: quizData, error: quizError } = await supabase
    .from("quiz_definitions")
    .select("id,title,passing_score_percent")
    .eq("id", version.quiz_id)
    .maybeSingle();

  if (quizError || !quizData) {
    redirect(`/quizzes/assigned?error=${encodeURIComponent(quizError?.message || "Quiz not found")}`);
  }
  const quiz = quizData as QuizRow;

  const { data: questionsData, error: questionsError } = await supabase
    .from("quiz_version_questions")
    .select(
      "id,position,prompt,question_type,points,manual_review_required,option_snapshot_json"
    )
    .eq("quiz_version_id", version.id)
    .order("position", { ascending: true });

  if (questionsError) {
    redirect(`/quizzes/assigned?error=${encodeURIComponent(questionsError.message)}`);
  }
  const questions = (questionsData || []) as QuestionRow[];

  const { data: answersData, error: answersError } = await supabase
    .from("quiz_attempt_answers")
    .select(
      "id,quiz_version_question_id,selected_option_ids,answer_text,answer_boolean,auto_graded,needs_manual_review,is_correct,points_possible,points_earned,feedback_text,graded_at"
    )
    .eq("attempt_id", attempt.id);

  if (answersError) {
    redirect(`/quizzes/assigned?error=${encodeURIComponent(answersError.message)}`);
  }

  const answers = (answersData || []) as AnswerRow[];
  const answersByQuestionId = new Map(answers.map((row) => [row.quiz_version_question_id, row]));

  const isEditable = attempt.status === "in_progress";

  async function saveAnswerAction(formData: FormData) {
    "use server";
    const questionId = String(formData.get("quiz_version_question_id") || "").trim();
    if (!uuidRegex.test(questionId)) {
      redirect(`/quizzes/attempts/${attemptId}?error=Invalid question id`);
    }

    const selectedOptionIds = formData
      .getAll("selected_option_ids")
      .map((value) => String(value || "").trim())
      .filter((value) => uuidRegex.test(value));
    const answerTextRaw = String(formData.get("answer_text") || "");
    const answerText = answerTextRaw.trim();
    const answerBooleanRaw = String(formData.get("answer_boolean") || "")
      .trim()
      .toLowerCase();
    const answerBoolean =
      answerBooleanRaw === "true" ? true : answerBooleanRaw === "false" ? false : null;

    const supabase = createSupabaseServerClient();
    const { error } = await supabase.rpc("quiz_save_attempt_answer", {
      p_attempt_id: attemptId,
      p_quiz_version_question_id: questionId,
      p_selected_option_ids: selectedOptionIds,
      p_answer_text: answerText || null,
      p_answer_boolean: answerBoolean,
    });

    if (error) {
      redirect(`/quizzes/attempts/${attemptId}?error=${encodeURIComponent(error.message)}`);
    }

    revalidatePath(`/quizzes/attempts/${attemptId}`);
    redirect(`/quizzes/attempts/${attemptId}?success=${encodeURIComponent("Answer saved")}`);
  }

  async function submitAttemptAction() {
    "use server";
    const supabase = createSupabaseServerClient();
    const { data, error } = await supabase.rpc("quiz_submit_attempt", {
      p_attempt_id: attemptId,
    });

    if (error) {
      redirect(`/quizzes/attempts/${attemptId}?error=${encodeURIComponent(error.message)}`);
    }

    const status = String((data as { status?: string } | null)?.status || "submitted");
    revalidatePath(`/quizzes/attempts/${attemptId}`);
    revalidatePath("/quizzes/assigned");
    redirect(
      `/quizzes/attempts/${attemptId}?success=${encodeURIComponent(`Attempt ${status.replace(/_/g, " ")}`)}`
    );
  }

  return (
    <div className="space-y-4">
      <header className="space-y-2">
        <Link href="/quizzes/assigned" className="text-sm font-medium text-slate-600 hover:text-slate-900">
          &larr; Back to quizzes
        </Link>
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">{quiz.title}</h1>
          <p className="text-sm text-slate-600">
            {version.title} - Attempt #{attempt.attempt_number}
          </p>
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

      <section className="grid gap-2 rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-700 sm:grid-cols-3">
        <p>
          <span className="font-semibold text-slate-900">Status:</span> {statusLabel(attempt.status)}
        </p>
        <p>
          <span className="font-semibold text-slate-900">Started:</span>{" "}
          {formatDateTime(attempt.started_at)}
        </p>
        <p>
          <span className="font-semibold text-slate-900">Submitted:</span>{" "}
          {formatDateTime(attempt.submitted_at)}
        </p>
        <p>
          <span className="font-semibold text-slate-900">Score:</span>{" "}
          {attempt.score_percent == null ? "Pending" : `${attempt.score_percent}%`}
        </p>
        <p>
          <span className="font-semibold text-slate-900">Result:</span>{" "}
          {attempt.passed == null
            ? attempt.requires_manual_review
              ? "Pending review"
              : "Pending"
            : attempt.passed
              ? "Pass"
              : "Fail"}
        </p>
        <p>
          <span className="font-semibold text-slate-900">Pass mark:</span>{" "}
          {quiz.passing_score_percent}%
        </p>
      </section>

      <section className="space-y-3">
        {questions.length === 0 ? (
          <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-600">
            No questions are configured for this quiz.
          </div>
        ) : (
          questions.map((question) => {
            const answer = answersByQuestionId.get(question.id) || null;
            const selected = new Set((answer?.selected_option_ids || []).map((value) => String(value)));
            const options = parseOptionsSnapshot(question.option_snapshot_json);
            const textValue = answer?.answer_text || "";
            const boolValue = answer?.answer_boolean;

            return (
              <article key={question.id} className="rounded-xl border border-slate-200 bg-white p-4">
                <div className="mb-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Question {question.position} - {question.points} point{question.points === 1 ? "" : "s"}
                  </p>
                  <h2 className="mt-1 text-base font-medium text-slate-900">{question.prompt}</h2>
                </div>

                <form action={saveAnswerAction} className="space-y-3">
                  <input type="hidden" name="quiz_version_question_id" value={question.id} />

                  {question.question_type === "single_choice" ? (
                    <div className="space-y-2">
                      {options.map((option) => (
                        <label key={option.id} className="flex items-center gap-2 text-sm text-slate-700">
                          <input
                            type="radio"
                            name="selected_option_ids"
                            value={option.id}
                            defaultChecked={selected.has(option.id)}
                            disabled={!isEditable}
                          />
                          <span>{option.label}</span>
                        </label>
                      ))}
                    </div>
                  ) : null}

                  {question.question_type === "multi_select" ? (
                    <div className="space-y-2">
                      {options.map((option) => (
                        <label key={option.id} className="flex items-center gap-2 text-sm text-slate-700">
                          <input
                            type="checkbox"
                            name="selected_option_ids"
                            value={option.id}
                            defaultChecked={selected.has(option.id)}
                            disabled={!isEditable}
                          />
                          <span>{option.label}</span>
                        </label>
                      ))}
                    </div>
                  ) : null}

                  {question.question_type === "true_false" ? (
                    <div className="flex flex-wrap gap-4">
                      <label className="flex items-center gap-2 text-sm text-slate-700">
                        <input
                          type="radio"
                          name="answer_boolean"
                          value="true"
                          defaultChecked={boolValue === true}
                          disabled={!isEditable}
                        />
                        <span>True</span>
                      </label>
                      <label className="flex items-center gap-2 text-sm text-slate-700">
                        <input
                          type="radio"
                          name="answer_boolean"
                          value="false"
                          defaultChecked={boolValue === false}
                          disabled={!isEditable}
                        />
                        <span>False</span>
                      </label>
                    </div>
                  ) : null}

                  {(question.question_type === "short_answer" || question.question_type === "scenario") ? (
                    <textarea
                      name="answer_text"
                      defaultValue={textValue}
                      rows={question.question_type === "scenario" ? 5 : 3}
                      disabled={!isEditable}
                      className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-800 disabled:bg-slate-100"
                      placeholder={
                        question.question_type === "scenario"
                          ? "Enter your scenario response..."
                          : "Enter your answer..."
                      }
                    />
                  ) : null}

                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="submit"
                      disabled={!isEditable}
                      className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      Save answer
                    </button>
                    {answer ? (
                      <span className="text-xs text-slate-500">
                        Scored: {answer.points_earned}/{answer.points_possible}
                        {answer.needs_manual_review ? " - Pending manual review" : ""}
                      </span>
                    ) : null}
                  </div>
                </form>

                {answer?.feedback_text ? (
                  <p className="mt-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
                    Feedback: {answer.feedback_text}
                  </p>
                ) : null}
              </article>
            );
          })
        )}
      </section>

      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <form action={submitAttemptAction} className="flex flex-wrap items-center gap-2">
          <button
            type="submit"
            disabled={!isEditable}
            className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-400"
          >
            Submit attempt
          </button>
          <p className="text-xs text-slate-500">
            Submission auto-marks objective questions and flags manual review items.
          </p>
        </form>
      </div>
    </div>
  );
}
