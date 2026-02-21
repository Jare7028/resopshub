"use client";

import Link from "next/link";
import { useEffect } from "react";

export default function SocialError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[social.route.error]", error);
  }, [error]);

  return (
    <div className="mx-auto max-w-3xl space-y-4 rounded-2xl border border-red-200 bg-white p-6 shadow-sm">
      <h1 className="text-xl font-semibold text-slate-900">Social is temporarily unavailable</h1>
      <p className="text-sm text-slate-700">
        We hit an unexpected server error while loading this page. Please retry.
      </p>
      {error.digest ? (
        <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
          Error digest: {error.digest}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={reset}
          className="rounded-md btn-primary px-4 py-2 text-sm font-semibold text-white"
        >
          Try again
        </button>
        <Link
          href="/social"
          className="rounded-md border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:border-slate-400 hover:text-slate-900"
        >
          Back to Social
        </Link>
      </div>
    </div>
  );
}
