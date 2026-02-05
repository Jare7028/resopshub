import Link from "next/link";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import PersonalNavSections from "./PersonalNavSections";

const navLinks = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/search", label: "Search" },
  { href: "/clients", label: "Clients" },
  { href: "/projects", label: "Projects" },
  { href: "/tasks", label: "Tasks" },
  { href: "/personal", label: "Personal" },
  { href: "/notes", label: "Notes" },
  { href: "/admin", label: "Admin" },
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

      await supabase.from("users").insert({
        id: user.id,
        email,
        role,
        status: "active",
      });
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
        <aside className="w-64 border-r app-border app-surface">
          <div className="px-6 py-6">
            <Link href="/clients" className="flex items-center">
              <img src="/logo.png" alt="ResOpsHub" className="h-8 w-auto" />
            </Link>
          </div>
          <nav className="px-3">
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
        </aside>

        <div className="flex min-h-screen flex-1 flex-col">
          <header className="flex items-center justify-between border-b app-border app-header px-6 py-4">
            <div>
              <p className="text-sm text-slate-500">Signed in as</p>
              <p className="text-sm font-semibold text-slate-900">{email}</p>
            </div>
            <form action={signOut}>
              <button
                type="submit"
                className="text-sm font-semibold text-slate-700 hover:text-slate-900"
              >
                Sign out
              </button>
            </form>
          </header>
          <main className="flex-1 px-6 py-8">{children}</main>
        </div>
      </div>
    </div>
  );
}
