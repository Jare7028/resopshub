"use client";

import { FormEvent, useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

const searchFilterKeys = ["type", "section", "client"] as const;

export default function GlobalSearchBar() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const isSearchPage = pathname === "/search";
  const [query, setQuery] = useState(
    isSearchPage ? searchParams.get("q") || "" : ""
  );

  useEffect(() => {
    if (isSearchPage) {
      setQuery(searchParams.get("q") || "");
    }
  }, [isSearchPage, searchParams]);

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const params = new URLSearchParams();
    const trimmedQuery = query.trim();

    if (trimmedQuery) {
      params.set("q", trimmedQuery);
    }

    if (isSearchPage) {
      searchFilterKeys.forEach((key) => {
        const value = searchParams.get(key);
        if (value) params.set(key, value);
      });
    }

    const nextUrl = params.toString() ? `/search?${params}` : "/search";
    router.push(nextUrl);
  };

  return (
    <form onSubmit={onSubmit} className="w-full">
      <label htmlFor="global-search" className="sr-only">
        Search
      </label>
      <div className="relative">
        <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-slate-400">
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
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </svg>
        </span>
        <input
          id="global-search"
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search notes, tasks, projects, and personal pages..."
          className="h-10 w-full rounded-lg border border-slate-200 bg-white pl-9 pr-3 text-sm text-slate-700 outline-none transition focus:border-slate-300 focus:ring-2 focus:ring-slate-200"
        />
      </div>
    </form>
  );
}
