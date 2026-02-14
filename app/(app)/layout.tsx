import Link from "next/link";
import Image from "next/image";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isSupabaseMissingTableError } from "@/lib/supabaseErrors";
import PersonalNavSections from "./PersonalNavSections";
import NotificationBell from "./_components/NotificationBell";
import ChatNavLink from "./_components/ChatNavLink";
import GlobalSearchBar from "./_components/GlobalSearchBar";

type NavIconName =
  | "dashboard"
  | "clients"
  | "projects"
  | "tasks"
  | "forms"
  | "chat"
  | "personal"
  | "notes"
  | "featureSuggestions";

type NavLink = {
  href: string;
  label: string;
  icon: NavIconName;
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
    default:
      return null;
  }
}

const baseNavLinks: NavLink[] = [
  { href: "/dashboard", label: "Dashboard", icon: "dashboard" },
  { href: "/clients", label: "Clients", icon: "clients" },
  { href: "/projects", label: "Projects", icon: "projects" },
  { href: "/tasks", label: "Tasks", icon: "tasks" },
  { href: "/forms", label: "Forms", icon: "forms" },
  { href: "/chat", label: "Chat", icon: "chat" },
  { href: "/personal", label: "Personal", icon: "personal" },
  { href: "/notes", label: "Notes", icon: "notes" },
  {
    href: "/feature-suggestions",
    label: "Feature Suggestions",
    icon: "featureSuggestions",
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
    }
  }

  const navLinks = baseNavLinks;

  async function signOut() {
    "use server";
    const supabase = createSupabaseServerClient();
    await supabase.auth.signOut();
    redirect("/login");
  }

  const { data: personalSections } = await supabase
    .from("personal_sections")
    .select("id,title,owner_id,sort_order")
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });

  let personalPages: Array<{
    id: string;
    title: string;
    owner_id: string;
    section_id: string | null;
    updated_at: string | null;
    sort_order?: number | null;
  }> = [];
  const { data: personalPagesWithSortRaw, error: personalPagesWithSortError } = await supabase
    .from("personal_pages")
    .select("id,title,owner_id,section_id,updated_at,sort_order")
    .order("section_id", { ascending: true, nullsFirst: true })
    .order("sort_order", { ascending: true })
    .order("updated_at", { ascending: false });

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
  const { data: myMembershipsRaw, error: myMembershipsError } = await supabase
    .from("chat_conversation_members")
    .select("conversation_id,last_read_at")
    .eq("user_id", user.id);

  if (!myMembershipsError && (myMembershipsRaw || []).length) {
    const myMemberships = (myMembershipsRaw || []) as Array<{
      conversation_id: string;
      last_read_at: string | null;
    }>;
    const conversationIds = myMemberships
      .map((row) => row.conversation_id)
      .filter(Boolean);
    const lastReadByConversationId = myMemberships.reduce<Record<string, string | null>>(
      (acc, row) => {
        acc[row.conversation_id] = row.last_read_at || null;
        return acc;
      },
      {}
    );

    const unreadCounts = await Promise.all(
      conversationIds.map(async (conversationId) => {
        const lastReadAt = lastReadByConversationId[conversationId];
        let query = supabase
          .from("chat_messages")
          .select("id", { count: "exact", head: true })
          .eq("conversation_id", conversationId)
          .neq("sender_id", user.id);
        if (lastReadAt) {
          query = query.gt("created_at", lastReadAt);
        }
        const { count } = await query;
        return count || 0;
      })
    );

    unreadChatCount = unreadCounts.reduce((sum, count) => sum + count, 0);
  } else if (myMembershipsError && !isSupabaseMissingTableError(myMembershipsError)) {
    unreadChatCount = 0;
  }

  return (
    <div className="min-h-screen overflow-x-hidden app-bg text-slate-900">
      <div className="relative min-h-screen overflow-x-hidden">
        <input id="app-sidebar-collapsed" type="checkbox" className="peer sr-only" />

        <aside className="fixed inset-y-0 left-0 z-30 flex h-screen w-64 flex-col overflow-x-hidden border-r app-border app-surface transition-[width] duration-200 peer-checked:w-16 peer-checked:[&_.nav-label]:hidden peer-checked:[&_.personal-nav-sections]:hidden peer-checked:[&_.sidebar-logo]:hidden peer-checked:[&_.sidebar-mini-logo]:inline-flex peer-checked:[&_.nav-item]:justify-center peer-checked:[&_.chat-badge]:absolute peer-checked:[&_.chat-badge]:right-1 peer-checked:[&_.chat-badge]:top-1">
          <div className="px-4 py-5">
            <div className="flex items-center justify-between gap-2">
              <Link href="/clients" className="flex items-center gap-2">
                <Image
                  src="/logo.png"
                  alt="ResOpsHub"
                  width={128}
                  height={32}
                  className="sidebar-logo h-8 w-auto"
                />
                <span className="sidebar-mini-logo hidden h-8 w-8 items-center justify-center rounded-md bg-slate-900 text-sm font-bold text-white">
                  R
                </span>
              </Link>
              <label
                htmlFor="app-sidebar-collapsed"
                className="inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-md border border-slate-200 text-slate-600 hover:bg-slate-100 hover:text-slate-900"
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
                  className="h-4 w-4 transition-transform peer-checked:rotate-180"
                >
                  <path d="m15 18-6-6 6-6" />
                </svg>
              </label>
            </div>
          </div>

          <nav className="min-h-0 flex-1 overflow-y-auto px-3">
            <div className="space-y-1">
              {navLinks.map((link) =>
                link.href === "/chat" ? (
                  <ChatNavLink
                    key={link.href}
                    initialUnreadCount={unreadChatCount}
                    userId={user.id}
                    className="nav-item"
                    labelClassName="nav-label"
                    badgeClassName="chat-badge"
                  />
                ) : (
                  <Link
                    key={link.href}
                    href={link.href}
                    className="nav-item relative flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 hover:text-slate-900"
                    title={link.label}
                    aria-label={link.label}
                  >
                    <SidebarIcon name={link.icon} />
                    <span className="nav-label">{link.label}</span>
                  </Link>
                )
              )}
            </div>
            <div className="personal-nav-sections">
              <PersonalNavSections
                currentUserId={user.id}
                sections={personalSections || []}
                pages={personalPages || []}
              />
            </div>
          </nav>

          <div className="px-3 pb-4">
            <Link
              href="/settings"
              className="nav-item group flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 hover:text-slate-900"
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
            </Link>
          </div>
        </aside>

        <div className="flex min-h-screen min-w-0 flex-col overflow-x-hidden pl-64 transition-[padding] duration-200 peer-checked:pl-16">
          <header className="border-b app-border app-header px-6 py-4">
            <div className="flex flex-wrap items-center gap-4">
              <div className="min-w-[12rem]">
                <p className="text-sm text-slate-500">Signed in as</p>
                <p className="text-sm font-semibold text-slate-900">{email}</p>
              </div>
              <div className="order-3 w-full md:order-2 md:flex-1">
                <GlobalSearchBar />
              </div>
              <div className="order-2 ml-auto flex items-center gap-3 md:order-3">
                <NotificationBell userId={user.id} />
                <form action={signOut}>
                  <button
                    type="submit"
                    className="text-sm font-semibold text-slate-700 hover:text-slate-900"
                  >
                    Sign out
                  </button>
                </form>
              </div>
            </div>
          </header>
          <main className="flex-1 min-w-0 overflow-x-hidden px-6 py-8">{children}</main>
        </div>
      </div>
    </div>
  );
}

