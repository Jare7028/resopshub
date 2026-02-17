import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";

function normalizeReturnTo(value: string | null | undefined) {
  const normalized = String(value || "").trim();
  if (!normalized) return "";
  if (!normalized.startsWith("/")) return "";
  if (normalized.startsWith("//")) return "";
  return normalized;
}

export default async function LoginPage(props: {
  searchParams?: Promise<{ error?: string; success?: string; return_to?: string }>;
}) {
  const searchParams = await props.searchParams;
  const returnTo = normalizeReturnTo(searchParams?.return_to);
  const supabase = createSupabaseServerClient();
  const { data: authData } = await supabase.auth.getUser();

  if (authData.user) {
    redirect(returnTo || "/clients");
  }

  async function signIn(formData: FormData) {
    "use server";
    const supabase = createSupabaseServerClient();
    const email = String(formData.get("email") || "").trim();
    const password = String(formData.get("password") || "");
    const returnTo = normalizeReturnTo(String(formData.get("return_to") || ""));
    const loginBase =
      returnTo
        ? `/login?return_to=${encodeURIComponent(returnTo)}`
        : "/login";

    if (!email || !password) {
      redirect(
        `${loginBase}${loginBase.includes("?") ? "&" : "?"}error=Email%20and%20password%20are%20required`
      );
    }

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      redirect(
        `${loginBase}${loginBase.includes("?") ? "&" : "?"}error=${encodeURIComponent(
          error.message
        )}`
      );
    }

    redirect(returnTo || "/clients");
  }

  async function sendPasswordReset(formData: FormData) {
    "use server";
    const supabase = createSupabaseServerClient();
    const email = String(formData.get("email") || "").trim();

    if (!email) {
      redirect("/login?error=Email%20is%20required%20to%20reset%20password");
    }

    const headerList = await headers();
    const origin =
      headerList.get("origin") ||
      process.env.NEXT_PUBLIC_SITE_URL ||
      process.env.NEXT_PUBLIC_VERCEL_URL ||
      "http://localhost:3000";

    const redirectTo = origin.startsWith("http")
      ? `${origin}/reset`
      : `https://${origin}/reset`;

    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo,
    });

    if (error) {
      redirect(`/login?error=${encodeURIComponent(error.message)}`);
    }

    redirect("/login?success=Password%20reset%20email%20sent");
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
      {searchParams?.success ? (
        <p className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-700">
          {searchParams.success}
        </p>
      ) : null}

      <form action={signIn} className="space-y-4">
        <input type="hidden" name="return_to" value={returnTo} />
        <input
          type="email"
          name="email"
          autoComplete="email"
          autoCapitalize="none"
          spellCheck={false}
          placeholder="you@company.com"
          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          required
        />
        <input
          type="password"
          name="password"
          autoComplete="current-password"
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

      <div className="rounded-md border border-slate-200 bg-white p-4">
        <p className="text-sm font-semibold text-slate-900">Forgot password?</p>
        <p className="mt-1 text-xs text-slate-600">
          Enter your email and we&apos;ll send a reset link.
        </p>
        <form action={sendPasswordReset} className="mt-3 flex flex-col gap-2 sm:flex-row">
          <input
            type="email"
            name="email"
            autoComplete="email"
            autoCapitalize="none"
            spellCheck={false}
            placeholder="you@company.com"
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            required
          />
          <button
            type="submit"
            className="rounded-md btn-primary px-4 py-2 text-sm font-semibold text-white"
          >
            Send reset link
          </button>
        </form>
      </div>

      <p className="text-xs text-slate-500">
        If you see &quot;Email logins are disabled&quot;, enable Email auth in Supabase.
      </p>
    </div>
  );
}
