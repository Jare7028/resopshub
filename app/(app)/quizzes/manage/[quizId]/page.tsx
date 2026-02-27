import { notFound, redirect } from "next/navigation";

const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type LegacyManageDetailSearchParams = {
  return_to?: string | string[];
  tab?: string | string[];
  submission_result?: string | string[];
  error?: string | string[];
  success?: string | string[];
  client_id?: string | string[];
};

function firstValue(value: string | string[] | undefined) {
  if (Array.isArray(value)) return String(value[0] || "").trim();
  return String(value || "").trim();
}

export default async function LegacyQuizManageDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ quizId: string }>;
  searchParams?: Promise<LegacyManageDetailSearchParams>;
}) {
  const resolvedParams = await params;
  const quizId = String(resolvedParams.quizId || "").trim();
  if (!uuidRegex.test(quizId)) notFound();

  const resolvedSearch = await searchParams;
  const query = new URLSearchParams();
  const returnTo = firstValue(resolvedSearch?.return_to) || firstValue(resolvedSearch?.client_id);
  const tab = firstValue(resolvedSearch?.tab);
  const submissionResult = firstValue(resolvedSearch?.submission_result);
  const error = firstValue(resolvedSearch?.error);
  const success = firstValue(resolvedSearch?.success);

  if (returnTo) {
    const normalized = returnTo.startsWith("/quizzes")
      ? returnTo
      : `/quizzes?client_id=${returnTo}`;
    query.set("return_to", normalized);
  }
  if (tab) query.set("tab", tab);
  if (submissionResult) query.set("submission_result", submissionResult);
  if (error) query.set("error", error);
  if (success) query.set("success", success);

  const qs = query.toString();
  redirect(qs ? `/quizzes/${quizId}?${qs}` : `/quizzes/${quizId}`);
}
