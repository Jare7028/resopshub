"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  createPersonalPage,
  createPersonalSection,
  deletePersonalPageInline,
  deletePersonalSection,
  renamePersonalPage,
  renamePersonalSection,
  reorderPersonalTreeNode,
  upsertPersonalPageUserState,
} from "../workspaceActions";
import type { PersonalTreePage, PersonalTreeSection } from "../types";

type PersonalSidebarTreeProps = {
  sections: PersonalTreeSection[];
  generalPages: PersonalTreePage[];
  currentPageId?: string | null;
  persistPageId?: string | null;
  initialCollapsed?: boolean;
  pageStateByPageId?: Record<string, { is_favorite?: boolean }>;
};

type DraggedPage = {
  pageId: string;
  sectionId: string | null;
};

function reorderInList<T extends { id: string }>(
  list: T[],
  draggedId: string,
  targetId: string
) {
  const fromIndex = list.findIndex((item) => item.id === draggedId);
  const toIndex = list.findIndex((item) => item.id === targetId);
  if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) {
    return list;
  }
  const next = [...list];
  const [dragged] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, dragged);
  return next;
}

export default function PersonalSidebarTree({
  sections,
  generalPages,
  currentPageId = null,
  persistPageId = null,
  initialCollapsed = false,
  pageStateByPageId = {},
}: PersonalSidebarTreeProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [, startTransition] = useTransition();
  const [collapsed, setCollapsed] = useState(initialCollapsed);
  const [localSections, setLocalSections] = useState(sections);
  const [localGeneralPages, setLocalGeneralPages] = useState(generalPages);
  const [draggedSectionId, setDraggedSectionId] = useState<string | null>(null);
  const [draggedPage, setDraggedPage] = useState<DraggedPage | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteQuery, setPaletteQuery] = useState("");

  useEffect(() => {
    setLocalSections(sections);
  }, [sections]);

  useEffect(() => {
    setLocalGeneralPages(generalPages);
  }, [generalPages]);

  useEffect(() => {
    setCollapsed(initialCollapsed);
  }, [initialCollapsed]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const isShortcut =
        (event.ctrlKey || event.metaKey) &&
        String(event.key || "").toLowerCase() === "k";
      if (!isShortcut) {
        return;
      }
      event.preventDefault();
      setPaletteOpen((prev) => !prev);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const allPages = useMemo(() => {
    return [
      ...localGeneralPages.map((page) => ({ ...page, sectionTitle: "General" })),
      ...localSections.flatMap((section) =>
        section.pages.map((page) => ({ ...page, sectionTitle: section.title }))
      ),
    ];
  }, [localGeneralPages, localSections]);

  const paletteItems = useMemo(() => {
    const query = paletteQuery.trim().toLowerCase();
    if (!query) {
      return allPages.slice(0, 20);
    }
    return allPages
      .filter((page) => {
        const title = String(page.title || "Untitled").toLowerCase();
        const sectionTitle = String(page.sectionTitle || "").toLowerCase();
        return title.includes(query) || sectionTitle.includes(query);
      })
      .slice(0, 20);
  }, [allPages, paletteQuery]);

  const handleToggleCollapsed = () => {
    const next = !collapsed;
    setCollapsed(next);
    if (persistPageId) {
      startTransition(() => {
        void upsertPersonalPageUserState({
          pageId: persistPageId,
          sidebarCollapsed: next,
        });
      });
    }
  };

  const runSectionMutation = (
    action: () => Promise<{ ok: boolean; error?: string; pageId?: string }>
  ) => {
    startTransition(() => {
      void action().then((result) => {
        if (!result.ok) {
          window.alert(result.error || "Unable to update section.");
          return;
        }
        if (result.pageId) {
          router.push(`/personal/${result.pageId}`);
          return;
        }
        router.refresh();
      });
    });
  };

  const handleCreateSection = () => {
    const title = window.prompt("New section name");
    if (!title) return;
    runSectionMutation(() => createPersonalSection({ title }));
  };

  const handleCreatePage = (sectionId: string | null) => {
    const title = window.prompt("New page title");
    if (!title) return;
    runSectionMutation(() => createPersonalPage({ title, sectionId }));
  };

  const handleRenameSection = (sectionId: string, currentTitle: string) => {
    const nextTitle = window.prompt("Rename section", currentTitle);
    if (!nextTitle || nextTitle === currentTitle) return;
    runSectionMutation(() => renamePersonalSection({ sectionId, title: nextTitle }));
  };

  const handleDeleteSection = (sectionId: string, sectionTitle: string) => {
    const confirmed = window.confirm(
      `Delete section "${sectionTitle}"? Pages move to General.`
    );
    if (!confirmed) return;
    runSectionMutation(() => deletePersonalSection({ sectionId }));
  };

  const handleRenamePage = (pageId: string, currentTitle: string | null) => {
    const nextTitle = window.prompt("Rename page", currentTitle || "Untitled");
    if (!nextTitle || nextTitle === currentTitle) return;
    runSectionMutation(() => renamePersonalPage({ pageId, title: nextTitle }));
  };

  const handleDeletePage = (pageId: string, pageTitle: string | null) => {
    const confirmed = window.confirm(
      `Delete page "${pageTitle || "Untitled"}"? This cannot be undone.`
    );
    if (!confirmed) return;
    runSectionMutation(() => deletePersonalPageInline({ pageId }));
  };

  const handleSectionDrop = (targetSectionId: string) => {
    if (!draggedSectionId || draggedSectionId === targetSectionId) return;
    const nextSections = reorderInList(localSections, draggedSectionId, targetSectionId);
    setLocalSections(nextSections);
    setDraggedSectionId(null);
    startTransition(() => {
      void reorderPersonalTreeNode({
        kind: "section",
        orderedIds: nextSections.map((section) => section.id),
      }).then((result) => {
        if (!result.ok) {
          window.alert(result.error || "Unable to reorder sections.");
          router.refresh();
          return;
        }
        router.refresh();
      });
    });
  };

  const handlePageDrop = (targetPageId: string, sectionId: string | null) => {
    if (!draggedPage || draggedPage.sectionId !== sectionId || draggedPage.pageId === targetPageId) {
      return;
    }

    if (sectionId === null) {
      const nextGeneral = reorderInList(localGeneralPages, draggedPage.pageId, targetPageId);
      setLocalGeneralPages(nextGeneral);
      setDraggedPage(null);
      startTransition(() => {
        void reorderPersonalTreeNode({
          kind: "page",
          sectionId: null,
          orderedIds: nextGeneral.map((page) => page.id),
        }).then((result) => {
          if (!result.ok) {
            window.alert(result.error || "Unable to reorder pages.");
            router.refresh();
            return;
          }
          router.refresh();
        });
      });
      return;
    }

    const nextSections = localSections.map((section) => {
      if (section.id !== sectionId) return section;
      return {
        ...section,
        pages: reorderInList(section.pages, draggedPage.pageId, targetPageId),
      };
    });
    setLocalSections(nextSections);
    setDraggedPage(null);
    const targetSection = nextSections.find((section) => section.id === sectionId);
    if (!targetSection) return;

    startTransition(() => {
      void reorderPersonalTreeNode({
        kind: "page",
        sectionId,
        orderedIds: targetSection.pages.map((page) => page.id),
      }).then((result) => {
        if (!result.ok) {
          window.alert(result.error || "Unable to reorder pages.");
          router.refresh();
          return;
        }
        router.refresh();
      });
    });
  };

  const pageItemClass = (pageId: string) =>
    `group flex items-center justify-between gap-2 rounded-md px-2 py-1 text-sm ${
      currentPageId === pageId
        ? "bg-slate-900 text-white"
        : "text-slate-700 hover:bg-slate-100"
    }`;

  return (
    <>
      <aside
        className={`shrink-0 flex h-[calc(100vh-8.5rem)] flex-col overflow-hidden rounded-lg border border-slate-200 bg-white transition-all ${
          collapsed ? "w-16" : "w-80"
        }`}
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-3 py-2">
          {!collapsed ? (
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Personal Workspace
            </p>
          ) : null}
          <div className="flex items-center gap-1">
            {!collapsed ? (
              <>
                <button
                  type="button"
                  onClick={handleCreateSection}
                  className="rounded-md border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-700 hover:border-slate-400"
                >
                  + Section
                </button>
                <button
                  type="button"
                  onClick={() => handleCreatePage(null)}
                  className="rounded-md border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-700 hover:border-slate-400"
                >
                  + Page
                </button>
              </>
            ) : null}
            <button
              type="button"
              onClick={handleToggleCollapsed}
              className="rounded-md border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-700 hover:border-slate-400"
              aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            >
              {collapsed ? ">" : "<"}
            </button>
          </div>
        </div>

        {!collapsed ? (
          <div className="border-b border-slate-200 px-3 py-2">
            <button
              type="button"
              onClick={() => setPaletteOpen(true)}
              className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-left text-xs text-slate-600 hover:border-slate-400"
            >
              Quick switch (Ctrl/Cmd+K)
            </button>
          </div>
        ) : null}

        <div className="flex-1 overflow-y-auto px-2 py-2">
          {!collapsed ? (
            <div className="space-y-2">
              <div className="space-y-1">
                <p className="px-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                  General
                </p>
                {localGeneralPages.map((page) => (
                  <div
                    key={page.id}
                    draggable
                    onDragStart={() =>
                      setDraggedPage({ pageId: page.id, sectionId: null })
                    }
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={() => handlePageDrop(page.id, null)}
                    className={pageItemClass(page.id)}
                  >
                    <Link
                      href={`/personal/${page.id}`}
                      className="min-w-0 flex-1 truncate"
                    >
                      {page.title || "Untitled"}
                      {pageStateByPageId[page.id]?.is_favorite ? " *" : ""}
                    </Link>
                    <details className="relative">
                      <summary
                        className={`list-none cursor-pointer text-xs ${currentPageId === page.id ? "text-slate-200" : "text-slate-400 hover:text-slate-600"}`}
                      >
                        ...
                      </summary>
                      <div className="absolute right-0 z-30 mt-1 w-28 rounded-md border border-slate-200 bg-white p-1 shadow-lg">
                        <button
                          type="button"
                          onClick={() => handleRenamePage(page.id, page.title)}
                          className="context-menu-item"
                        >
                          Rename
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeletePage(page.id, page.title)}
                          className="context-menu-item text-red-600 hover:bg-red-50 hover:text-red-700"
                        >
                          Delete
                        </button>
                      </div>
                    </details>
                  </div>
                ))}
              </div>

              {localSections.map((section) => (
                <div
                  key={section.id}
                  draggable
                  onDragStart={() => setDraggedSectionId(section.id)}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={() => handleSectionDrop(section.id)}
                  className="rounded-md border border-slate-200 bg-slate-50"
                >
                  <div className="flex items-center justify-between gap-2 px-2 py-1.5">
                    <p className="truncate text-xs font-semibold uppercase tracking-wide text-slate-500">
                      {section.title}
                    </p>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => handleCreatePage(section.id)}
                        className="rounded border border-slate-300 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600 hover:border-slate-400"
                        title="New page in section"
                      >
                        +
                      </button>
                      <details className="relative">
                        <summary className="list-none cursor-pointer text-[10px] text-slate-500 hover:text-slate-700">
                          ...
                        </summary>
                        <div className="absolute right-0 z-30 mt-1 w-28 rounded-md border border-slate-200 bg-white p-1 shadow-lg">
                          <button
                            type="button"
                            onClick={() => handleRenameSection(section.id, section.title)}
                            className="context-menu-item"
                          >
                            Rename
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteSection(section.id, section.title)}
                            className="context-menu-item text-red-600 hover:bg-red-50 hover:text-red-700"
                          >
                            Delete
                          </button>
                        </div>
                      </details>
                    </div>
                  </div>
                  <div className="space-y-1 px-1 pb-1">
                    {section.pages.map((page) => (
                      <div
                        key={page.id}
                        draggable
                        onDragStart={() =>
                          setDraggedPage({ pageId: page.id, sectionId: section.id })
                        }
                        onDragOver={(event) => event.preventDefault()}
                        onDrop={() => handlePageDrop(page.id, section.id)}
                        className={pageItemClass(page.id)}
                      >
                        <Link
                          href={`/personal/${page.id}`}
                          className="min-w-0 flex-1 truncate"
                        >
                          {page.title || "Untitled"}
                          {pageStateByPageId[page.id]?.is_favorite ? " *" : ""}
                        </Link>
                        <details className="relative">
                          <summary
                            className={`list-none cursor-pointer text-xs ${currentPageId === page.id ? "text-slate-200" : "text-slate-400 hover:text-slate-600"}`}
                          >
                            ...
                          </summary>
                          <div className="absolute right-0 z-30 mt-1 w-28 rounded-md border border-slate-200 bg-white p-1 shadow-lg">
                            <button
                              type="button"
                              onClick={() => handleRenamePage(page.id, page.title)}
                              className="context-menu-item"
                            >
                              Rename
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeletePage(page.id, page.title)}
                              className="context-menu-item text-red-600 hover:bg-red-50 hover:text-red-700"
                            >
                              Delete
                            </button>
                          </div>
                        </details>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-center gap-2">
              <Link
                href="/personal"
                className={`rounded-md border px-2 py-1 text-xs font-semibold ${
                  pathname === "/personal"
                    ? "border-slate-900 bg-slate-900 text-white"
                    : "border-slate-300 text-slate-700"
                }`}
              >
                P
              </Link>
              {currentPageId ? (
                <Link
                  href={`/personal/${currentPageId}`}
                  className="rounded-md border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-700"
                >
                  N
                </Link>
              ) : null}
            </div>
          )}
        </div>
      </aside>

      {paletteOpen ? (
        <div className="fixed inset-0 z-[120] bg-slate-900/40 p-4" onClick={() => setPaletteOpen(false)}>
          <div
            className="mx-auto mt-16 w-full max-w-xl rounded-lg border border-slate-200 bg-white p-3 shadow-xl"
            onClick={(event) => event.stopPropagation()}
          >
            <input
              value={paletteQuery}
              onChange={(event) => setPaletteQuery(event.target.value)}
              placeholder="Search pages..."
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              autoFocus
            />
            <div className="mt-3 max-h-[55vh] space-y-1 overflow-y-auto">
              {paletteItems.length ? (
                paletteItems.map((page) => (
                  <button
                    key={`palette-${page.id}`}
                    type="button"
                    onClick={() => {
                      setPaletteOpen(false);
                      router.push(`/personal/${page.id}`);
                    }}
                    className="flex w-full items-center justify-between rounded-md border border-slate-200 px-3 py-2 text-left hover:bg-slate-50"
                  >
                    <span className="truncate text-sm font-medium text-slate-800">
                      {page.title || "Untitled"}
                    </span>
                    <span className="text-xs text-slate-500">{page.sectionTitle}</span>
                  </button>
                ))
              ) : (
                <p className="px-2 py-3 text-sm text-slate-500">No pages found.</p>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
