"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import NoteEditorClient from "../../_components/NoteEditorClient";
import type { HelpGuide } from "../_data/guides";

type SaveState = "idle" | "saving" | "saved" | "error";

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

function isSameJson(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export default function HelpGuideEditorClient({
  initialGuide,
  initialHasOverride,
}: {
  initialGuide: HelpGuide;
  initialHasOverride: boolean;
}) {
  const [guide, setGuide] = useState<HelpGuide>(initialGuide);
  const [hasOverride, setHasOverride] = useState(initialHasOverride);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [saveError, setSaveError] = useState("");
  const [isResetting, setIsResetting] = useState(false);
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestSaveRequestRef = useRef(0);

  useEffect(() => {
    setGuide(initialGuide);
    setHasOverride(initialHasOverride);
  }, [initialGuide, initialHasOverride]);

  useEffect(() => {
    return () => {
      if (savedTimerRef.current) {
        clearTimeout(savedTimerRef.current);
      }
    };
  }, []);

  const persistGuide = useCallback(async (nextGuide: HelpGuide) => {
    const requestId = latestSaveRequestRef.current + 1;
    latestSaveRequestRef.current = requestId;
    setSaveState("saving");
    setSaveError("");

    let response: Response;
    try {
      response = await fetch(`/api/help/guides/${encodeURIComponent(nextGuide.slug)}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(nextGuide),
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
    setHasOverride(true);
    setSaveState("saved");
    if (savedTimerRef.current) {
      clearTimeout(savedTimerRef.current);
    }
    savedTimerRef.current = setTimeout(() => {
      setSaveState((current) => (current === "saved" ? "idle" : current));
    }, 1500);
  }, []);

  const updateSectionContent = useCallback(
    async (sectionId: string, content: unknown) => {
      let nextGuide: HelpGuide | null = null;
      setGuide((current) => {
        const nextSections = current.sections.map((section) =>
          section.id === sectionId ? { ...section, content } : section
        );
        if (isSameJson(current.sections, nextSections)) {
          return current;
        }
        nextGuide = {
          ...current,
          sections: nextSections,
        };
        return nextGuide;
      });

      if (nextGuide) {
        await persistGuide(nextGuide);
      }
    },
    [persistGuide]
  );

  const resetToDefault = useCallback(async () => {
    const confirmed = window.confirm(
      "Reset this guide to default content? This removes your custom version."
    );
    if (!confirmed) {
      return;
    }
    setIsResetting(true);
    setSaveError("");
    try {
      const response = await fetch(`/api/help/guides/${encodeURIComponent(guide.slug)}`, {
        method: "DELETE",
      });
      const body = (await response.json().catch(() => null)) as unknown;
      if (!response.ok) {
        setSaveState("error");
        setSaveError(parseErrorMessage(body));
        setIsResetting(false);
        return;
      }
      window.location.href = `/help/${guide.slug}`;
    } catch {
      setSaveState("error");
      setSaveError("Unable to reset guide right now. Try again.");
      setIsResetting(false);
    }
  }, [guide.slug]);

  const saveStateLabel =
    saveState === "saving"
      ? "Saving..."
      : saveState === "saved"
        ? "Saved"
        : saveState === "error"
          ? "Save failed"
          : "Edit mode";

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        <p className="font-semibold">Guide edit mode</p>
        <p className="mt-1">
          This now uses the same notes editor style as Personal pages. Edit section text only.
        </p>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-4 py-3">
        <p className="text-sm font-semibold text-slate-900">{saveStateLabel}</p>
        <div className="flex flex-wrap items-center gap-2">
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
            href={`/help/${guide.slug}`}
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

      <div className="space-y-4">
        {guide.sections.map((section) => (
          <section
            key={`${guide.slug}-editor-${section.id}`}
            className="space-y-3 rounded-lg border border-slate-200 bg-white p-4"
          >
            <h3 className="text-base font-semibold text-slate-900">{section.title}</h3>
            <NoteEditorClient
              entityId={`help-guide-${guide.slug}-${section.id}`}
              initialContent={section.content}
              title={`${guide.title} - ${section.title}`}
              placeholder="Start writing..."
              onSave={async (_entityId, content) => {
                await updateSectionContent(section.id, content);
              }}
              showTopToolbar
              enableZoomControls
              contextMenuMode="favorites"
              initialContextMenuFavorites={["bold", "italic", "underline", "bulletList"]}
            />
          </section>
        ))}
      </div>
    </div>
  );
}
