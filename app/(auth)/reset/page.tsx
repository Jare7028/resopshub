"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

export default function ResetPasswordPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    const init = async () => {
      const hash = window.location.hash.startsWith("#")
        ? window.location.hash.slice(1)
        : "";
      const params = new URLSearchParams(hash);
      const accessToken = params.get("access_token");
      const refreshToken = params.get("refresh_token");

      if (accessToken && refreshToken) {
        await supabase.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken,
        });
        window.history.replaceState(null, "", window.location.pathname);
      }

      const { data } = await supabase.auth.getSession();
      if (!data.session) {
        setError("This reset link is invalid or has expired. Request a new one.");
      }
      setReady(true);
    };

    void init();
  }, []);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setSuccess(null);

    if (!password || password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }

    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }

    const { error } = await supabase.auth.updateUser({ password });
    if (error) {
      setError(error.message);
      return;
    }

    await supabase.auth.signOut();
    setSuccess("Password updated. Redirecting to login...");
    setTimeout(() => {
      router.push("/login?success=Password%20updated");
    }, 1200);
  };

  return (
    <div className="mx-auto w-full max-w-md space-y-6 rounded-lg border border-slate-200 bg-white p-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Reset password</h1>
        <p className="mt-2 text-sm text-slate-600">
          Enter a new password for your account.
        </p>
      </div>

      {!ready ? (
        <p className="text-sm text-slate-500">Preparing reset...</p>
      ) : null}

      {error ? (
        <p className="rounded-md border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}
      {success ? (
        <p className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-700">
          {success}
        </p>
      ) : null}

      <form onSubmit={handleSubmit} className="space-y-4">
        <input
          type="password"
          name="password"
          placeholder="New password"
          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          required
        />
        <input
          type="password"
          name="confirm_password"
          placeholder="Confirm new password"
          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          value={confirm}
          onChange={(event) => setConfirm(event.target.value)}
          required
        />
        <button
          type="submit"
          className="w-full rounded-md btn-primary px-4 py-2 text-sm font-semibold text-white"
        >
          Update password
        </button>
      </form>
    </div>
  );
}
