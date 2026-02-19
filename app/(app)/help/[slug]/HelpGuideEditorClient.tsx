"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import NoteEditorClient from "../../_components/NoteEditorClient";
import type { HelpGuide, HelpGuideSection, HelpGuideSectionLink } from "../_data/guides";

type EditableSection = HelpGuideSection & {
  localKey: string;
};

type EditableGuide = Omit<HelpGuide, "sections"> & {
  sections: EditableSection[];
};

type SaveState = "idle" | "saving" | "saved" | "error";

function createLocalKey() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `local-${Math.random().toString(36).slice(2, 10)}`;
}

function toSectionId(value: string, fallback: string) {
  const normalized = String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || fallback;
}

function createDefaultSection() {
  const localKey = createLocalKey();
  return {
    localKey,
    id: `section-${localKey.slice(0, 6)}`,
    title: "New section",
    content: {
      type: "doc",
      content: [{ type: "paragraph" }],
    },
    links: [],
  } satisfies EditableSection;
}

function toEditableGuide(guide: HelpGuide): EditableGuide {
  return {
    ...guide,
    sections: guide.sections.map((section) => ({
      ...section,
      localKey: createLocalKey(),
      links: section.links ? [...section.links] : [],
    })),
  };
}

function toPersistedGuide(guide: EditableGuide): HelpGuide {
  return {
    ...guide,
    sections: guide.sections.map((section) => {
      const persistedSection: HelpGuideSection = {
        id: section.id,
        title: section.title,
        content: section.content,
      };
      if (section.links?.length) {
        persistedSection.links = section.links;
      }
      return persistedSection;
    }),
  };
}

function parseErrorMessage(errorBody: unknown) {
  if (!errorBody || typeof errorBody !== "object") {
    return "Unable to save guide.";
  }
  const message = (errorBody as { error?: unknown }).error;
  if (typeof message === "string" && message.trim()) {
    return message;
  }
  return "Unable to save guide.";
}

function splitLines(value: string) {
  return value
    .split("\n")
    .map((item) => item.trim())
    .filter(Boolean);
}

function joinLines(values: string[]) {
  return values.join("\n");
}

