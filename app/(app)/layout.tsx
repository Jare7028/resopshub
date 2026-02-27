import Image from "next/image";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isSupabaseMissingTableError } from "@/lib/supabaseErrors";
import { withPerfTiming } from "@/lib/perf";
import { type PagePermissionKey } from "@/lib/pagePermissions";
import { APP_SIDEBAR_LINKS, type SidebarNavLink } from "@/lib/appSidebarLinks";
import NotificationBell from "./_components/NotificationBell";
import GlobalSearchBar from "./_components/GlobalSearchBar";
import AppResumeRefresh from "./_components/AppResumeRefresh";
import AppNavLink from "./_components/AppNavLink";
import SidebarNav from "./_components/SidebarNav";

type SidebarNavOrderRow = {
  page_key: string;
  sort_order: number | null;
};

type UserProfileRow = {
  id: string;
  role: string;
  status: string;
};

type LayoutUser = {
  id: string;
  email: string | null;
  user_metadata?: Record<string, unknown> | null;
};

type NavPermissionRow = {
  page_key: PagePermissionKey;
  access_level: "none" | "view" | "edit";
};

const MIDDLEWARE_USER_ID_HEADER = "x-resopshub-user-id";
const MIDDLEWARE_USER_EMAIL_HEADER = "x-resopshub-user-email";
const UUID_V4ISH_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function mergeNavLinksByUserOrder(
  links: readonly SidebarNavLink[],
  orderRows: SidebarNavOrderRow[]
): SidebarNavLink[] {
  const orderedLinks: SidebarNavLink[] = [];
  const linkByPageKey = new Map(links.map((link) => [link.pageKey, link]));
  const seen = new Set<string>();

  const sanitizedOrderRows = orderRows
    .filter((row) => row.sort_order !== null)
    .sort((a, b) => {
      const aSort = Number.isFinite(Number(a.sort_order)) ? Number(a.sort_order) : Number.MAX_SAFE_INTEGER;
      const bSort = Number.isFinite(Number(b.sort_order)) ? Number(b.sort_order) : Number.MAX_SAFE_INTEGER;
      if (aSort !== bSort) return aSort - bSort;
      return String(a.page_key).localeCompare(String(b.page_key));
    });

  for (const row of sanitizedOrderRows) {
    const key = String(row.page_key || "") as PagePermissionKey;
    const link = linkByPageKey.get(key);
    if (!link || seen.has(link.pageKey)) {
      continue;
    }
    orderedLinks.push(link);
    seen.add(link.pageKey);
  }

  links.forEach((link) => {
    if (!seen.has(link.pageKey)) {
      orderedLinks.push(link);
      seen.add(link.pageKey);
    }
  });

  return orderedLinks;
}

export default async function AppLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const supabase = createSupabaseServerClient();
  const headerList = await headers();
  const forwardedUserId = String(headerList.get(MIDDLEWARE_USER_ID_HEADER) || "").trim();
  const forwardedUserEmail = String(headerList.get(MIDDLEWARE_USER_EMAIL_HEADER) || "").trim();

  let user: LayoutUser | null = UUID_V4ISH_REGEX.test(forwardedUserId)
    ? {
        id: forwardedUserId,
        email: forwardedUserEmail || null,
        user_metadata: null,
      }
    : null;

  if (!user) {
    const { data: authData } = await withPerfTiming("layout.auth", () =>
      supabase.auth.getUser()
    );
    user = (authData.user as LayoutUser | null) || null;
  }

  if (!user) {
    redirect("/login");
  }

  const email = user.email || "";
  let currentProfile: { id: string; role: string; status: string } | null = null;
  let pagePermissionByKey = new Map<PagePermissionKey, "none" | "view" | "edit">();

  if (email) {
    const { data: profileData, error: profileError } = await withPerfTiming(
      "layout.profile",
      () => supabase.from("users").select("id,role,status").eq("id", user.id).maybeSingle()
    );
    const profileRow = profileData as UserProfileRow | null;
    if (profileError && !isSupabaseMissingTableError(profileError)) {
      console.error("[layout.profile]", profileError.message);
    }

    if (!profileRow) {
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
    } else if (profileRow.status === "disabled") {
      await supabase.auth.signOut();
      redirect("/login?error=Account%20disabled");
    } else {
      currentProfile = {
        id: profileRow.id,
        role: profileRow.role,
        status: profileRow.status,
      };
      if (profileRow.role !== "admin") {
        const { data: pagePermissionsData, error: pagePermissionsError } = await withPerfTiming(
          "layout.page_permissions",
          () =>
            supabase
              .from("user_page_permissions")
              .select("page_key,access_level")
              .eq("user_id", profileRow.id)
        );

        if (pagePermissionsError) {
          if (!isSupabaseMissingTableError(pagePermissionsError)) {
            console.error("[layout.page_permissions]", pagePermissionsError.message);
          }
        } else {
          const pagePermissions = (pagePermissionsData || []) as NavPermissionRow[];
          pagePermissionByKey = new Map(
            pagePermissions.map((row) => [row.page_key, row.access_level])
          );
        }
      }
    }
  }

  const canViewPage = (pageKey: PagePermissionKey) => {
    if (!currentProfile || currentProfile.role === "admin") {
      return true;
    }
    const explicitAccess = pagePermissionByKey.get(pageKey);
    return (explicitAccess || "edit") !== "none";
  };

  const navBaseLinks = APP_SIDEBAR_LINKS.filter((link) => canViewPage(link.pageKey));

  let navLinks: SidebarNavLink[] = navBaseLinks;
  const { data: navOrderData, error: navOrderError } = await withPerfTiming(
    "layout.app_nav_order",
    () =>
      supabase
        .from("user_sidebar_link_order")
        .select("page_key,sort_order")
        .eq("user_id", user.id)
        .order("sort_order", { ascending: true })
        .order("page_key", { ascending: true })
  );

  if (!navOrderError) {
    navLinks = mergeNavLinksByUserOrder(navBaseLinks, (navOrderData || []) as SidebarNavOrderRow[]);
  } else if (!isSupabaseMissingTableError(navOrderError)) {
    console.error("[layout.app_nav_order]", navOrderError.message);
  }

  const unreadChatCount = 0;

  async function signOut() {
    "use server";
    const supabase = createSupabaseServerClient();
    await supabase.auth.signOut();
    redirect("/login");
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

        <aside className="fixed inset-y-0 left-0 z-40 flex h-screen w-[17.5rem] max-w-[85vw] -translate-x-full flex-col overflow-x-hidden border-r app-border app-surface transition-transform duration-200 peer-checked/drawer:translate-x-0 md:w-64 md:translate-x-0 md:transition-[width] md:duration-200 md:peer-checked/sidebar:w-16 md:peer-checked/sidebar:[&_.nav-label]:hidden md:peer-checked/sidebar:[&_.sidebar-logo]:hidden md:peer-checked/sidebar:[&_.sidebar-mini-logo]:inline-flex md:peer-checked/sidebar:[&_.nav-item]:justify-center md:peer-checked/sidebar:[&_.chat-badge]:absolute md:peer-checked/sidebar:[&_.chat-badge]:right-1 md:peer-checked/sidebar:[&_.chat-badge]:top-1">
          <div className="px-4 py-4 md:py-5">
            <div className="flex items-center justify-between gap-2">
              <AppNavLink href="/clients" prefetch={false} className="flex items-center gap-2">
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

          <SidebarNav links={navLinks} userId={user.id} chatUnreadCount={unreadChatCount} />
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
              <div className="order-3 w-full md:order-2 md:min-w-0 md:flex-1">
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

