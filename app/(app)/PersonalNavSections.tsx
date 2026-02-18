"use client";

import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import AppNavLink from "./_components/AppNavLink";

type Section = {
  id: string;
  title: string;
  owner_id: string;
};

type Page = {
  id: string;
  title: string;
  owner_id: string;
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

type DragState = { kind: "section"; sectionId: string } | { kind: "page"; pageId: string };

const defaultContextMenuState: ContextMenuState = {
  open: false,
  x: 0,
  y: 0,
  pageId: "",
  pageTitle: "",
};

const GENERAL_SECTION_KEY = "__general__";

function normalizeSearchTerm(value: string) {
  return value.trim().toLowerCase();
}

function getSectionKey(sectionId: string | null) {
  return sectionId || GENERAL_SECTION_KEY;
}

function clonePagesBySection(pagesBySection: Record<string, Page[]>) {
  return Object.fromEntries(
    Object.entries(pagesBySection).map(([sectionKey, sectionPages]) => [
      sectionKey,
      [...sectionPages],
    ])
  ) as Record<string, Page[]>;
}

function buildPagesBySection(pages: Page[]) {
  const next: Record<string, Page[]> = {};
  for (const page of pages) {
    const sectionKey = getSectionKey(page.section_id);
    next[sectionKey] ||= [];
    next[sectionKey].push(page);
  }
  return next;
}

function findPageLocation(pagesBySection: Record<string, Page[]>, pageId: string) {
  for (const [sectionKey, sectionPages] of Object.entries(pagesBySection)) {
    const index = sectionPages.findIndex((page) => page.id === pageId);
    if (index >= 0) {
      return { sectionKey, index };
    }
  }
  return null;
}

function pageMapSignature(pagesBySection: Record<string, Page[]>) {
  return Object.keys(pagesBySection)
    .sort()
    .map((sectionKey) => {
      const ids = (pagesBySection[sectionKey] || []).map((page) => page.id).join(",");
      return `${sectionKey}:${ids}`;
    })
    .join("|");
}

function moveSectionBefore(
  sections: Section[],
  sectionId: string,
  beforeSectionId: string | null
) {
  const fromIndex = sections.findIndex((section) => section.id === sectionId);
  if (fromIndex < 0) {
    return { changed: false, next: sections };
  }

  const next = [...sections];
  const [movingSection] = next.splice(fromIndex, 1);
  if (!movingSection) {
    return { changed: false, next: sections };
  }

  let targetIndex = beforeSectionId
    ? next.findIndex((section) => section.id === beforeSectionId)
    : next.length;
  if (targetIndex < 0) {
    targetIndex = next.length;
  }

  next.splice(targetIndex, 0, movingSection);

  const beforeIds = sections.map((section) => section.id).join("|");
  const afterIds = next.map((section) => section.id).join("|");
  return {
    changed: beforeIds !== afterIds,
    next,
  };
}

function movePage(
  pagesBySection: Record<string, Page[]>,
  pageId: string,
  targetSectionId: string | null,
  beforePageId: string | null
) {
  const source = findPageLocation(pagesBySection, pageId);
  if (!source) {
    return { changed: false, next: pagesBySection };
  }

  const next = clonePagesBySection(pagesBySection);
  const sourcePages = next[source.sectionKey] || [];
  const sourceIndex = sourcePages.findIndex((page) => page.id === pageId);
  if (sourceIndex < 0) {
    return { changed: false, next: pagesBySection };
  }

  const [movingPage] = sourcePages.splice(sourceIndex, 1);
  if (!movingPage) {
    return { changed: false, next: pagesBySection };
  }

  if (sourcePages.length) {
    next[source.sectionKey] = sourcePages;
  } else {
    delete next[source.sectionKey];
  }

  const targetSectionKey = getSectionKey(targetSectionId);
  const targetPages =
    targetSectionKey === source.sectionKey ? sourcePages : [...(next[targetSectionKey] || [])];
  const safeBeforePageId =
    beforePageId && beforePageId !== movingPage.id ? beforePageId : null;
  const beforeIndex = safeBeforePageId
    ? targetPages.findIndex((page) => page.id === safeBeforePageId)
    : -1;
  const insertIndex = beforeIndex >= 0 ? beforeIndex : targetPages.length;

  targetPages.splice(insertIndex, 0, {
    ...movingPage,
    section_id: targetSectionId,
  });
  next[targetSectionKey] = targetPages;

  return {
    changed: pageMapSignature(pagesBySection) !== pageMapSignature(next),
    next,
  };
}

export default function PersonalNavSections({
  currentUserId,
  sections,
  pages,
}: {
  currentUserId: string;
  sections: Section[];
  pages: Page[];
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [query, setQuery] = useState("");
  const [duplicateError, setDuplicateError] = useState("");
  const [reorderError, setReorderError] = useState("");
  const [duplicatePending, setDuplicatePending] = useState(false);
  const [contextMenu, setContextMenu] = useState<ContextMenuState>(defaultContextMenuState);
  const [sectionItems, setSectionItems] = useState<Section[]>(sections);
  const [pagesBySection, setPagesBySection] = useState<Record<string, Page[]>>(() =>
    buildPagesBySection(pages)
  );
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [dragOverTarget, setDragOverTarget] = useState("");

  const isPersonalPath = pathname?.startsWith("/personal");
  const normalizedQuery = useMemo(() => normalizeSearchTerm(query), [query]);
  const dragAndDropEnabled = !normalizedQuery;
  const matchesQuery = useCallback(
    (value: string | null | undefined) =>
      normalizeSearchTerm(String(value || "")).includes(normalizedQuery),
    [normalizedQuery]
  );

  const canManageSection = useCallback(
    (section: Section) => section.owner_id === currentUserId,
    [currentUserId]
  );
  const canManagePage = useCallback(
    (page: Page | null | undefined) => Boolean(page && page.owner_id === currentUserId),
    [currentUserId]
  );

  useEffect(() => {
    setSectionItems(sections);
  }, [sections]);

  useEffect(() => {
    setPagesBySection(buildPagesBySection(pages));
  }, [pages]);

  const allPagesById = useMemo(() => {
    const next = new Map<string, Page>();
    Object.values(pagesBySection).forEach((sectionPages) => {
      sectionPages.forEach((page) => {
        next.set(page.id, page);
      });
    });
    return next;
  }, [pagesBySection]);

  const generalPages = useMemo(() => {
    return pagesBySection[GENERAL_SECTION_KEY] || [];
  }, [pagesBySection]);

  const filteredGeneralPages = useMemo(() => {
    if (!normalizedQuery) {
      return generalPages;
    }
    return generalPages.filter((page) => matchesQuery(page.title));
  }, [generalPages, normalizedQuery, matchesQuery]);

  const grouped = useMemo(() => {
    return sectionItems
      .map((section) => {
        const sectionPages = pagesBySection[section.id] || [];
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
  }, [sectionItems, pagesBySection, normalizedQuery, matchesQuery]);

  const hasResults =
    !normalizedQuery ||
    filteredGeneralPages.length > 0 ||
    grouped.some((group) => group.pages.length > 0 || matchesQuery(group.section.title));

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

  const persistSectionReorder = async (
    sectionId: string,
    beforeSectionId: string | null
  ) => {
    const response = await fetch("/api/personal/sections/reorder", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sectionId, beforeSectionId }),
    });
    const payload = (await response.json()) as { ok?: boolean; error?: string };
    if (!response.ok || !payload.ok) {
      throw new Error(payload.error || "Unable to reorder sections");
    }
  };

  const persistPageReorder = async (
    pageId: string,
    targetSectionId: string | null,
    beforePageId: string | null
  ) => {
    const response = await fetch("/api/personal/pages/reorder", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pageId, targetSectionId, beforePageId }),
    });
    const payload = (await response.json()) as { ok?: boolean; error?: string };
    if (!response.ok || !payload.ok) {
      throw new Error(payload.error || "Unable to reorder pages");
    }
  };

  const canDropPageIntoSection = useCallback(
    (sectionId: string | null) => {
      if (!dragAndDropEnabled || !dragState || dragState.kind !== "page") {
        return false;
      }
      const draggedPage = allPagesById.get(dragState.pageId);
      if (!canManagePage(draggedPage)) {
        return false;
      }
      if (!sectionId) {
        return true;
      }
      const targetSection = sectionItems.find((section) => section.id === sectionId);
      return Boolean(targetSection && canManageSection(targetSection));
    },
    [
      dragAndDropEnabled,
      dragState,
      allPagesById,
      canManagePage,
      sectionItems,
      canManageSection,
    ]
  );

  const canDropSectionBefore = useCallback(
    (beforeSectionId: string | null) => {
      if (!dragAndDropEnabled || !dragState || dragState.kind !== "section") {
        return false;
      }
      const draggingSection = sectionItems.find(
        (section) => section.id === dragState.sectionId
      );
      if (!draggingSection || !canManageSection(draggingSection)) {
        return false;
      }
      if (!beforeSectionId) {
        return true;
      }
      const targetSection = sectionItems.find((section) => section.id === beforeSectionId);
      return Boolean(targetSection && canManageSection(targetSection));
    },
    [dragAndDropEnabled, dragState, sectionItems, canManageSection]
  );

  const handleSectionDrop = async (beforeSectionId: string | null) => {
    if (!dragState || dragState.kind !== "section") {
      return;
    }
    const sectionId = dragState.sectionId;
    const currentSection = sectionItems.find((section) => section.id === sectionId);
    if (!currentSection || !canManageSection(currentSection)) {
      setDragState(null);
      setDragOverTarget("");
      return;
    }

    const { changed, next } = moveSectionBefore(sectionItems, sectionId, beforeSectionId);
    setDragState(null);
    setDragOverTarget("");
    if (!changed) {
      return;
    }

    const previousSections = sectionItems;
    setSectionItems(next);
    setReorderError("");

    try {
      await persistSectionReorder(sectionId, beforeSectionId);
      startTransition(() => {
        router.refresh();
      });
    } catch (error) {
      setSectionItems(previousSections);
      setReorderError(String((error as Error).message || error));
    }
  };

  const handlePageDrop = async (
    targetSectionId: string | null,
    beforePageId: string | null
  ) => {
    if (!dragState || dragState.kind !== "page") {
      return;
    }
    const pageId = dragState.pageId;
    const draggingPage = allPagesById.get(pageId);
    if (!canManagePage(draggingPage) || !canDropPageIntoSection(targetSectionId)) {
      setDragState(null);
      setDragOverTarget("");
      return;
    }

    const { changed, next } = movePage(
      pagesBySection,
      pageId,
      targetSectionId,
      beforePageId
    );
    setDragState(null);
    setDragOverTarget("");
    if (!changed) {
      return;
    }

    const previousPagesBySection = pagesBySection;
    setPagesBySection(next);
    setReorderError("");

    try {
      await persistPageReorder(pageId, targetSectionId, beforePageId);
      startTransition(() => {
        router.refresh();
      });
    } catch (error) {
      setPagesBySection(previousPagesBySection);
      setReorderError(String((error as Error).message || error));
    }
  };

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

  const renderPageEntry = (page: Page, targetSectionId: string | null) => {
    const canDragPage = dragAndDropEnabled && canManagePage(page);
    const isPageDropTarget = dragOverTarget === `page-${page.id}`;

    return (
      <div
        key={page.id}
        draggable={canDragPage}
        onDragStart={(event) => {
          if (!canDragPage) return;
          event.dataTransfer.effectAllowed = "move";
          event.dataTransfer.setData("text/plain", page.id);
          setDragState({ kind: "page", pageId: page.id });
          setDragOverTarget("");
          setReorderError("");
        }}
        onDragEnd={() => {
          setDragState(null);
          setDragOverTarget("");
        }}
        onDragOver={(event) => {
          if (!canDropPageIntoSection(targetSectionId)) {
            return;
          }
          event.preventDefault();
          event.stopPropagation();
          setDragOverTarget(`page-${page.id}`);
        }}
        onDrop={(event) => {
          if (!canDropPageIntoSection(targetSectionId)) {
            return;
          }
          event.preventDefault();
          event.stopPropagation();
          void handlePageDrop(targetSectionId, page.id);
        }}
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
        className={isPageDropTarget ? "rounded-md border border-dashed border-violet-400" : undefined}
      >
        <AppNavLink
          href={`/personal/${page.id}`}
          className={`${pageLinkClass(page.id)} ${canDragPage ? "cursor-grab active:cursor-grabbing" : ""}`}
        >
          {page.title || "Untitled"}
        </AppNavLink>
      </div>
    );
  };

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
        {reorderError ? (
          <p className="text-[11px] text-red-600">{reorderError}</p>
        ) : null}
        {!dragAndDropEnabled ? (
          <p className="text-[11px] text-slate-500">
            Clear search to drag and reorder sections or pages.
          </p>
        ) : null}
      </div>
      <div className="mt-2 space-y-3 px-3">
        <AppNavLink
          href="/personal"
          className={`block rounded-md px-2 py-1 text-sm ${
            pathname === "/personal"
              ? "bg-slate-100 text-slate-900"
              : "text-slate-600 hover:bg-slate-50"
          }`}
        >
          All pages
        </AppNavLink>

        {filteredGeneralPages.length ? (
          <div
            className={`space-y-1 rounded-md ${
              dragOverTarget === "section-pages-general"
                ? "border border-dashed border-violet-400 p-1"
                : ""
            }`}
            onDragOver={(event) => {
              if (!canDropPageIntoSection(null)) {
                return;
              }
              event.preventDefault();
              setDragOverTarget("section-pages-general");
            }}
            onDrop={(event) => {
              if (!canDropPageIntoSection(null)) {
                return;
              }
              event.preventDefault();
              event.stopPropagation();
              void handlePageDrop(null, null);
            }}
          >
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
              General
            </p>
            {filteredGeneralPages.map((page) => renderPageEntry(page, null))}
          </div>
        ) : null}

        {grouped.map((group) => (
          <div
            key={group.section.id}
            className={`space-y-1 rounded-md ${
              dragOverTarget === `section-pages-${group.section.id}`
                ? "border border-dashed border-violet-400 p-1"
                : ""
            }`}
            onDragOver={(event) => {
              if (
                dragState?.kind === "section" &&
                canDropSectionBefore(group.section.id)
              ) {
                event.preventDefault();
                setDragOverTarget(`section-before-${group.section.id}`);
                return;
              }
              if (canDropPageIntoSection(group.section.id)) {
                event.preventDefault();
                setDragOverTarget(`section-pages-${group.section.id}`);
              }
            }}
            onDrop={(event) => {
              if (
                dragState?.kind === "section" &&
                canDropSectionBefore(group.section.id)
              ) {
                event.preventDefault();
                event.stopPropagation();
                void handleSectionDrop(group.section.id);
                return;
              }
              if (canDropPageIntoSection(group.section.id)) {
                event.preventDefault();
                event.stopPropagation();
                void handlePageDrop(group.section.id, null);
              }
            }}
          >
            <div
              draggable={dragAndDropEnabled && canManageSection(group.section)}
              onDragStart={(event) => {
                if (!dragAndDropEnabled || !canManageSection(group.section)) {
                  return;
                }
                event.dataTransfer.effectAllowed = "move";
                event.dataTransfer.setData("text/plain", group.section.id);
                setDragState({ kind: "section", sectionId: group.section.id });
                setDragOverTarget("");
                setReorderError("");
              }}
              onDragEnd={() => {
                setDragState(null);
                setDragOverTarget("");
              }}
              className={`flex items-center justify-between rounded-md px-1 ${
                dragOverTarget === `section-before-${group.section.id}`
                  ? "border border-dashed border-violet-400"
                  : ""
              } ${
                dragAndDropEnabled && canManageSection(group.section)
                  ? "cursor-grab active:cursor-grabbing"
                  : ""
              }`}
            >
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                {group.section.title}
              </p>
              {dragAndDropEnabled && canManageSection(group.section) ? (
                <span className="text-[10px] uppercase tracking-wide text-slate-300">
                  Drag
                </span>
              ) : null}
            </div>
            {group.pages.length ? (
              group.pages.map((page) => renderPageEntry(page, group.section.id))
            ) : (
              <p className="text-xs text-slate-400">No pages yet</p>
            )}
          </div>
        ))}

        {dragAndDropEnabled && dragState?.kind === "section" ? (
          <div
            className={`rounded-md border border-dashed px-2 py-1 text-[11px] text-slate-500 ${
              dragOverTarget === "section-end"
                ? "border-violet-400 bg-violet-50 text-violet-700"
                : "border-slate-300"
            }`}
            onDragOver={(event) => {
              if (!canDropSectionBefore(null)) {
                return;
              }
              event.preventDefault();
              setDragOverTarget("section-end");
            }}
            onDrop={(event) => {
              if (!canDropSectionBefore(null)) {
                return;
              }
              event.preventDefault();
              event.stopPropagation();
              void handleSectionDrop(null);
            }}
          >
            Drop section here to move it to the end.
          </div>
        ) : null}

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
