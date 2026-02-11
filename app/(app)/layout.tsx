import Link from "next/link";
import Image from "next/image";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import PersonalNavSections from "./PersonalNavSections";
import NotificationBell from "./_components/NotificationBell";

const navLinks = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/search", label: "Search" },
  { href: "/clients", label: "Clients" },
  { href: "/projects", label: "Projects" },
  { href: "/tasks", label: "Tasks" },
  { href: "/chat", label: "Chat" },
  { href: "/personal", label: "Personal" },
  { href: "/notes", label: "Notes" },
  { href: "/admin", label: "Admin" },
  { href: "/feature-suggestions", label: "Feature Suggestions" },
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
      const role = count === 0 ? "admin" : "member";

      const fullName =
        (user.user_metadata?.full_name as string | undefined) ||
        (user.user_metadata?.name as string | undefined) ||
        email.split("@")[0] ||
        "Team member";

      const { error: insertError } = await supabase.from("users").insert({
        id: user.id,
        email,
        full_name: fullName,
        role,
        status: "active",
      });

      if (insertError) {
        // Without a profile row keyed by auth.uid(), RLS/FKs can break in confusing ways.
        await supabase.auth.signOut();
        redirect(
          `/login?error=${encodeURIComponent(
            "Profile setup failed. Please contact an admin."
          )}`
        );
      }
    } else if (profile.status === "disabled") {
      await supabase.auth.signOut();
      redirect("/login?error=Account%20disabled");
    }
  }

  async function signOut() {
    "use server";
    const supabase = createSupabaseServerClient();
    await supabase.auth.signOut();
    redirect("/login");
  }

  const { data: personalSections } = await supabase
    .from("personal_sections")
    .select("id,title,sort_order")
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });

  const { data: personalPages } = await supabase
    .from("personal_pages")
    .select("id,title,section_id,updated_at")
    .order("updated_at", { ascending: false });

  return (
    <div className="min-h-screen app-bg text-slate-900">
      <div className="flex min-h-screen">
        <aside className="flex w-64 flex-col border-r app-border app-surface">
          <div className="px-6 py-6">
            <Link href="/clients" className="flex items-center">
              <Image
                src="/logo.png"
                alt="ResOpsHub"
                width={128}
                height={32}
                className="h-8 w-auto"
              />
            </Link>
          </div>
          <nav className="flex-1 px-3">
            <div className="space-y-1">
              {navLinks.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  className="block rounded-md px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 hover:text-slate-900"
                >
                  {link.label}
                </Link>
              ))}
            </div>
            <PersonalNavSections
              sections={personalSections || []}
              pages={personalPages || []}
            />
          </nav>
          <div className="px-3 pb-4">
            <Link
              href="/settings"
              className="group flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 hover:text-slate-900"
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
              <span>Settings</span>
            </Link>
          </div>
        </aside>

        <div className="flex min-h-screen flex-1 flex-col">
          <header className="flex items-center justify-between border-b app-border app-header px-6 py-4">
            <div>
              <p className="text-sm text-slate-500">Signed in as</p>
              <p className="text-sm font-semibold text-slate-900">{email}</p>
            </div>
            <div className="flex items-center gap-3">
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
          </header>
          <main className="flex-1 px-6 py-8">{children}</main>
        </div>
      </div>
    </div>
  );
}

