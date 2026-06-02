export const SOCIAL_PAGE_SIZE = 24;

export function normalizeSocialPageNumber(value: string | undefined) {
  const parsed = Number(value || "1");
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 1;
}

export function buildSocialListUrl(page?: number) {
  const params = new URLSearchParams();
  if (page && page > 1) {
    params.set("page", String(Math.floor(page)));
  }
  const qs = params.toString();
  return qs ? `/social?${qs}` : "/social";
}
