import Image from "next/image";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  isSupabaseMissingFunctionError,
  isSupabaseMissingTableError,
} from "@/lib/supabaseErrors";
import { withPerfTiming } from "@/lib/perf";
import { type PagePermissionKey } from "@/lib/pagePermissions";
import PersonalNavSections from "./PersonalNavSections";
import NotificationBell from "./_components/NotificationBell";
import ChatNavLink from "./_components/ChatNavLink";
import GlobalSearchBar from "./_components/GlobalSearchBar";
import AppResumeRefresh from "./_components/AppResumeRefresh";
import AppNavLink from "./_components/AppNavLink";

type NavIconName =
  | "dashboard"
  | "clients"
  | "projects"
  | "tasks"
  | "employeeInfo"
  | "forms"
  | "chat"
  | "personal"
  | "notes"
  | "featureSuggestions"
  | "help";

type NavLink = {
  href: string;
  label: string;
  icon: NavIconName;
  pageKey: PagePermissionKey;
};

function isMissingColumnError(error: unknown) {
  if (!error || typeof error !== "object") {
    return false;
  }
  const anyError = error as { code?: unknown; message?: unknown };
  const code = typeof anyError.code === "string" ? anyError.code : "";
  const message = typeof anyError.message === "string" ? anyError.message : "";
  return code === "42703" || message.includes("does not exist");
}

function SidebarIcon({ name }: { name: NavIconName }) {
  const iconClassName = "h-4 w-4 shrink-0";

  switch (name) {
    case "dashboard":
      return (
        <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={iconClassName}>
          <path d="M3 13h8V3H3v10Z" />
          <path d="M13 21h8v-6h-8v6Z" />
          <path d="M13 3h8v8h-8V3Z" />
          <path d="M3 21h8v-4H3v4Z" />
        </svg>
      );
    case "clients":
      return (
        <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={iconClassName}>
          <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
          <circle cx="8.5" cy="7" r="4" />
          <path d="M22 21v-2a4 4 0 0 0-3-3.9" />
          <path d="M15.5 3.1a4 4 0 0 1 0 7.8" />
        </svg>
      );
    case "projects":
      return (
        <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={iconClassName}>
          <path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" />
        </svg>
      );
    case "tasks":
      return (
        <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={iconClassName}>
          <path d="M9 11 6.5 8.5 5 10" />
          <path d="M9 17 6.5 14.5 5 16" />
          <path d="M11 10h8" />
          <path d="M11 16h8" />
          <path d="M5 4h14" />
        </svg>
      );
    case "employeeInfo":
      return (
        <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={iconClassName}>
          <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <path d="M18 8h5" />
          <path d="M18 12h5" />
          <path d="M18 16h5" />
        </svg>
      );
    case "forms":
      return (
        <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={iconClassName}>
          <path d="M6 3h9l4 4v14H6V3Z" />
          <path d="M15 3v4h4" />
          <path d="M9 12h6" />
          <path d="M9 16h6" />
        </svg>
      );
    case "chat":
      return (
        <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={iconClassName}>
          <path d="M21 12a8.8 8.8 0 0 1-.9 3.8 9 9 0 0 1-8.1 5.2 8.8 8.8 0 0 1-3.8-.9L3 21l1.9-5.1a8.8 8.8 0 0 1-.9-3.8 9 9 0 0 1 5.2-8.1A8.8 8.8 0 0 1 13 3h.5a9 9 0 0 1 7.5 7.5V12Z" />
        </svg>
      );
    case "personal":
      return (
        <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={iconClassName}>
          <circle cx="12" cy="7" r="4" />
          <path d="M5.5 21a6.5 6.5 0 0 1 13 0" />
        </svg>
      );
    case "notes":
      return (
        <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={iconClassName}>
          <path d="M4 4h16v16H4z" />
          <path d="M8 8h8" />
          <path d="M8 12h8" />
          <path d="M8 16h5" />
        </svg>
      );
    case "featureSuggestions":
      return (
        <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={iconClassName}>
          <path d="M9 18h6" />
          <path d="M10 22h4" />
          <path d="M12 2a7 7 0 0 0-4 12.7c.7.5 1 1.3 1 2.1V18h6v-1.2c0-.8.3-1.6 1-2.1A7 7 0 0 0 12 2Z" />
        </svg>
      );
    case "help":
      return (
        <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={iconClassName}>
          <circle cx="12" cy="12" r="9" />
          <path d="M9.25 9.5a2.75 2.75 0 1 1 4.74 1.88c-.7.74-1.46 1.24-1.46 2.37" />
          <path d="M12 17.5h.01" />
        </svg>
      );
    default:
      return null;
  }
}