export default function HelpGuideEditorClient({
  initialGuide,
  initialHasOverride,
}: {
  initialGuide: HelpGuide;
  initialHasOverride: boolean;
}) {
  const [guide, setGuide] = useState<EditableGuide>(() => toEditableGuide(initialGuide));
  const [hasOverride, setHasOverride] = useState(initialHasOverride);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [saveError, setSaveError] = useState("");
  const [isResetting, setIsResetting] = useState(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedSnapshotRef = useRef("");
  const latestSaveRequestRef = useRef(0);

  const persistedGuide = useMemo(() => toPersistedGuide(guide), [guide]);
  const serializedGuide = useMemo(() => JSON.stringify(persistedGuide), [persistedGuide]);
  const slug = persistedGuide.slug;

  useEffect(() => {
    lastSavedSnapshotRef.current = JSON.stringify(initialGuide);
  }, [initialGuide]);

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
      }
      if (savedTimerRef.current) {
        clearTimeout(savedTimerRef.current);
      }
    };
  }, []);

  const saveSnapshot = useCallback(
    async (snapshot: string) => {
      const requestId = latestSaveRequestRef.current + 1;
      latestSaveRequestRef.current = requestId;
      setSaveState("saving");
      setSaveError("");

      let response: Response;
      try {
        response = await fetch(`/api/help/guides/${encodeURIComponent(slug)}`, {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
          },
          body: snapshot,
        });
      } catch {
        if (requestId !== latestSaveRequestRef.current) return;
        setSaveState("error");
        setSaveError("Unable to save guide. Check your connection and retry.");
        return;
      }

      const body = (await response.json().catch(() => null)) as unknown;
      if (!response.ok) {
        if (requestId !== latestSaveRequestRef.current) return;
        setSaveState("error");
        setSaveError(parseErrorMessage(body));
        return;
      }

      if (requestId !== latestSaveRequestRef.current) return;
      lastSavedSnapshotRef.current = snapshot;
      setHasOverride(true);
      setSaveState("saved");
      if (savedTimerRef.current) {
        clearTimeout(savedTimerRef.current);
      }
      savedTimerRef.current = setTimeout(() => {
        setSaveState((current) => (current === "saved" ? "idle" : current));
      }, 1500);
    },
    [slug]
  );

  useEffect(() => {
    if (serializedGuide === lastSavedSnapshotRef.current) {
      return;
    }
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
    }
    setSaveState("saving");
    saveTimerRef.current = setTimeout(() => {
      saveTimerRef.current = null;
      void saveSnapshot(serializedGuide);
    }, 1200);
  }, [serializedGuide, saveSnapshot]);

  const retrySave = useCallback(() => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    void saveSnapshot(serializedGuide);
  }, [saveSnapshot, serializedGuide]);

  const resetToDefault = useCallback(async () => {
    const confirmed = window.confirm(
      "Reset this guide to default content? This removes your custom version."
    );
    if (!confirmed) {
      return;
    }
    setIsResetting(true);
    try {
      const response = await fetch(`/api/help/guides/${encodeURIComponent(slug)}`, {
        method: "DELETE",
      });
      const body = (await response.json().catch(() => null)) as unknown;
      if (!response.ok) {
        setSaveState("error");
        setSaveError(parseErrorMessage(body));
        setIsResetting(false);
        return;
      }
      window.location.href = `/help/${slug}`;
    } catch {
      setSaveState("error");
      setSaveError("Unable to reset guide right now. Try again.");
      setIsResetting(false);
    }
  }, [slug]);

  const saveStateLabel =
    saveState === "saving"
      ? "Saving..."
      : saveState === "saved"
        ? "Saved"
        : saveState === "error"
          ? "Save failed"
          : "Live autosave enabled";

  const updateGuideField = <K extends keyof EditableGuide>(key: K, value: EditableGuide[K]) => {
    setGuide((current) => ({
      ...current,
      [key]: value,
    }));
  };

  const moveSection = (localKey: string, direction: "up" | "down") => {
    setGuide((current) => {
      const index = current.sections.findIndex((section) => section.localKey === localKey);
      if (index < 0) return current;
      const targetIndex = direction === "up" ? index - 1 : index + 1;
      if (targetIndex < 0 || targetIndex >= current.sections.length) return current;
      const sections = [...current.sections];
      const [moved] = sections.splice(index, 1);
      sections.splice(targetIndex, 0, moved);
      return { ...current, sections };
    });
  };

  const updateSection = (localKey: string, updater: (section: EditableSection) => EditableSection) => {
    setGuide((current) => ({
      ...current,
      sections: current.sections.map((section) =>
        section.localKey === localKey ? updater(section) : section
      ),
    }));
  };

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        <p className="font-semibold">Edit mode . Changes go live automatically.</p>
        <p className="mt-1">
          This page autosaves for all users. Keep this tab open until you see <strong>Saved</strong>.
        </p>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-4 py-3">
        <p className="text-sm font-semibold text-slate-900">{saveStateLabel}</p>
        <div className="flex flex-wrap items-center gap-2">
          {saveState === "error" ? (
            <button
              type="button"
              onClick={retrySave}
              className="rounded-md border border-red-300 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-50"
            >
              Retry save
            </button>
          ) : null}
          {hasOverride ? (
            <button
              type="button"
              onClick={resetToDefault}
              disabled={isResetting}
              className="rounded-md border border-red-300 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isResetting ? "Resetting..." : "Reset to default"}
            </button>
          ) : null}
          <Link
            href={`/help/${slug}`}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:border-slate-400 hover:text-slate-900"
          >
            Exit edit mode
          </Link>
        </div>
      </div>

      {saveError ? (
        <p className="rounded-md border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
          {saveError}
        </p>
      ) : null}

      <section className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="text-base font-semibold text-slate-900">Guide details</h2>
        <label className="block text-sm font-medium text-slate-700">
          Title
          <input
            type="text"
            value={guide.title}
            onChange={(event) => updateGuideField("title", event.target.value)}
            className="mt-1 h-10 w-full rounded-md border border-slate-300 px-3 text-sm text-slate-900"
          />
        </label>
        <label className="block text-sm font-medium text-slate-700">
          Summary
          <textarea
            value={guide.summary}
            onChange={(event) => updateGuideField("summary", event.target.value)}
            className="mt-1 min-h-[5rem] w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900"
          />
        </label>
        <div className="grid gap-3 md:grid-cols-2">
          <label className="block text-sm font-medium text-slate-700">
            Related app path
            <input
              type="text"
              value={guide.appPath}
              onChange={(event) => updateGuideField("appPath", event.target.value)}
              className="mt-1 h-10 w-full rounded-md border border-slate-300 px-3 text-sm text-slate-900"
            />
          </label>
          <label className="block text-sm font-medium text-slate-700">
            Audience
            <input
              type="text"
              value={guide.audience}
              onChange={(event) => updateGuideField("audience", event.target.value)}
              className="mt-1 h-10 w-full rounded-md border border-slate-300 px-3 text-sm text-slate-900"
            />
          </label>
        </div>
        <label className="block text-sm font-medium text-slate-700">
          Estimated time
          <input
            type="text"
            value={guide.estimatedTime}
            onChange={(event) => updateGuideField("estimatedTime", event.target.value)}
            className="mt-1 h-10 w-full rounded-md border border-slate-300 px-3 text-sm text-slate-900"
          />
        </label>
        <div className="grid gap-3 md:grid-cols-3">
          <label className="block text-sm font-medium text-slate-700">
            Keywords (one per line)
            <textarea
              value={joinLines(guide.keywords)}
              onChange={(event) => updateGuideField("keywords", splitLines(event.target.value))}
              className="mt-1 min-h-[8rem] w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900"
            />
          </label>
          <label className="block text-sm font-medium text-slate-700">
            Before you start (one per line)
            <textarea
              value={joinLines(guide.prerequisites)}
              onChange={(event) =>
                updateGuideField("prerequisites", splitLines(event.target.value))
              }
              className="mt-1 min-h-[8rem] w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900"
            />
          </label>
          <label className="block text-sm font-medium text-slate-700">
            Related guides (slug per line)
            <textarea
              value={joinLines(guide.related)}
              onChange={(event) => updateGuideField("related", splitLines(event.target.value))}
              className="mt-1 min-h-[8rem] w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900"
            />
          </label>
        </div>
      </section>

      <section className="space-y-4 rounded-lg border border-slate-200 bg-white p-4">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-base font-semibold text-slate-900">Sections</h2>
          <button
            type="button"
            onClick={() =>
              setGuide((current) => ({
                ...current,
                sections: [...current.sections, createDefaultSection()],
              }))
            }
            className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:border-slate-400 hover:text-slate-900"
          >
            Add section
          </button>
        </div>

        {guide.sections.map((section, index) => (
          <article
            key={section.localKey}
            className="space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-3"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-semibold text-slate-900">Section {index + 1}</p>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => moveSection(section.localKey, "up")}
                  className="rounded-md border border-slate-300 px-2.5 py-1 text-xs font-semibold text-slate-700 hover:border-slate-400"
                >
                  Move up
                </button>
                <button
                  type="button"
                  onClick={() => moveSection(section.localKey, "down")}
                  className="rounded-md border border-slate-300 px-2.5 py-1 text-xs font-semibold text-slate-700 hover:border-slate-400"
                >
                  Move down
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setGuide((current) => ({
                      ...current,
                      sections: current.sections.filter((entry) => entry.localKey !== section.localKey),
                    }))
                  }
                  disabled={guide.sections.length <= 1}
                  className="rounded-md border border-red-300 px-2.5 py-1 text-xs font-semibold text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Remove
                </button>
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <label className="block text-sm font-medium text-slate-700">
                Section title
                <input
                  type="text"
                  value={section.title}
                  onChange={(event) =>
                    updateSection(section.localKey, (currentSection) => {
                      const nextTitle = event.target.value;
                      return {
                        ...currentSection,
                        title: nextTitle,
                        id: toSectionId(nextTitle, currentSection.id || `section-${index + 1}`),
                      };
                    })
                  }
                  className="mt-1 h-10 w-full rounded-md border border-slate-300 px-3 text-sm text-slate-900"
                />
              </label>
              <label className="block text-sm font-medium text-slate-700">
                Section ID
                <input
                  type="text"
                  value={section.id}
                  onChange={(event) =>
                    updateSection(section.localKey, (currentSection) => ({
                      ...currentSection,
                      id: toSectionId(event.target.value, currentSection.id),
                    }))
                  }
                  className="mt-1 h-10 w-full rounded-md border border-slate-300 px-3 text-sm text-slate-900"
                />
              </label>
            </div>

            <div className="rounded-lg border border-slate-200 bg-white p-2">
              <NoteEditorClient
                entityId={`help-guide-${slug}-${section.localKey}`}
                initialContent={section.content}
                title={`${guide.title} - ${section.title}`}
                placeholder="Write section content..."
                onSave={async (_entityId, content) => {
                  updateSection(section.localKey, (currentSection) => ({
                    ...currentSection,
                    content,
                  }));
                }}
                showTopToolbar
                enableZoomControls={false}
                contextMenuMode="favorites"
                initialContextMenuFavorites={["bold", "italic", "underline", "bulletList"]}
              />
            </div>

            <div className="space-y-2 rounded-md border border-slate-200 bg-white p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-semibold text-slate-900">Download links</p>
                <button
                  type="button"
                  onClick={() =>
                    updateSection(section.localKey, (currentSection) => ({
                      ...currentSection,
                      links: [...(currentSection.links || []), { label: "", href: "" }],
                    }))
                  }
                  className="rounded-md border border-slate-300 px-2.5 py-1 text-xs font-semibold text-slate-700 hover:border-slate-400"
                >
                  Add link
                </button>
              </div>
              {(section.links || []).length ? (
                <div className="space-y-2">
                  {(section.links || []).map((link, linkIndex) => (
                    <div key={`${section.localKey}-link-${linkIndex}`} className="grid gap-2 md:grid-cols-[1fr_1fr_auto]">
                      <input
                        type="text"
                        value={link.label}
                        onChange={(event) =>
                          updateSection(section.localKey, (currentSection) => {
                            const nextLinks: HelpGuideSectionLink[] = [...(currentSection.links || [])];
                            nextLinks[linkIndex] = {
                              ...nextLinks[linkIndex],
                              label: event.target.value,
                            };
                            return { ...currentSection, links: nextLinks };
                          })
                        }
                        placeholder="Link label"
                        className="h-10 rounded-md border border-slate-300 px-3 text-sm text-slate-900"
                      />
                      <input
                        type="text"
                        value={link.href}
                        onChange={(event) =>
                          updateSection(section.localKey, (currentSection) => {
                            const nextLinks: HelpGuideSectionLink[] = [...(currentSection.links || [])];
                            nextLinks[linkIndex] = {
                              ...nextLinks[linkIndex],
                              href: event.target.value,
                            };
                            return { ...currentSection, links: nextLinks };
                          })
                        }
                        placeholder="/downloads/file.zip or https://..."
                        className="h-10 rounded-md border border-slate-300 px-3 text-sm text-slate-900"
                      />
                      <button
                        type="button"
                        onClick={() =>
                          updateSection(section.localKey, (currentSection) => ({
                            ...currentSection,
                            links: (currentSection.links || []).filter((_, idx) => idx !== linkIndex),
                          }))
                        }
                        className="rounded-md border border-red-300 px-2.5 py-1 text-xs font-semibold text-red-700 hover:bg-red-50"
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-slate-500">No links in this section.</p>
              )}
            </div>
          </article>
        ))}
      </section>
    </div>
  );
}
