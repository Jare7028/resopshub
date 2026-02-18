import type { DashboardCurrencyCode, DashboardFiltersState } from "./types";

export const DASHBOARD_FILTER_COOKIE_NAME = "resopshub_dashboard_filters";
export const DASHBOARD_DEFAULT_CURRENCY: DashboardCurrencyCode = "GBP";
const CURRENCY_VALUES = new Set<DashboardCurrencyCode>(["GBP", "USD", "MUR"]);

function cleanList(values: string[]) {
  return Array.from(new Set(values.map((value) => String(value || "").trim()).filter(Boolean)));
}

export function normalizeDashboardCurrency(value: unknown): DashboardCurrencyCode {
  const normalized = String(value || "")
    .trim()
    .toUpperCase();
  return CURRENCY_VALUES.has(normalized as DashboardCurrencyCode)
    ? (normalized as DashboardCurrencyCode)
    : DASHBOARD_DEFAULT_CURRENCY;
}

export function buildDashboardQuery(filters: DashboardFiltersState) {
  const params = new URLSearchParams();
  if (filters.range && filters.range !== "all") params.set("range", filters.range);
  if (filters.client.length) params.set("client", cleanList(filters.client).join(","));
  if (filters.project.length) params.set("project", cleanList(filters.project).join(","));
  if (filters.user.length) params.set("user", cleanList(filters.user).join(","));
  if (filters.status.length) params.set("status", cleanList(filters.status).join(","));
  if (filters.priority.length) params.set("priority", cleanList(filters.priority).join(","));
  const currency = normalizeDashboardCurrency(filters.currency);
  if (currency !== DASHBOARD_DEFAULT_CURRENCY) params.set("currency", currency);
  return params.toString();
}

export function writeDashboardFiltersCookie(filters: DashboardFiltersState) {
  const maxAgeSeconds = 60 * 60 * 24 * 365;
  const encoded = encodeURIComponent(JSON.stringify(filters));
  let cookie = `${DASHBOARD_FILTER_COOKIE_NAME}=${encoded}; path=/dashboard; max-age=${maxAgeSeconds}; samesite=lax`;
  if (typeof window !== "undefined" && window.location.protocol === "https:") {
    cookie += "; secure";
  }
  document.cookie = cookie;
}
