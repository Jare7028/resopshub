export const PAGE_PERMISSION_KEYS = [
  "dashboard",
  "clients",
  "projects",
  "tasks",
  "employee_info",
  "forms",
  "chat",
  "social",
  "personal",
  "notes",
  "feature_suggestions",
  "help",
  "settings",
] as const;

export type PagePermissionKey = (typeof PAGE_PERMISSION_KEYS)[number];

export const PAGE_PERMISSION_ROUTE_PREFIXES: Array<{
  pageKey: PagePermissionKey;
  prefix: string;
}> = [
  { pageKey: "dashboard", prefix: "/dashboard" },
  { pageKey: "clients", prefix: "/clients" },
  { pageKey: "projects", prefix: "/projects" },
  { pageKey: "tasks", prefix: "/tasks" },
  { pageKey: "employee_info", prefix: "/employee-info" },
  { pageKey: "employee_info", prefix: "/inventory" },
  { pageKey: "forms", prefix: "/forms" },
  { pageKey: "chat", prefix: "/chat" },
  { pageKey: "social", prefix: "/social" },
  { pageKey: "personal", prefix: "/personal" },
  { pageKey: "notes", prefix: "/notes" },
  { pageKey: "feature_suggestions", prefix: "/feature-suggestions" },
  { pageKey: "help", prefix: "/help" },
  { pageKey: "settings", prefix: "/settings" },
];

export function pagePermissionKeyForPathname(pathname: string): PagePermissionKey | null {
  const path = pathname.trim();
  if (!path || path === "/" || path === "/login" || path === "/reset") {
    return null;
  }
  if (path === "/forms/share" || path.startsWith("/forms/share/")) {
    return null;
  }
  if (path === "/personal/share" || path.startsWith("/personal/share/")) {
    return null;
  }

  for (const route of PAGE_PERMISSION_ROUTE_PREFIXES) {
    if (path === route.prefix || path.startsWith(`${route.prefix}/`)) {
      return route.pageKey;
    }
  }

  return null;
}

export function isMutationMethod(method: string): boolean {
  const upper = method.toUpperCase();
  return upper !== "GET" && upper !== "HEAD" && upper !== "OPTIONS";
}