const baseNavLinks: NavLink[] = [
  { href: "/dashboard", label: "Dashboard", icon: "dashboard", pageKey: "dashboard" },
  { href: "/clients", label: "Clients", icon: "clients", pageKey: "clients" },
  { href: "/projects", label: "Projects", icon: "projects", pageKey: "projects" },
  { href: "/tasks", label: "Tasks", icon: "tasks", pageKey: "tasks" },
  {
    href: "/employee-info",
    label: "Employee Info",
    icon: "employeeInfo",
    pageKey: "employee_info",
  },
  { href: "/forms", label: "Forms", icon: "forms", pageKey: "forms" },
  { href: "/chat", label: "Chat", icon: "chat", pageKey: "chat" },
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
];

export default async function AppLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const supabase = createSupabaseServerClient();
  const { data: authData } = await supabase.auth.getUser();
  const user = authData.user;

  if (!user) {
    redirect("/login");
  }

  const email = user.email || "";
  let currentProfile: { id: string; role: string; status: string } | null = null;

  if (email) {
    const { data: profile } = await supabase
      .from("users")
      .select("id,role,status")
      .eq("id", user.id)
      .maybeSingle();

    if (!profile) {
      const { count } = await supabase
        .from("users")
        .select("id", { count: "exact", head: true });

      if ((count || 0) === 0) {
        const fullName =
          (user.user_metadata?.full_name as string | undefined) ||
          (user.user_metadata?.name as string | undefined) ||
          email.split("@")[0] ||
          "Team member";

        const { error: insertError } = await supabase.from("users").insert({
          id: user.id,
          email,
          full_name: fullName,
          role: "admin",
          status: "active",
        });

        if (insertError) {
          await supabase.auth.signOut();
          redirect(
            `/login?error=${encodeURIComponent(
              "Profile setup failed. Please contact an admin."
            )}`
          );
        }
      } else {
        await supabase.auth.signOut();
        redirect(
          `/login?error=${encodeURIComponent(
            "Account is not provisioned. Ask an admin to create your user."
          )}`
        );
      }
    } else if (profile.status === "disabled") {
      await supabase.auth.signOut();
      redirect("/login?error=Account%20disabled");
    } else {
      currentProfile = {
        id: profile.id,
        role: profile.role,
        status: profile.status,
      };
    }
  }

  let pagePermissionByKey = new Map<PagePermissionKey, "none" | "view" | "edit">();
  if (currentProfile && currentProfile.role !== "admin") {
    const { data: pagePermissionRows, error: pagePermissionError } = await supabase
      .from("user_page_permissions")
      .select("page_key,access_level")
      .eq("user_id", currentProfile.id);

    if (pagePermissionError) {
      if (!isSupabaseMissingTableError(pagePermissionError)) {
        console.error("[layout.user_page_permissions]", pagePermissionError.message);
      }
    } else {
      const pagePermissions = (pagePermissionRows || []) as Array<{
        page_key: PagePermissionKey;
        access_level: "none" | "view" | "edit";
      }>;
      pagePermissionByKey = new Map(pagePermissions.map((row) => [row.page_key, row.access_level]));
    }
  }

  const canViewPage = (pageKey: PagePermissionKey) => {
    if (!currentProfile || currentProfile.role === "admin") {
      return true;
    }
    const explicitAccess = pagePermissionByKey.get(pageKey);
    return (explicitAccess || "edit") !== "none";
  };

  const navLinks = baseNavLinks.filter((link) => canViewPage(link.pageKey));
  const canViewSettings = canViewPage("settings");
  const canViewPersonal = canViewPage("personal");
  const canViewChat = canViewPage("chat");

  async function signOut() {
    "use server";
    const supabase = createSupabaseServerClient();
    await supabase.auth.signOut();
    redirect("/login");
  }

  const personalSectionsPromise = canViewPersonal
    ? supabase
        .from("personal_sections")
        .select("id,title,owner_id,sort_order")
        .order("sort_order", { ascending: true })
        .order("created_at", { ascending: true })
    : Promise.resolve({ data: [] as Array<{ id: string; title: string; owner_id: string }>, error: null });
  const personalPagesWithSortPromise = canViewPersonal
    ? supabase
        .from("personal_pages")
        .select("id,title,owner_id,section_id,updated_at,sort_order")
        .order("section_id", { ascending: true, nullsFirst: true })
        .order("sort_order", { ascending: true })
        .order("updated_at", { ascending: false })
    : Promise.resolve({
        data: [] as Array<{
          id: string;
          title: string;
          owner_id: string;
          section_id: string | null;
          updated_at: string | null;
          sort_order?: number | null;
        }>,
        error: null as null,
      });

  const [
    { data: personalSections },
    { data: personalPagesWithSortRaw, error: personalPagesWithSortError },
  ] = await Promise.all([
    personalSectionsPromise,
    personalPagesWithSortPromise,
  ]);

  let personalPages: Array<{
    id: string;
    title: string;
    owner_id: string;
    section_id: string | null;
    updated_at: string | null;
    sort_order?: number | null;
  }> = [];

  if (personalPagesWithSortError && isMissingColumnError(personalPagesWithSortError)) {
    const { data: fallbackPagesRaw } = await supabase
      .from("personal_pages")
      .select("id,title,owner_id,section_id,updated_at")
      .order("updated_at", { ascending: false });
    personalPages = (fallbackPagesRaw || []) as typeof personalPages;
  } else if (!personalPagesWithSortError) {
    personalPages = (personalPagesWithSortRaw || []) as typeof personalPages;
  }

  let unreadChatCount = 0;
  if (canViewChat) {
    const { data: unreadRowsRaw, error: unreadRowsError } = await withPerfTiming(
      "layout.chat_unread.rpc",
      () => supabase.rpc("chat_unread_counts")
    );

    if (!unreadRowsError) {
      unreadChatCount = ((unreadRowsRaw || []) as Array<{ unread_count: number | null }>).reduce(
        (sum, row) => sum + Number(row.unread_count || 0),
        0
      );
    } else if (!isSupabaseMissingFunctionError(unreadRowsError) && !isSupabaseMissingTableError(unreadRowsError)) {
      console.error("[layout.chat.unread.rpc]", unreadRowsError.message);
    }
  }

  return (
    <div className="min-h-screen overflow-x-hidden app-bg text-slate-900">
      <AppResumeRefresh />
      <div className="relative min-h-screen overflow-x-hidden">
        <input
          id="app-sidebar-collapsed"
          type="checkbox"
          className="peer/sidebar sr-only hidden md:block"
        />
        <input
          id="app-sidebar-open"
          type="checkbox"
          className="peer/drawer sr-only md:hidden"
        />

        <label
          htmlFor="app-sidebar-open"
          className="fixed inset-0 z-30 hidden bg-slate-900/35 backdrop-blur-[1px] peer-checked/drawer:block md:hidden"
          aria-label="Close navigation drawer"
        />

        <aside className="fixed inset-y-0 left-0 z-40 flex h-screen w-[17.5rem] max-w-[85vw] -translate-x-full flex-col overflow-x-hidden border-r app-border app-surface transition-transform duration-200 peer-checked/drawer:translate-x-0 md:w-64 md:translate-x-0 md:transition-[width] md:duration-200 md:peer-checked/sidebar:w-16 md:peer-checked/sidebar:[&_.nav-label]:hidden md:peer-checked/sidebar:[&_.personal-nav-sections]:hidden md:peer-checked/sidebar:[&_.sidebar-logo]:hidden md:peer-checked/sidebar:[&_.sidebar-mini-logo]:inline-flex md:peer-checked/sidebar:[&_.nav-item]:justify-center md:peer-checked/sidebar:[&_.chat-badge]:absolute md:peer-checked/sidebar:[&_.chat-badge]:right-1 md:peer-checked/sidebar:[&_.chat-badge]:top-1">
          <div className="px-4 py-4 md:py-5">
            <div className="flex items-center justify-between gap-2">
              <AppNavLink href="/clients" className="flex items-center gap-2">
                <Image
                  src="/logo.png"
                  alt="ResOpsHub"
                  width={128}
                  height={32}
                  className="sidebar-logo h-8 w-auto"
                />
                <span className="sidebar-mini-logo hidden h-8 w-8 overflow-hidden rounded-md">
                  <Image
                    src="/logo-mark.png"
                    alt="ResOpsHub"
                    width={32}
                    height={32}
                    className="h-8 w-8 object-contain"
                  />
                </span>
              </AppNavLink>
              <label
                htmlFor="app-sidebar-open"
                className="inline-flex h-11 w-11 cursor-pointer items-center justify-center rounded-full border border-slate-200 bg-white text-slate-600 hover:bg-slate-100 hover:text-slate-900 md:hidden"
                aria-label="Close navigation"
              >
                <svg
                  aria-hidden="true"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="h-5 w-5"
                >
                  <path d="M18 6 6 18" />
                  <path d="m6 6 12 12" />
                </svg>
              </label>
            </div>
          </div>
          <label
            htmlFor="app-sidebar-collapsed"
            className="absolute right-[-14px] top-6 z-50 hidden h-10 w-10 cursor-pointer items-center justify-center rounded-full border border-slate-200 bg-white text-slate-600 shadow-md hover:bg-slate-100 hover:text-slate-900 md:inline-flex"
            aria-label="Toggle sidebar"
            title="Collapse / expand menu"
          >
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="h-5 w-5 transition-transform md:peer-checked/sidebar:rotate-180"
            >
              <path d="m15 18-6-6 6-6" />
            </svg>
          </label>

          <nav className="min-h-0 flex-1 overflow-y-auto px-3">
            <div className="space-y-1">
              {navLinks.map((link) =>
                link.href === "/chat" ? (
                  <ChatNavLink
                    key={link.href}
                    initialUnreadCount={unreadChatCount}
                    userId={user.id}
                    className="nav-item min-h-11"
                    labelClassName="nav-label"
                    badgeClassName="chat-badge"
                  />
                ) : (
                  <AppNavLink
                    key={link.href}
                    href={link.href}
                    className="nav-item relative flex min-h-11 items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 hover:text-slate-900"
                    title={link.label}
                    aria-label={link.label}
                  >
                    <SidebarIcon name={link.icon} />
                    <span className="nav-label">{link.label}</span>
                  </AppNavLink>
                )
              )}
            </div>
            {canViewPersonal ? (
              <div className="personal-nav-sections">
                <PersonalNavSections
                  currentUserId={user.id}
                  sections={personalSections || []}
                  pages={personalPages || []}
                />
              </div>
            ) : null}
          </nav>

          {canViewSettings ? (
            <div className="px-3 pb-4">
              <AppNavLink
                href="/settings"
                className="nav-item group flex min-h-11 items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 hover:text-slate-900"
                aria-label="Settings"
                title="Settings"
              >
                <svg
                  aria-hidden="true"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="h-4 w-4"
                >
                  <path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z" />
                  <path d="M19.4 15a7.9 7.9 0 0 0 .1-1 7.9 7.9 0 0 0-.1-1l2.1-1.6-2-3.4-2.5 1a8.8 8.8 0 0 0-1.7-1l-.4-2.7H9.1l-.4 2.7a8.8 8.8 0 0 0-1.7 1l-2.5-1-2 3.4L4.6 13a7.9 7.9 0 0 0-.1 1 7.9 7.9 0 0 0 .1 1L2.5 16.6l2 3.4 2.5-1a8.8 8.8 0 0 0 1.7 1l.4 2.7h5.8l.4-2.7a8.8 8.8 0 0 0 1.7-1l2.5 1 2-3.4L19.4 15Z" />
                </svg>
                <span className="nav-label">Settings</span>
              </AppNavLink>
            </div>
          ) : null}
        </aside>

        <div className="flex min-h-screen min-w-0 flex-col overflow-x-hidden pl-0 transition-[padding] duration-200 md:pl-64 md:peer-checked/sidebar:pl-16">
          <header className="border-b app-border app-header px-3 py-3 sm:px-4 md:px-6 md:py-4">
            <div className="flex flex-wrap items-center gap-2 sm:gap-3 md:gap-4">
              <label
                htmlFor="app-sidebar-open"
                className="inline-flex h-11 w-11 cursor-pointer items-center justify-center rounded-md border border-slate-200 bg-white text-slate-700 shadow-sm hover:bg-slate-100 md:hidden"
                aria-label="Open navigation"
              >
                <svg
                  aria-hidden="true"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="h-5 w-5"
                >
                  <path d="M3 6h18" />
                  <path d="M3 12h18" />
                  <path d="M3 18h18" />
                </svg>
              </label>
              <div className="order-2 hidden min-w-0 flex-1 sm:block md:order-1 md:min-w-[12rem] md:flex-none">
                <p className="text-xs uppercase tracking-wide text-slate-500 sm:text-sm sm:normal-case sm:tracking-normal">Signed in as</p>
                <p className="truncate text-sm font-semibold text-slate-900">{email}</p>
              </div>
              <div className="order-2 ml-auto flex items-center gap-2 md:order-3 md:gap-3">
                <NotificationBell userId={user.id} />
                <form action={signOut}>
                  <button
                    type="submit"
                    className="inline-flex h-11 w-11 items-center justify-center rounded-md border border-slate-200 bg-white px-0 text-sm font-semibold text-slate-700 hover:bg-slate-100 hover:text-slate-900 sm:w-auto sm:px-3 md:h-auto md:border-0 md:bg-transparent md:px-0"
                    aria-label="Sign out"
                  >
                    <svg
                      aria-hidden="true"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="h-4 w-4 sm:hidden"
                    >
                      <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
                      <path d="m10 17 5-5-5-5" />
                      <path d="M15 12H3" />
                    </svg>
                    <span className="hidden sm:inline">Sign out</span>
                  </button>
                </form>
              </div>
              <div className="order-3 w-full md:order-2 md:flex-1">
                <GlobalSearchBar />
              </div>
            </div>
          </header>
          <main className="flex-1 min-w-0 overflow-x-hidden px-3 py-4 sm:px-4 sm:py-5 md:px-6 md:py-8">
            {children}
          </main>
        </div>
      </div>
    </div>
  );
}

