"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

const searchFilterKeys = ["type", "section", "client"] as const;

type SuggestionItem = {
  id: string;
  title: string;
  type: "personal" | "task";
  href: string;
  subtitle: string;
  snippet: string;
};

export default function GlobalSearchBar() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const isSearchPage = pathname === "/search";
  const [query, setQuery] = useState(
    isSearchPage ? searchParams.get("q") || "" : ""
  );
  const [suggestions, setSuggestions] = useState<SuggestionItem[]>([]);
  const [isFocused, setIsFocused] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [fetchFailed, setFetchFailed] = useState(false);
  const containerRef = useRef<HTMLFormElement | null>(null);
  const fetchRequestId = useRef(0);
  const trimmedQuery = query.trim();

  const searchPageUrl = useMemo(() => {
    const params = new URLSearchParams();
    if (trimmedQuery) {
      params.set("q", trimmedQuery);
    }
    if (isSearchPage) {
      searchFilterKeys.forEach((key) => {
        const value = searchParams.get(key);
        if (value) params.set(key, value);
      });
    }
    return params.toString() ? `/search?${params}` : "/search";
  }, [isSearchPage, searchParams, trimmedQuery]);

  useEffect(() => {
    if (isSearchPage) {
      setQuery(searchParams.get("q") || "");
    }
  }, [isSearchPage, searchParams]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setIsFocused(false);
      }
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsFocused(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, []);

  useEffect(() => {
    const value = trimmedQuery;
    const requestId = ++fetchRequestId.current;
    setFetchFailed(false);
    if (value.length < 2) {
      setSuggestions([]);
      setIsLoading(false);
      return;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setIsLoading(true);
      try {
        const response = await fetch(
          `/api/search/suggestions?q=${encodeURIComponent(value)}&limit=8`,
          {
            method: "GET",
            signal: controller.signal,
            cache: "no-store",
          }
        );
        if (!response.ok) {
          throw new Error(`Suggestion request failed: ${response.status}`);
        }
        const payload = (await response.json()) as {
          items?: SuggestionItem[];
        };
        if (fetchRequestId.current !== requestId) return;
        setSuggestions(Array.isArray(payload.items) ? payload.items : []);
      } catch (error) {
        if (controller.signal.aborted) return;
        if (fetchRequestId.current !== requestId) return;
        console.error("[global-search.suggestions]", error);
        setSuggestions([]);
        setFetchFailed(true);
      } finally {
        if (fetchRequestId.current === requestId) {
          setIsLoading(false);
        }
      }
    }, 140);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [trimmedQuery]);

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsFocused(false);
    router.push(searchPageUrl);
  };

  const showSuggestions =
    isFocused &&
    trimmedQuery.length >= 2 &&
    (isLoading || fetchFailed || suggestions.length > 0);

  const openSuggestion = (href: string) => {
    setIsFocused(false);
    router.push(href);
  };

  return (
    <form onSubmit={onSubmit} className="w-full" ref={containerRef}>
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
          onFocus={() => setIsFocused(true)}
          placeholder="Search tasks, notes, projects, and more..."
          className="h-11 w-full rounded-xl border border-slate-200 bg-white pl-9 pr-3 text-sm text-slate-700 shadow-sm outline-none transition focus:border-slate-300 focus:ring-2 focus:ring-slate-200"
        />
        {showSuggestions ? (
          <div className="absolute left-0 right-0 top-full z-40 mt-1.5 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg">
            {isLoading ? (
              <p className="px-3 py-2 text-sm text-slate-500">Searching...</p>
            ) : null}
            {fetchFailed ? (
              <p className="px-3 py-2 text-sm text-slate-500">
                Could not load suggestions. Press Enter to search.
              </p>
            ) : null}
            {!isLoading && !fetchFailed && suggestions.length ? (
              <ul className="max-h-72 overflow-y-auto py-1">
                {suggestions.map((item) => (
                  <li key={`${item.type}-${item.id}`}>
                    <button
                      type="button"
                      onClick={() => openSuggestion(item.href)}
                      className="w-full px-3 py-2.5 text-left hover:bg-slate-50"
                    >
                      <p className="truncate text-sm font-semibold text-slate-900">{item.title}</p>
                      <p className="truncate text-xs text-slate-500">{item.subtitle}</p>
                      {item.snippet ? (
                        <p className="truncate text-xs text-slate-600">{item.snippet}</p>
                      ) : null}
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
            <div className="border-t border-slate-200 bg-slate-50 px-3 py-2">
              <button
                type="button"
                onClick={() => openSuggestion(searchPageUrl)}
                className="text-xs font-semibold text-slate-700 hover:text-slate-900"
              >
                See all results for &quot;{trimmedQuery}&quot;
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </form>
  );
}
