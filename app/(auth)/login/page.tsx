import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export default async function LoginPage({
  searchParams,
}: {
  searchParams?: { error?: string };
}) {
  const supabase = createSupabaseServerClient();
  const { data: authData } = await supabase.auth.getUser();

  if (authData.user) {
    redirect("/clients");
  }

  async function signIn(formData: FormData) {
    "use server";
    const supabase = createSupabaseServerClient();
    const email = String(formData.get("email") || "").trim();
    const password = String(formData.get("password") || "");

    if (!email || !password) {
      redirect("/login?error=Email%20and%20password%20are%20required");
    }

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      redirect(`/login?error=${encodeURIComponent(error.message)}`);
    }

    redirect("/clients");
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Sign in</h1>
        <p className="mt-2 text-sm text-slate-600">
          Use your ResOpsHub account to continue.
        </p>
      </div>

      {searchParams?.error ? (
        <p className="rounded-md border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
          {searchParams.error}
        </p>
      ) : null}

      <form action={signIn} className="space-y-4">
        <input
          type="email"
          name="email"
          placeholder="you@company.com"
          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          required
        />
        <input
          type="password"
          name="password"
          placeholder="Password"
          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          required
        />
        <button
          type="submit"
          className="w-full rounded-md btn-primary px-4 py-2 text-sm font-semibold text-white "
        >
          Sign in
        </button>
      </form>

      <p className="text-xs text-slate-500">
        If you see "Email logins are disabled", enable Email auth in Supabase.
      </p>
    </div>
  );
}

