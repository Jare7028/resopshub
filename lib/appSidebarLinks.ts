import { type PagePermissionKey } from "@/lib/pagePermissions";

export type SidebarPageKey = PagePermissionKey | "settings";

export type SidebarNavIcon =
  | "dashboard"
  | "clients"
  | "projects"
  | "tasks"
  | "scout"
  | "employeeInfo"
  | "schedules"
  | "quizzes"
  | "forms"
  | "chat"
  | "social"
  | "personal"
  | "notes"
  | "featureSuggestions"
  | "help"
  | "settings"
  | "inventory";

export type SidebarNavLink = {
  href: string;
  label: string;
  icon: SidebarNavIcon;
  pageKey: SidebarPageKey;
};

export const APP_SIDEBAR_LINKS: readonly SidebarNavLink[] = [
  { href: "/dashboard", label: "Dashboard", icon: "dashboard", pageKey: "dashboard" },
  { href: "/clients", label: "Clients", icon: "clients", pageKey: "clients" },
  { href: "/projects", label: "Projects", icon: "projects", pageKey: "projects" },
  { href: "/tasks", label: "Tasks", icon: "tasks", pageKey: "tasks" },
  { href: "/scout", label: "Scout", icon: "scout", pageKey: "scout" },
  {
    href: "/employee-info",
    label: "Employee Info",
    icon: "employeeInfo",
    pageKey: "employee_info",
  },
  {
    href: "/inventory",
    label: "Inventory",
    icon: "inventory",
    pageKey: "inventory",
  },
  {
    href: "/schedules",
    label: "Schedules",
    icon: "schedules",
    pageKey: "schedules",
  },
  {
    href: "/quizzes",
    label: "Quizzes",
    icon: "quizzes",
    pageKey: "quizzes",
  },
  { href: "/forms", label: "Forms", icon: "forms", pageKey: "forms" },
  { href: "/chat", label: "Chat", icon: "chat", pageKey: "chat" },
  { href: "/social", label: "Social", icon: "social", pageKey: "social" },
  { href: "/personal", label: "Personal", icon: "personal", pageKey: "personal" },
  { href: "/notes", label: "Notes", icon: "notes", pageKey: "notes" },
  {
    href: "/feature-suggestions",
    label: "Feature Suggestions",
    icon: "featureSuggestions",
    pageKey: "feature_suggestions",
  },
  {
    href: "/help",
    label: "Help & Walkthrough",
    icon: "help",
    pageKey: "help",
  },
  { href: "/settings", label: "Settings", icon: "settings", pageKey: "settings" },
] as const;
