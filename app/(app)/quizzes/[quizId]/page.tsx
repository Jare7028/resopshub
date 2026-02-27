import Link from "next/link";
import { revalidatePath } from "next/cache";
import { notFound, redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import SimpleQuestionBuilder from "../_components/SimpleQuestionBuilder";

const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type ManageDetailSearchParams = {
  return_to?: string;
  tab?: string;
  version_id?: string;
  submission_result?: string;
  error?: string;
  success?: string;
};

type QuizDetailTabKey = "submissions" | "configure" | "assignments";

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
  answer_key_snapshot_json: unknown;
  scoring_mode: "all_or_nothing" | "partial_credit";
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

type EditableQuestionOption = {
  id: string;
  label: string;
  position: number;
  isCorrect: boolean;
};

function normalizeQuizDetailTabKey(value: string | undefined): QuizDetailTabKey {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  if (normalized === "configure" || normalized === "assignments") return normalized;
  return "submissions";
}

function buildQuizzesPath(clientId?: string) {
  return clientId ? `/quizzes?client_id=${clientId}` : "/quizzes";
}

function buildDetailPath(args: {
  quizId: string;
  tab: QuizDetailTabKey;
  returnTo: string;
  versionId?: string;
  submissionResult?: string;
  error?: string;
  success?: string;
}) {
  const params = new URLSearchParams();
  params.set("return_to", args.returnTo);
  params.set("tab", args.tab);
  if (args.submissionResult) params.set("submission_result", args.submissionResult);
  if (args.error) params.set("error", args.error);
  if (args.success) params.set("success", args.success);
  return `/quizzes/${args.quizId}?${params.toString()}`;
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

function quizStatusBadgeClass(status: QuizRow["status"]) {
  if (status === "published") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (status === "draft") return "border-amber-200 bg-amber-50 text-amber-700";
  return "border-slate-200 bg-slate-50 text-slate-600";
}

function versionStatusBadgeClass(status: VersionRow["lifecycle_status"]) {
  if (status === "published") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (status === "draft") return "border-amber-200 bg-amber-50 text-amber-700";
  return "border-slate-200 bg-slate-50 text-slate-600";
}

function attemptStatusBadgeClass(status: AttemptRow["status"]) {
  if (status === "final_scored" || status === "auto_scored") {
    return "border-emerald-200 bg-emerald-50 text-emerald-700";
  }
  if (status === "partially_scored" || status === "submitted") {
    return "border-amber-200 bg-amber-50 text-amber-700";
  }
  return "border-slate-200 bg-slate-50 text-slate-600";
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

function parseTextArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const textValues = value
    .map((entry) => String(entry || "").trim())
    .filter((entry) => Boolean(entry));
  return Array.from(new Set(textValues));
}

function parseCorrectOptionIds(value: unknown): string[] {
  if (!value || typeof value !== "object") return [];
  const entry = value as Record<string, unknown>;
  const rawIds = entry.correct_option_ids;
  if (!Array.isArray(rawIds)) return [];
  const normalized = rawIds
    .map((optionId) => String(optionId || "").trim())
    .filter(uuidRegex.test, uuidRegex);
  return Array.from(new Set(normalized));
}

function parseScoringMode(value: string) {
  if (value === "partial_credit") return "partial_credit";
  return "all_or_nothing";
}

function questionTypeLabel(type: QuestionRow["question_type"]) {
  if (type === "multi_select" || type === "single_choice") return "Multi select";
  if (type === "short_answer" || type === "scenario") return "Free text";
  if (type === "true_false") return "True/False";
  return "Question";
}

function questionSupportsSimpleEditing(type: QuestionRow["question_type"]) {
  return type === "short_answer" || type === "multi_select" || type === "single_choice";
}

function toUiQuestionType(type: QuestionRow["question_type"]) {
  if (type === "multi_select" || type === "single_choice") return "multi_select";
  return "free_text";
}

function buildEditableOptionRows(question: QuestionRow): EditableQuestionOption[] {
  const correctOptionIds = new Set(parseCorrectOptionIds(question.answer_key_snapshot_json));
  const rawOptions = parseOptionSnapshot(question.option_snapshot_json).map((option, index) => ({
    id: option.id,
    label: option.label,
    position: index + 1,
    isCorrect: correctOptionIds.has(option.id),
  }));
  if (rawOptions.length >= 2) return rawOptions;

  const fallbackOptions = [...rawOptions];
  if (fallbackOptions.length === 0) {
    fallbackOptions.push({ id: crypto.randomUUID(), label: "", position: 1, isCorrect: false });
  }
  if (fallbackOptions.length === 1) {
    fallbackOptions.push({ id: crypto.randomUUID(), label: "", position: 2, isCorrect: false });
  }
  return fallbackOptions;
}

function buildQuestionPositionOptions(totalQuestions: number) {
  const normalized = Number.isFinite(totalQuestions) ? Math.max(0, Math.floor(totalQuestions)) : 0;
  return Array.from({ length: normalized + 1 }, (_, index) => index + 1);
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
  const activeTab = normalizeQuizDetailTabKey(resolvedSearch?.tab);

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
    redirect(`/quizzes?error=${encodeURIComponent(quizError.message)}`);
  }
  if (!quizData) {
    notFound();
  }
  const quiz = quizData as QuizRow;
  const returnToRaw = String(resolvedSearch?.return_to || "").trim();
  const returnTo = returnToRaw.startsWith("/quizzes") ? returnToRaw : buildQuizzesPath(quiz.client_id);

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
  const submissionScopeRaw = String(resolvedSearch?.submission_result || "all")
    .trim()
    .toLowerCase();
  const submissionScope: "all" | "passed" | "failed" | "pending" =
    submissionScopeRaw === "passed" ||
    submissionScopeRaw === "failed" ||
    submissionScopeRaw === "pending"
      ? submissionScopeRaw
      : "all";

  let questions: QuestionRow[] = [];
  let attempts: AttemptRow[] = [];
  let answers: AnswerRow[] = [];
  let users: UserRow[] = [];
  let assignableUsers: UserRow[] = [];

  const questionVersionIds = versions.map((version) => version.id);
  if (!pageLoadError && versions.length > 0) {
    const questionsResultPromise = supabase
      .from("quiz_version_questions")
      .select(
        "id,quiz_version_id,position,prompt,question_type,option_snapshot_json,answer_key_snapshot_json,scoring_mode"
      )
      .in("quiz_version_id", questionVersionIds)
      .order("quiz_version_id", { ascending: false })
      .order("position", { ascending: true });

    const attemptsResultPromise = selectedVersionId
      ? supabase
          .from("quiz_attempts")
          .select("id,quiz_version_id,user_id,status,attempt_number,score_percent,passed,submitted_at,started_at")
          .eq("quiz_version_id", selectedVersionId)
          .in("status", ["submitted", "auto_scored", "partially_scored", "final_scored"])
          .order("submitted_at", { ascending: false, nullsFirst: false })
          .order("started_at", { ascending: false })
      : Promise.resolve({ data: [], error: null } as const);

    const [questionsResult, attemptsResult] = await Promise.all([questionsResultPromise, attemptsResultPromise]);

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
    const usersResult = await supabase
      .from("users")
      .select("id,full_name,email")
      .order("full_name", { ascending: true });
    if (!usersResult.error) {
      assignableUsers = (usersResult.data || []) as UserRow[];
    }
  }

  const usersById = new Map(users.map((user) => [user.id, user.full_name || user.email || user.id]));
  const questionCountByVersionId = questions.reduce<Record<string, number>>((acc, question) => {
    acc[question.quiz_version_id] = (acc[question.quiz_version_id] || 0) + 1;
    return acc;
  }, {});
  const questionsByVersionId = questions.reduce<Record<string, QuestionRow[]>>((acc, question) => {
    acc[question.quiz_version_id] ||= [];
    acc[question.quiz_version_id].push(question);
    return acc;
  }, {});
  const draftVersionIds = new Set(
    versions.filter((version) => version.lifecycle_status === "draft").map((version) => version.id)
  );
  const answersByAttemptId = new Map<string, Map<string, AnswerRow>>();
  for (const answer of answers) {
    const mapForAttempt = answersByAttemptId.get(answer.attempt_id) || new Map<string, AnswerRow>();
    mapForAttempt.set(answer.quiz_version_question_id, answer);
    answersByAttemptId.set(answer.attempt_id, mapForAttempt);
  }

  const draftVersions = versions.filter((version) => version.lifecycle_status === "draft");
  const defaultDraftVersion = draftVersions[0] || null;
  const defaultDraftVersionId = defaultDraftVersion?.id || "";

  const publishedVersions = versions.filter((version) => version.lifecycle_status === "published");
  const defaultPublishedVersion = publishedVersions[0] || null;
  const defaultPublishedVersionId = defaultPublishedVersion?.id || "";
  const submissionCounts = {
    all: attempts.length,
    passed: attempts.filter((attempt) => attempt.passed === true).length,
    failed: attempts.filter((attempt) => attempt.passed === false).length,
    pending: attempts.filter((attempt) => attempt.passed == null).length,
  };
  const filteredAttempts = attempts.filter((attempt) => {
    if (submissionScope === "passed") return attempt.passed === true;
    if (submissionScope === "failed") return attempt.passed === false;
    if (submissionScope === "pending") return attempt.passed == null;
    return true;
  });
  const tabUrls: Record<QuizDetailTabKey, string> = {
    submissions: buildDetailPath({
      quizId,
      tab: "submissions",
      returnTo,
      versionId: selectedVersionId,
      submissionResult: submissionScope,
    }),
    configure: buildDetailPath({
      quizId,
      tab: "configure",
      returnTo,
      versionId: selectedVersionId,
      submissionResult: submissionScope,
    }),
    assignments: buildDetailPath({
      quizId,
      tab: "assignments",
      returnTo,
      versionId: selectedVersionId,
      submissionResult: submissionScope,
    }),
  };

  async function updateQuestionAction(formData: FormData) {
    "use server";
    const clientId = String(formData.get("client_id") || "").trim();
    const questionId = String(formData.get("quiz_question_id") || "").trim();
    const quizVersionId = String(formData.get("quiz_version_id") || "").trim();
    const prompt = String(formData.get("prompt") || "").trim();
    const requestedPosition = Number.parseInt(String(formData.get("position") || "").trim(), 10);
    const uiQuestionType = String(formData.get("ui_question_type") || "free_text").trim();
    const requestedQuestionType = uiQuestionType === "multi_select" ? "multi_select" : "short_answer";

    if (!uuidRegex.test(clientId) || !uuidRegex.test(questionId) || !uuidRegex.test(quizVersionId)) {
      redirect(
        buildDetailPath({
          quizId,
          tab: "configure",
          returnTo,
          versionId: selectedVersionId,
          submissionResult: submissionScope,
          error: "Invalid question update request",
        })
      );
    }

    if (!prompt) {
      redirect(
        buildDetailPath({
          quizId,
          tab: "configure",
          returnTo,
          versionId: selectedVersionId,
          submissionResult: submissionScope,
          error: "Question text is required",
        })
      );
    }
    if (!Number.isInteger(requestedPosition) || requestedPosition < 1) {
      redirect(
        buildDetailPath({
          quizId,
          tab: "configure",
          returnTo,
          versionId: selectedVersionId,
          submissionResult: submissionScope,
          error: "Invalid question position",
        })
      );
    }

    const supabase = createSupabaseServerClient();
    const questionResult = await supabase
      .from("quiz_version_questions")
      .select("id,quiz_version_id,position,question_type,scoring_mode,answer_key_snapshot_json")
      .eq("id", questionId)
      .maybeSingle();

    if (questionResult.error || !questionResult.data) {
      redirect(
        buildDetailPath({
          quizId,
          tab: "configure",
          returnTo,
          versionId: selectedVersionId,
          submissionResult: submissionScope,
          error: questionResult.error?.message || "Question not found",
        })
      );
    }
    if (questionResult.data.quiz_version_id !== quizVersionId) {
      redirect(
        buildDetailPath({
          quizId,
          tab: "configure",
          returnTo,
          versionId: selectedVersionId,
          submissionResult: submissionScope,
          error: "Question mismatch",
        })
      );
    }

    const versionResult = await supabase
      .from("quiz_versions")
      .select("id,quiz_id,lifecycle_status")
      .eq("id", quizVersionId)
      .maybeSingle();
    if (versionResult.error || !versionResult.data) {
      redirect(
        buildDetailPath({
          quizId,
          tab: "configure",
          returnTo,
          versionId: selectedVersionId,
          submissionResult: submissionScope,
          error: versionResult.error?.message || "Quiz not found",
        })
      );
    }
    if (versionResult.data.lifecycle_status !== "draft") {
      redirect(
        buildDetailPath({
          quizId,
          tab: "configure",
          returnTo,
          versionId: selectedVersionId,
          submissionResult: submissionScope,
          error: "You can only edit questions while the quiz is in draft",
        })
      );
    }

    const quizResult = await supabase
      .from("quiz_definitions")
      .select("id,client_id")
      .eq("id", versionResult.data.quiz_id)
      .maybeSingle();
    if (quizResult.error || !quizResult.data) {
      redirect(
        buildDetailPath({
          quizId,
          tab: "configure",
          returnTo,
          versionId: selectedVersionId,
          submissionResult: submissionScope,
          error: quizResult.error?.message || "Quiz not found",
        })
      );
    }

    const manageResult = await supabase.rpc("quiz_can_manage_client", {
      client_uuid: quizResult.data.client_id,
    });
    if (manageResult.error || !manageResult.data) {
      redirect(
        buildDetailPath({
          quizId,
          tab: "configure",
          returnTo,
          versionId: selectedVersionId,
          submissionResult: submissionScope,
          error: manageResult.error?.message || "Not authorized to edit this quiz",
        })
      );
    }

    const requestedQuestionPosition = Number(requestedPosition);
    const currentPosition = Number(questionResult.data.position);
    if (!Number.isInteger(currentPosition) || currentPosition < 1) {
      redirect(
        buildDetailPath({
          quizId,
          tab: "configure",
          returnTo,
          versionId: selectedVersionId,
          submissionResult: submissionScope,
          error: "Question position is unavailable",
        })
      );
    }

    const { count: questionCount, error: questionCountError } = await supabase
      .from("quiz_version_questions")
      .select("id", { count: "exact", head: true })
      .eq("quiz_version_id", quizVersionId);
    if (questionCountError) {
      redirect(
        buildDetailPath({
          quizId,
          tab: "configure",
          returnTo,
          versionId: selectedVersionId,
          submissionResult: submissionScope,
          error: questionCountError.message,
        })
      );
    }
    const totalQuestions = Number(questionCount || 0);
    if (requestedQuestionPosition > totalQuestions) {
      redirect(
        buildDetailPath({
          quizId,
          tab: "configure",
          returnTo,
          versionId: selectedVersionId,
          submissionResult: submissionScope,
          error: "Question position is out of range",
        })
      );
    }

    if (requestedQuestionPosition !== currentPosition) {
      const tempPosition = totalQuestions + 1;
      const shiftIntoPosition = async (direction: "up" | "down") => {
        if (direction === "up") {
          const { data: shiftCandidates, error: shiftError } = await supabase
            .from("quiz_version_questions")
            .select("id,position")
            .eq("quiz_version_id", quizVersionId)
            .gte("position", requestedQuestionPosition)
            .lt("position", currentPosition)
            .neq("id", questionId)
            .order("position", { ascending: false });
          if (shiftError) {
            redirect(
              buildDetailPath({
                quizId,
                tab: "configure",
                returnTo,
                versionId: selectedVersionId,
                submissionResult: submissionScope,
                error: shiftError.message,
              })
            );
          }
          for (const candidate of shiftCandidates || []) {
            const nextPosition = Number(candidate.position) + 1;
            const { error: updateError } = await supabase
              .from("quiz_version_questions")
              .update({ position: nextPosition })
              .eq("id", candidate.id);
            if (updateError) {
              redirect(
                buildDetailPath({
                  quizId,
                  tab: "configure",
                  returnTo,
                  versionId: selectedVersionId,
                  submissionResult: submissionScope,
                  error: updateError.message,
                })
              );
            }
          }
        } else {
          const { data: shiftCandidates, error: shiftError } = await supabase
            .from("quiz_version_questions")
            .select("id,position")
            .eq("quiz_version_id", quizVersionId)
            .gt("position", currentPosition)
            .lte("position", requestedQuestionPosition)
            .neq("id", questionId)
            .order("position", { ascending: true });
          if (shiftError) {
            redirect(
              buildDetailPath({
                quizId,
                tab: "configure",
                returnTo,
                versionId: selectedVersionId,
                submissionResult: submissionScope,
                error: shiftError.message,
              })
            );
          }
          for (const candidate of shiftCandidates || []) {
            const nextPosition = Number(candidate.position) - 1;
            const { error: updateError } = await supabase
              .from("quiz_version_questions")
              .update({ position: nextPosition })
              .eq("id", candidate.id);
            if (updateError) {
              redirect(
                buildDetailPath({
                  quizId,
                  tab: "configure",
                  returnTo,
                  versionId: selectedVersionId,
                  submissionResult: submissionScope,
                  error: updateError.message,
                })
              );
            }
          }
        }
      };

      const { error: moveToTempError } = await supabase
        .from("quiz_version_questions")
        .update({ position: tempPosition })
        .eq("id", questionId);
      if (moveToTempError) {
        redirect(
          buildDetailPath({
            quizId,
            tab: "configure",
            returnTo,
            versionId: selectedVersionId,
            submissionResult: submissionScope,
            error: moveToTempError.message,
          })
        );
      }

      await shiftIntoPosition(requestedQuestionPosition < currentPosition ? "up" : "down");

      const { error: moveToRequestedError } = await supabase
        .from("quiz_version_questions")
        .update({ position: requestedQuestionPosition })
        .eq("id", questionId);
      if (moveToRequestedError) {
        redirect(
          buildDetailPath({
            quizId,
            tab: "configure",
            returnTo,
            versionId: selectedVersionId,
            submissionResult: submissionScope,
            error: moveToRequestedError.message,
          })
        );
      }
    }

    const questionType = questionResult.data.question_type;
    const existingAnswerKey = questionResult.data.answer_key_snapshot_json;
    const currentScoringMode = parseScoringMode(questionResult.data.scoring_mode);
    const allowedQuestionType =
      requestedQuestionType === "multi_select" || questionType === "multi_select" || questionType === "short_answer";

    if (!allowedQuestionType) {
      redirect(
        buildDetailPath({
          quizId,
          tab: "configure",
          returnTo,
          versionId: selectedVersionId,
          submissionResult: submissionScope,
          error: "This question type is not editable in the quiz builder yet",
        })
      );
    }

    if (requestedQuestionType === "multi_select") {
      const rawOptionLabels = formData
        .getAll("option_label")
        .map((value) => String(value || "").trim())
        .filter(Boolean);
      const selectedRawPositions = new Set(
        formData
          .getAll("correct_option_positions")
          .map((value) => Number.parseInt(String(value || "").trim(), 10))
          .filter((value) => Number.isInteger(value) && value > 0)
      );

      if (rawOptionLabels.length < 2) {
        redirect(
          buildDetailPath({
            quizId,
            tab: "configure",
            returnTo,
            versionId: quizVersionId,
            submissionResult: submissionScope,
            error: "Multi select needs at least 2 options",
          })
        );
      }

      const compacted: { id: string; label: string; position: number }[] = [];
      const correctOptionIds: string[] = [];
      for (let idx = 0; idx < rawOptionLabels.length; idx += 1) {
        const label = rawOptionLabels[idx] || "";
        compacted.push({ id: crypto.randomUUID(), label, position: idx + 1 });
        if (selectedRawPositions.has(idx + 1)) {
          correctOptionIds.push(compacted[idx].id);
        }
      }

      if (correctOptionIds.length === 0) {
        redirect(
          buildDetailPath({
            quizId,
            tab: "configure",
            returnTo,
            versionId: quizVersionId,
            submissionResult: submissionScope,
            error: "Select at least one correct option",
          })
        );
      }

      const optionPayload = compacted.map((option) => ({
        id: option.id,
        label: option.label,
        position: option.position,
      }));
      const answerKeyPayload = {
        scoring_mode: currentScoringMode,
        correct_option_ids: correctOptionIds,
        accepted_text_answers: [],
      };

      const { error } = await supabase
        .from("quiz_version_questions")
        .update({
          prompt,
          question_type: "multi_select",
          option_snapshot_json: optionPayload,
          answer_key_snapshot_json: answerKeyPayload,
          manual_review_required: false,
        })
        .eq("id", questionId);
      if (error) {
        redirect(
          buildDetailPath({
            quizId,
            tab: "configure",
            returnTo,
            versionId: quizVersionId,
            submissionResult: submissionScope,
            error: error.message,
          })
        );
      }
    } else {
      const acceptedTextAnswers = parseTextArray((existingAnswerKey as Record<string, unknown>).accepted_text_answers);
      const answerKeyPayload = {
        scoring_mode: currentScoringMode,
        correct_option_ids: [],
        accepted_text_answers: acceptedTextAnswers,
      };

      const { error } = await supabase
        .from("quiz_version_questions")
        .update({
          prompt,
          question_type: "short_answer",
          option_snapshot_json: [],
          answer_key_snapshot_json: answerKeyPayload,
          manual_review_required: true,
        })
        .eq("id", questionId);
      if (error) {
        redirect(
          buildDetailPath({
            quizId,
            tab: "configure",
            returnTo,
            versionId: quizVersionId,
            submissionResult: submissionScope,
            error: error.message,
          })
        );
      }
    }

    revalidatePath("/quizzes");
    revalidatePath(`/quizzes/${quizId}`);
    revalidatePath("/quizzes/review");

    redirect(
      buildDetailPath({
        quizId,
        tab: "configure",
        returnTo,
        versionId: quizVersionId,
        submissionResult: submissionScope,
        success: "Question updated",
      })
    );
  }

  async function addQuestionAction(formData: FormData) {
    "use server";
    const clientId = String(formData.get("client_id") || "").trim();
    const quizVersionId = String(formData.get("quiz_version_id") || "").trim();
    const prompt = String(formData.get("prompt") || "").trim();
    const requestedPosition = Number.parseInt(String(formData.get("position") || "").trim(), 10);
    const uiQuestionType = String(formData.get("ui_question_type") || "free_text").trim();
    const points = Number.parseFloat(String(formData.get("points") || "1"));
    const questionType = uiQuestionType === "multi_select" ? "multi_select" : "short_answer";
    const manualReviewRequired = questionType === "short_answer";

    if (!uuidRegex.test(clientId) || !uuidRegex.test(quizVersionId)) {
      redirect(
        buildDetailPath({
          quizId,
          tab: "configure",
          returnTo,
          versionId: selectedVersionId,
          submissionResult: submissionScope,
          error: "Invalid quiz selection",
        })
      );
    }
    if (!prompt) {
      redirect(
        buildDetailPath({
          quizId,
          tab: "configure",
          returnTo,
          versionId: selectedVersionId,
          submissionResult: submissionScope,
          error: "Question text is required",
        })
      );
    }
    if (!Number.isInteger(requestedPosition) || requestedPosition < 1) {
      redirect(
        buildDetailPath({
          quizId,
          tab: "configure",
          returnTo,
          versionId: selectedVersionId,
          submissionResult: submissionScope,
          error: "Invalid question position",
        })
      );
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
            tab: "configure",
            returnTo,
            versionId: quizVersionId,
            submissionResult: submissionScope,
            error: "Multi select needs at least 2 options",
          })
        );
      }
      if (correctOptionPositions.length === 0) {
        redirect(
          buildDetailPath({
            quizId,
            tab: "configure",
            returnTo,
            versionId: quizVersionId,
            submissionResult: submissionScope,
            error: "Select at least one correct option",
          })
        );
      }
    }

    const supabase = createSupabaseServerClient();
    const versionResult = await supabase
      .from("quiz_versions")
      .select("id,quiz_id,lifecycle_status")
      .eq("id", quizVersionId)
      .maybeSingle();
    if (versionResult.error || !versionResult.data) {
      redirect(
        buildDetailPath({
          quizId,
          tab: "configure",
          returnTo,
          versionId: selectedVersionId,
          submissionResult: submissionScope,
          error: versionResult.error?.message || "Quiz not found",
        })
      );
    }
    if (versionResult.data.lifecycle_status !== "draft") {
      redirect(
        buildDetailPath({
          quizId,
          tab: "configure",
          returnTo,
          versionId: selectedVersionId,
          submissionResult: submissionScope,
          error: "You can only add questions while the quiz is in draft",
        })
      );
    }

    const quizResult = await supabase
      .from("quiz_definitions")
      .select("id,client_id")
      .eq("id", versionResult.data.quiz_id)
      .maybeSingle();
    if (quizResult.error || !quizResult.data) {
      redirect(
        buildDetailPath({
          quizId,
          tab: "configure",
          returnTo,
          versionId: selectedVersionId,
          submissionResult: submissionScope,
          error: quizResult.error?.message || "Quiz not found",
        })
      );
    }

    const manageResult = await supabase.rpc("quiz_can_manage_client", {
      client_uuid: quizResult.data.client_id,
    });
    if (manageResult.error || !manageResult.data) {
      redirect(
        buildDetailPath({
          quizId,
          tab: "configure",
          returnTo,
          versionId: selectedVersionId,
          submissionResult: submissionScope,
          error: manageResult.error?.message || "Not authorized to edit this quiz",
        })
      );
    }

    const { count: questionCount, error: questionCountError } = await supabase
      .from("quiz_version_questions")
      .select("id", { count: "exact", head: true })
      .eq("quiz_version_id", quizVersionId);
    if (questionCountError) {
      redirect(
        buildDetailPath({
          quizId,
          tab: "configure",
          returnTo,
          versionId: selectedVersionId,
          submissionResult: submissionScope,
          error: questionCountError.message,
        })
      );
    }

    const totalQuestions = Number(questionCount || 0);
    if (requestedPosition > totalQuestions + 1) {
      redirect(
        buildDetailPath({
          quizId,
          tab: "configure",
          returnTo,
          versionId: selectedVersionId,
          submissionResult: submissionScope,
          error: "Question position is out of range",
        })
      );
    }

    if (requestedPosition <= totalQuestions) {
      const { data: shiftCandidates, error: shiftCandidatesError } = await supabase
        .from("quiz_version_questions")
        .select("id,position")
        .eq("quiz_version_id", quizVersionId)
        .gte("position", requestedPosition)
        .order("position", { ascending: false });

      if (shiftCandidatesError) {
        redirect(
          buildDetailPath({
            quizId,
            tab: "configure",
            returnTo,
            versionId: selectedVersionId,
            submissionResult: submissionScope,
            error: shiftCandidatesError.message,
          })
        );
      }

      for (const candidate of shiftCandidates || []) {
        const { error: shiftCandidateError } = await supabase
          .from("quiz_version_questions")
          .update({ position: Number(candidate.position) + 1 })
          .eq("id", candidate.id);
        if (shiftCandidateError) {
          redirect(
            buildDetailPath({
              quizId,
              tab: "configure",
              returnTo,
              versionId: selectedVersionId,
              submissionResult: submissionScope,
              error: shiftCandidateError.message,
            })
          );
        }
      }
    }

    const { data: createdQuestionId, error } = await supabase.rpc("quiz_add_version_question", {
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
    revalidatePath("/quizzes");
    revalidatePath(`/quizzes/${quizId}`);
    revalidatePath("/quizzes/review");

    if (error) {
      redirect(
        buildDetailPath({
          quizId,
          tab: "configure",
          returnTo,
          versionId: quizVersionId,
          submissionResult: submissionScope,
          error: error.message,
        })
      );
    }
    const createdQuestionUuid = String(createdQuestionId || "").trim();
    if (requestedPosition <= totalQuestions) {
      if (!uuidRegex.test(createdQuestionUuid)) {
        redirect(
          buildDetailPath({
            quizId,
            tab: "configure",
            returnTo,
            versionId: quizVersionId,
            submissionResult: submissionScope,
            error: "Unable to place question",
          })
        );
      }
      const { error: repositionError } = await supabase
        .from("quiz_version_questions")
        .update({ position: requestedPosition })
        .eq("id", createdQuestionUuid);
      if (repositionError) {
        redirect(
          buildDetailPath({
            quizId,
            tab: "configure",
            returnTo,
            versionId: quizVersionId,
            submissionResult: submissionScope,
            error: repositionError.message,
          })
        );
      }
    }
    redirect(
      buildDetailPath({
        quizId,
        tab: "configure",
        returnTo,
        versionId: quizVersionId,
        submissionResult: submissionScope,
        success: "Question added",
      })
    );
  }

  async function publishVersionAction(formData: FormData) {
    "use server";
    const quizVersionId = String(formData.get("quiz_version_id") || "").trim();
    if (!uuidRegex.test(quizVersionId)) {
      redirect(
        buildDetailPath({
          quizId,
          tab: "configure",
          returnTo,
          versionId: selectedVersionId,
          submissionResult: submissionScope,
          error: "Invalid quiz selection",
        })
      );
    }

    const supabase = createSupabaseServerClient();
    const { error } = await supabase.rpc("quiz_publish_version", {
      p_quiz_version_id: quizVersionId,
    });

    revalidatePath("/quizzes");
    revalidatePath(`/quizzes/${quizId}`);
    revalidatePath("/quizzes/review");

    if (error) {
      redirect(
        buildDetailPath({
          quizId,
          tab: "configure",
          returnTo,
          versionId: quizVersionId,
          submissionResult: submissionScope,
          error: error.message,
        })
      );
    }
    redirect(
      buildDetailPath({
        quizId,
        tab: "configure",
        returnTo,
        versionId: quizVersionId,
        submissionResult: submissionScope,
        success: "Quiz published",
      })
    );
  }

  async function assignVersionAction(formData: FormData) {
    "use server";
    const requestedVersionId = String(formData.get("quiz_version_id") || "").trim();
    const quizVersionId = uuidRegex.test(requestedVersionId)
      ? requestedVersionId
      : defaultPublishedVersionId;
    const userId = String(formData.get("assigned_user_id") || "").trim();
    const assignmentMode = String(formData.get("assignment_mode") || "required").trim();
    const availableFromRaw = String(formData.get("available_from") || "").trim();
    const dueAtRaw = String(formData.get("due_at") || "").trim();
    const expiresAtRaw = String(formData.get("expires_at") || "").trim();

    if (!uuidRegex.test(quizVersionId)) {
      redirect(
        buildDetailPath({
          quizId,
          tab: "assignments",
          returnTo,
          versionId: selectedVersionId,
          submissionResult: submissionScope,
          error: "Publish this quiz before creating assignments",
        })
      );
    }

    if (!uuidRegex.test(userId)) {
      redirect(
        buildDetailPath({
          quizId,
          tab: "assignments",
          returnTo,
          versionId: selectedVersionId,
          submissionResult: submissionScope,
          error: "Invalid assignment request",
        })
      );
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

    revalidatePath("/quizzes");
    revalidatePath(`/quizzes/${quizId}`);
    revalidatePath("/quizzes/assigned");

    if (error) {
      redirect(
        buildDetailPath({
          quizId,
          tab: "assignments",
          returnTo,
          versionId: quizVersionId,
          submissionResult: submissionScope,
          error: error.message,
        })
      );
    }
    redirect(
      buildDetailPath({
        quizId,
        tab: "assignments",
        returnTo,
        versionId: quizVersionId,
        submissionResult: submissionScope,
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
              href={returnTo}
              className="text-sm font-medium text-slate-600 hover:text-slate-900"
            >
              &larr; Back to quiz list
            </Link>
            <h1 className="mt-2 text-2xl font-semibold text-slate-900">{quiz.title}</h1>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-slate-600">
              <span
                className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-semibold ${quizStatusBadgeClass(quiz.status)}`}
              >
                {quiz.status}
              </span>
              <span>{`Pass mark: ${quiz.passing_score_percent}%`}</span>
              <span>{`Max attempts: ${quiz.max_attempts}`}</span>
            </div>
          </div>
          <Link
            href={`/quizzes/review?client_id=${quiz.client_id}`}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Review queue
          </Link>
        </div>
      </header>

      <nav className="flex flex-wrap gap-2 border-b border-slate-200 pb-4 text-sm">
        <Link
          href={tabUrls.submissions}
          className={`rounded-md px-3 py-1.5 font-medium ${
            activeTab === "submissions"
              ? "tab-active"
              : "border border-slate-200 text-slate-700 hover:bg-slate-100"
          }`}
        >
          Submissions
        </Link>
        {canManage ? (
          <Link
            href={tabUrls.configure}
            className={`rounded-md px-3 py-1.5 font-medium ${
              activeTab === "configure"
                ? "tab-active"
                : "border border-slate-200 text-slate-700 hover:bg-slate-100"
            }`}
          >
            Configure quiz
          </Link>
        ) : null}
        {canAssign ? (
          <Link
            href={tabUrls.assignments}
            className={`rounded-md px-3 py-1.5 font-medium ${
              activeTab === "assignments"
                ? "tab-active"
                : "border border-slate-200 text-slate-700 hover:bg-slate-100"
            }`}
          >
            Assign quiz
          </Link>
        ) : null}
      </nav>

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

      {activeTab === "submissions" ? (
        <section className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="text-sm text-slate-700">
            {selectedVersion ? "Viewing submissions" : "No quiz data available."}
          </div>
        </section>
      ) : null}

      {activeTab === "configure" ? (
        canManage ? (
          <>
            <section className="rounded-xl border border-slate-200 bg-white p-4">
              <h2 className="text-base font-semibold text-slate-900">Add question</h2>
              <p className="mt-1 text-sm text-slate-600">
                Keep it simple: choose Free text or Multi select.
              </p>
              {defaultDraftVersionId ? (
                <SimpleQuestionBuilder
                  action={addQuestionAction}
                  clientId={quiz.client_id}
                  quizVersionId={defaultDraftVersionId}
                  questionCount={questionCountByVersionId[defaultDraftVersionId] || 0}
                />
              ) : (
                <p className="mt-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
                  No editable draft is available yet.
                </p>
                )}
            </section>

            <section className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h2 className="text-base font-semibold text-slate-900">Questions</h2>
                  <p className="mt-1 text-sm text-slate-600">
                    All current question sets. Draft quizzes can be edited here.
                  </p>
                </div>
              </div>
              {versions.length === 0 ? (
                <p className="mt-3 text-sm text-slate-600">No quiz data found.</p>
              ) : (
                <div className="mt-3 space-y-2">
                  {versions.map((version) => (
                    <article key={version.id} className="rounded-lg border border-slate-200">
                      <div className="flex flex-wrap items-start justify-between gap-2 border-b border-slate-200 p-3">
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="text-sm font-semibold text-slate-900">Quiz copy</p>
                            <span
                              className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold ${versionStatusBadgeClass(version.lifecycle_status)}`}
                            >
                              {version.lifecycle_status}
                            </span>
                          </div>
                          <p className="text-xs text-slate-600">
                            Questions: {questionCountByVersionId[version.id] || 0} - Published:{" "}
                            {formatDateTime(version.published_at)}
                          </p>
                        </div>
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
                      </div>

                      <div className="space-y-2 p-3">
                        {(questionsByVersionId[version.id] || [])
                          .slice()
                          .sort((a, b) => a.position - b.position)
                          .map((question) => {
                            const supportsSimpleEditing = questionSupportsSimpleEditing(question.question_type);
                            const canEditCurrentQuestion =
                              draftVersionIds.has(version.id) && canManage && supportsSimpleEditing;
                            const uiQuestionType = toUiQuestionType(question.question_type);
                            const optionRows = buildEditableOptionRows(question);

                            return (
                              <details key={question.id} className="rounded-lg border border-slate-200 bg-white">
                                <summary className="cursor-pointer list-none px-3 py-2 text-sm font-semibold text-slate-900">
                                  <div className="flex items-start gap-2">
                                    <span className="mt-0.5 text-xs font-semibold text-slate-600">{`Q${question.position}`}</span>
                                    <span className="text-sm text-slate-900">{question.prompt}</span>
                                  </div>
                                </summary>
                                <div className="border-t border-slate-200 px-3 py-3">
                                  <p className="text-xs uppercase tracking-wide text-slate-500">
                                    {questionTypeLabel(question.question_type)}
                                  </p>

                                  {canEditCurrentQuestion ? (
                                    <form action={updateQuestionAction} className="mt-3 space-y-3">
                                      <input type="hidden" name="quiz_question_id" value={question.id} />
                                      <input type="hidden" name="quiz_version_id" value={version.id} />
                                      <input type="hidden" name="client_id" value={quiz.client_id} />
                                      <input type="hidden" name="ui_question_type" value={uiQuestionType} />

                                      <label className="block text-sm text-slate-700">
                                        Position
                                        <select
                                          name="position"
                                          required
                                          defaultValue={String(question.position)}
                                          className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-800"
                                        >
                                          {buildQuestionPositionOptions(questionCountByVersionId[version.id] || 0).map(
                                            (position) => (
                                              <option key={position} value={String(position)}>
                                                {`Question ${position}`}
                                              </option>
                                            )
                                          )}
                                        </select>
                                      </label>

                                      <label className="block text-sm text-slate-700">
                                        Question
                                        <textarea
                                          name="prompt"
                                          required
                                          rows={3}
                                          defaultValue={question.prompt}
                                          className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-800"
                                        />
                                      </label>

                                      {uiQuestionType === "multi_select" ? (
                                        <div className="space-y-2 rounded-md border border-slate-200 bg-slate-50 p-2">
                                          <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                                            Options (check all correct answers)
                                          </p>
                                          <div className="space-y-2">
                                            {optionRows.map((option) => (
                                              <div
                                                key={option.id}
                                                className="grid gap-2 sm:grid-cols-[auto_1fr_auto] items-start"
                                              >
                                                <div className="self-start pt-2">
                                                  <input
                                                    type="checkbox"
                                                    name="correct_option_positions"
                                                    value={String(option.position)}
                                                    defaultChecked={option.isCorrect}
                                                    className="h-4 w-4 rounded border-slate-300 text-slate-900"
                                                  />
                                                </div>
                                                <input
                                                  name="option_label"
                                                  defaultValue={option.label}
                                                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-800"
                                                  placeholder={`Answer option ${option.position}`}
                                                />
                                                <p className="self-start pt-2 text-xs font-medium text-slate-500">
                                                  Correct
                                                </p>
                                              </div>
                                            ))}
                                          </div>
                                        </div>
                                      ) : (
                                        <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
                                          Free text questions are reviewed and marked manually.
                                        </p>
                                      )}

                                      <button
                                        type="submit"
                                        className="rounded border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                                      >
                                        Save question
                                      </button>
                                    </form>
                                  ) : (
                                    <div className="mt-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
                                      {!draftVersionIds.has(version.id) ? (
                                        <p className="text-sm text-slate-600">
                                          Published or retired quizzes are locked.
                                        </p>
                                      ) : null}
                                      {!supportsSimpleEditing ? (
                                        <p className="text-sm text-slate-600">
                                          This question type is not editable in the quiz builder yet.
                                        </p>
                                      ) : null}
                                      <p className="mt-2 text-sm text-slate-700 whitespace-pre-wrap">
                                        {question.prompt}
                                      </p>
                                    </div>
                                  )}
                                </div>
                              </details>
                            );
                          })}
                        {questionsByVersionId[version.id]?.length === 0 ? (
                          <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
                            No questions yet.
                          </p>
                        ) : null}
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </section>
          </>
        ) : (
          <section className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
            You do not have manage access for this quiz.
          </section>
        )
      ) : null}

      {activeTab === "assignments" ? (
        canAssign ? (
          <section className="rounded-xl border border-slate-200 bg-white p-4">
            <h2 className="text-base font-semibold text-slate-900">Assign quiz</h2>
            {publishedVersions.length === 0 ? (
              <p className="mt-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
                Publish this quiz first, then assignment appears here.
              </p>
            ) : (
              <form action={assignVersionAction} className="mt-3 grid gap-3 md:grid-cols-2">
                <input type="hidden" name="quiz_version_id" value={defaultPublishedVersionId} />
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
                      <option value="">No employees found</option>
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
        ) : (
          <section className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
            You do not have assignment access for this quiz.
          </section>
        )
      ) : null}

      {activeTab === "submissions" ? (
      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-slate-900">Submissions</h2>
            <p className="mt-1 text-sm text-slate-600">
              Columns are quiz questions, rows are submitted attempts.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {([
              { key: "all", label: "All" },
              { key: "passed", label: "Passed" },
              { key: "failed", label: "Failed" },
              { key: "pending", label: "Pending" },
            ] as const).map((scope) => (
              <Link
                key={scope.key}
                href={buildDetailPath({
                  quizId,
                  tab: "submissions",
                  returnTo,
                  versionId: selectedVersionId,
                  submissionResult: scope.key,
                })}
                className={`rounded-md border px-2.5 py-1 text-xs font-semibold ${
                  submissionScope === scope.key
                    ? "border-slate-900 bg-slate-900 text-white"
                    : "border-slate-300 text-slate-700 hover:bg-slate-50"
                }`}
              >
                {`${scope.label} (${submissionCounts[scope.key]})`}
              </Link>
            ))}
          </div>
        </div>
        <p className="mt-3 text-xs text-slate-500">
          {`Showing ${submissionCounts[submissionScope]} ${submissionScope} submission(s) for this quiz.`}
        </p>
        {selectedVersion == null ? (
          <p className="mt-3 text-sm text-slate-600">No quiz data available.</p>
        ) : filteredAttempts.length === 0 ? (
          <p className="mt-3 text-sm text-slate-600">
            {submissionScope === "all"
              ? "No submissions yet for this quiz."
              : "No submissions in this filter for this quiz."}
          </p>
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
                      <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                        {`Q${question.position}`}
                      </div>
                      <div className="max-w-[220px] truncate font-medium text-slate-700" title={question.prompt}>
                        {question.prompt}
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredAttempts.map((attempt) => {
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
                      <td className="px-2 py-2">
                        <span
                          className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold ${attemptStatusBadgeClass(attempt.status)}`}
                        >
                          {statusLabel(attempt.status)}
                        </span>
                      </td>
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
      ) : null}
    </div>
  );
}
