export type DashboardCurrencyCode = "GBP" | "USD" | "MUR";

export type DashboardFocusKey =
  | "finance"
  | "people"
  | "task_delivery"
  | "feature_requests"
  | "work_by_client"
  | "work_by_user"
  | "projects_glance"
  | "recent_activity";

export type DashboardFiltersState = {
  range: string;
  client: string[];
  project: string[];
  user: string[];
  status: string[];
  priority: string[];
  currency: DashboardCurrencyCode;
};

export type DashboardSnapshotCard = {
  key: string;
  label: string;
  value: string;
  accent?: string;
  helper?: string;
  href?: string;
  focus?: DashboardFocusKey;
};

export type DashboardClientAggregate = {
  clientId: string;
  clientName: string;
  open: number;
  blocked: number;
  overdue: number;
  projects: number;
  activity: string | null;
};

export type DashboardUserAggregate = {
  userId: string;
  userName: string;
  open: number;
  blocked: number;
  overdue: number;
  projects: number;
};

export type DashboardProjectAggregate = {
  projectId: string;
  projectName: string;
  clientName: string;
  open: number;
  blocked: number;
  overdue: number;
};

export type DashboardFinanceRiskCounters = {
  negativeMarginClients: number;
  missingBillingProfiles: number;
  missingExchangeRates: number;
};

export type DashboardFinanceSummary = {
  currencyCode: DashboardCurrencyCode;
  revenueTotal: number;
  costTotal: number;
  marginTotal: number;
  marginPercent: number | null;
  scopedClientCount: number;
  roleTopLabel: string;
  roleTopCount: number;
  activeEmployeeCount: number;
  clientsWithEmployees: number;
  risks: DashboardFinanceRiskCounters;
  isEmptyScope: boolean;
};
