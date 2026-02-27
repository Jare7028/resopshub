import { redirect } from "next/navigation";

type LegacyManageSearchParams = {
  client_id?: string | string[];
  tab?: string | string[];
  error?: string | string[];
  success?: string | string[];
};

function firstValue(value: string | string[] | undefined) {
  if (Array.isArray(value)) return String(value[0] || "").trim();
  return String(value || "").trim();
}

export default async function LegacyQuizManagePage({
  searchParams,
}: {
  searchParams?: Promise<LegacyManageSearchParams>;
}) {
  const resolvedSearch = await searchParams;
  const params = new URLSearchParams();
  const clientId = firstValue(resolvedSearch?.client_id);
  const tab = firstValue(resolvedSearch?.tab);
  const error = firstValue(resolvedSearch?.error);
  const success = firstValue(resolvedSearch?.success);

  if (clientId) params.set("client_id", clientId);
  if (tab) params.set("tab", tab);
  if (error) params.set("error", error);
  if (success) params.set("success", success);

  const query = params.toString();
  redirect(query ? `/quizzes?${query}` : "/quizzes");
}
