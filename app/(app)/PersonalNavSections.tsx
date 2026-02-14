"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState, useTransition } from "react";

type Section = {
  id: string;
  title: string;
};

type Page = {
  id: string;
  title: string;
  section_id: string | null;
  sort_order?: number | null;
};

type ContextMenuState = {
  open: boolean;
  x: number;
  y: number;
  pageId: string;
  pageTitle: string;
};

const defaultContextMenuState: ContextMenuState = {
  open: false,
  x: 0,
  y: 0,
  pageId: "",
  pageTitle: "",
};

function normalizeSearchTerm(value: string) {
  return value.trim().toLowerCase();
}

export default function PersonalNavSections({
  sections,
  pages,
}: {
  sections: Section[];
  pages: Page[];
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [query, setQuery] = useState("");
  const [duplicateError, setDuplicateError] = useState("");
  const [duplicatePending, setDuplicatePending] = useState(false);
  const [contextMenu, setContextMenu] = useState<ContextMenuState>(defaultContextMenuState);
  const isPersonalPath = pathname?.startsWith("/personal");
  const normalizedQuery = useMemo(() => normalizeSearchTerm(query), [query]);
  const matchesQuery = useCallback(
    (value: string | null | undefined) =>
      normalizeSearchTerm(String(value || "")).includes(normalizedQuery),
    [normalizedQuery]
  );

  const generalPages = useMemo(() => {
    return pages.filter((page) => !page.section_id);
  }, [pages]);

  const filteredGeneralPages = useMemo(() => {
    if (!normalizedQuery) {
      return generalPages;
    }
    return generalPages.filter((page) => matchesQuery(page.title));
  }, [generalPages, normalizedQuery, matchesQuery]);

  const grouped = useMemo(() => {
    return sections
      .map((section) => {
        const sectionPages = pages.filter((page) => page.section_id === section.id);
        if (!normalizedQuery) {
          return { section, pages: sectionPages };
        }
        const sectionMatch = matchesQuery(section.title);
        const matchingPages = sectionPages.filter((page) => matchesQuery(page.title));
        return {
          section,
          pages: sectionMatch ? sectionPages : matchingPages,
        };
      })
      .filter((group) => !normalizedQuery || matchesQuery(group.section.title) || group.pages.length);
  }, [sections, pages, normalizedQuery, matchesQuery]);

  const hasResults =
    !normalizedQuery || filteredGeneralPages.length > 0 || grouped.some((group) => group.pages.length > 0 || matchesQuery(group.section.title));

  useEffect(() => {
    if (!contextMenu.open) {
      return;
    }

    const close = () => setContextMenu(defaultContextMenuState);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        close();
      }
    };

    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);

    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [contextMenu.open]);

  const duplicatePage = async () => {
    if (!contextMenu.pageId || duplicatePending) {
      return;
    }
    setDuplicateError("");
    setDuplicatePending(true);
    try {
      const response = await fetch(`/api/personal/pages/${contextMenu.pageId}/duplicate`, {
        method: "POST",
      });
      const payload = (await response.json()) as { id?: string; error?: string };
      if (!response.ok || !payload.id) {
        throw new Error(payload.error || "Unable to duplicate page");
      }
      const nextPageId = payload.id;
      setContextMenu(defaultContextMenuState);
      startTransition(() => {
        router.push(`/personal/${nextPageId}`);
        router.refresh();
      });
    } catch (error) {
      setDuplicateError(String((error as Error).message || error));
    } finally {
      setDuplicatePending(false);
    }
  };

  const pageLinkClass = (pageId: string) =>
    `block rounded-md px-2 py-1 text-sm ${
      pathname === `/personal/${pageId}`
        ? "bg-slate-100 text-slate-900"
        : "text-slate-600 hover:bg-slate-50"
    }`;

  if (!isPersonalPath) {
    return null;
  }

  return (
    <div className="mt-6 border-t app-border pt-4">
      <div className="space-y-2 px-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
          Personal sections
        </p>
        <label className="sr-only" htmlFor="personal-nav-search">
          Search personal pages and sections
        </label>
        <input
          id="personal-nav-search"
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search pages & sections..."
          className="h-8 w-full rounded-md border border-slate-200 bg-white px-2.5 text-xs text-slate-700 outline-none transition focus:border-slate-300 focus:ring-2 focus:ring-slate-200"
        />
        {duplicateError ? (
          <p className="text-[11px] text-red-600">{duplicateError}</p>
        ) : null}
      </div>
      <div className="mt-2 space-y-3 px-3">
        <Link
          href="/personal"
          className={`block rounded-md px-2 py-1 text-sm ${
            pathname === "/personal"
              ? "bg-slate-100 text-slate-900"
              : "text-slate-600 hover:bg-slate-50"
          }`}
        >
          All pages
        </Link>

        {filteredGeneralPages.length ? (
          <div className="space-y-1">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
              General
            </p>
            {filteredGeneralPages.map((page) => (
              <div
                key={page.id}
                onContextMenu={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  setContextMenu({
                    open: true,
                    x: event.clientX,
                    y: event.clientY,
                    pageId: page.id,
                    pageTitle: page.title || "Untitled",
                  });
                }}
              >
                <Link href={`/personal/${page.id}`} className={pageLinkClass(page.id)}>
                  {page.title || "Untitled"}
                </Link>
              </div>
            ))}
          </div>
        ) : null}

        {grouped.map((group) => (
          <div key={group.section.id} className="space-y-1">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
              {group.section.title}
            </p>
            {group.pages.length ? (
              group.pages.map((page) => (
                <div
                  key={page.id}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    setContextMenu({
                      open: true,
                      x: event.clientX,
                      y: event.clientY,
                      pageId: page.id,
                      pageTitle: page.title || "Untitled",
                    });
                  }}
                >
                  <Link href={`/personal/${page.id}`} className={pageLinkClass(page.id)}>
                    {page.title || "Untitled"}
                  </Link>
                </div>
              ))
            ) : (
              <p className="text-xs text-slate-400">No pages yet</p>
            )}
          </div>
        ))}

        {!hasResults ? (
          <p className="rounded-md border border-slate-200 bg-slate-50 px-2 py-2 text-xs text-slate-500">
            No pages or sections match your search.
          </p>
        ) : null}
      </div>

      {contextMenu.open ? (
        <div
          className="fixed z-[70] w-48 rounded-md border border-slate-200 bg-white p-1 shadow-lg"
          style={{ top: contextMenu.y, left: contextMenu.x }}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <p className="px-2 py-1 text-[11px] text-slate-400">{contextMenu.pageTitle}</p>
          <button
            type="button"
            onClick={duplicatePage}
            disabled={duplicatePending}
            className="context-menu-item"
          >
            {duplicatePending ? "Duplicating..." : "Duplicate page"}
          </button>
        </div>
      ) : null}
    </div>
  );
}
