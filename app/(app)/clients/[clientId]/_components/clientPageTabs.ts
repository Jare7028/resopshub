export const CLIENT_PAGE_TABS = [
  { key: "overview", label: "Overview", suffix: "" },
  { key: "contacts", label: "Contacts", suffix: "/contacts" },
  { key: "billing", label: "Billing", suffix: "/billing" },
  { key: "projects", label: "Projects", suffix: "/projects" },
  { key: "tasks", label: "Tasks", suffix: "/tasks" },
  { key: "notes", label: "Notes", suffix: "/notes" },
  { key: "documents", label: "Documents", suffix: "/documents" },
  { key: "requirements", label: "Requirements", suffix: "/requirements" },
  { key: "kpis", label: "KPIs", suffix: "/kpis" },
] as const;

export type ClientPageTabKey = (typeof CLIENT_PAGE_TABS)[number]["key"];
export type ClientPageTab = (typeof CLIENT_PAGE_TABS)[number];
