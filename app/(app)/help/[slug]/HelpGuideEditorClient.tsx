"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import NoteEditorClient from "../../_components/LazyNoteEditorClient";
import type { HelpGuide } from "../_data/guides";
import { normalizeHelpGuide } from "../_data/guides";
import { buildGuideSingleDoc, parseGuideSingleDoc } from "../_lib/guideSingleDoc";

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

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isSameJson(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export default function HelpGuideEditorClient({
  initialGuide,
  initialStorageSlug,
  initialHasOverride,
}: {
  initialGuide: HelpGuide;
  initialStorageSlug: string;
  initialHasOverride: boolean;
}) {
  const [guide, setGuide] = useState<HelpGuide>(initialGuide);
  const [storageSlug, setStorageSlug] = useState(initialStorageSlug);
  const [editorInitialContent, setEditorInitialContent] = useState<unknown>(() =>
    buildGuideSingleDoc(initialGuide)
  );
  const [hasOverride, setHasOverride] = useState(initialHasOverride);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [saveError, setSaveError] = useState("");
  const [isResetting, setIsResetting] = useState(false);
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestSaveRequestRef = useRef(0);

  useEffect(() => {
    setGuide(initialGuide);
    setStorageSlug(initialStorageSlug);
    setEditorInitialContent(buildGuideSingleDoc(initialGuide));
    setHasOverride(initialHasOverride);
  }, [initialGuide, initialStorageSlug, initialHasOverride]);

  useEffect(() => {
    return () => {
      if (savedTimerRef.current) {
        clearTimeout(savedTimerRef.current);
      }
    };
  }, []);

  const persistGuide = useCallback(
    async (nextGuide: HelpGuide) => {
      const requestId = latestSaveRequestRef.current + 1;
      latestSaveRequestRef.current = requestId;
      setSaveState("saving");
      setSaveError("");

      let response: Response;
      try {
        response = await fetch(`/api/help/guides/${encodeURIComponent(storageSlug)}`, {
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
        throw new Error("Unable to save guide. Check your connection and retry.");
      }

      const body = (await response.json().catch(() => null)) as unknown;
      if (!response.ok) {
        if (requestId !== latestSaveRequestRef.current) return;
        const message = parseErrorMessage(body);
        setSaveState("error");
        setSaveError(message);
        throw new Error(message);
      }

      if (requestId !== latestSaveRequestRef.current) return;

      let savedGuide = nextGuide;
      let savedStorageSlug = storageSlug;
      let savedWarnings: string[] = [];

      if (isObjectRecord(body)) {
        const normalized = normalizeHelpGuide(body.guide);
        if (normalized) {
          savedGuide = normalized;
        }
        if (typeof body.storageSlug === "string" && body.storageSlug.trim()) {
          savedStorageSlug = body.storageSlug.trim();
        }
        if (Array.isArray(body.warnings)) {
          savedWarnings = body.warnings
            .map((item) => String(item || "").trim())
            .filter(Boolean);
        }
      }

      setGuide(savedGuide);
      setStorageSlug(savedStorageSlug);
      setHasOverride(true);
      setSaveState("saved");
      if (savedTimerRef.current) {
        clearTimeout(savedTimerRef.current);
      }
      savedTimerRef.current = setTimeout(() => {
        setSaveState((current) => (current === "saved" ? "idle" : current));
      }, 1500);

      return {
        guide: savedGuide,
        warnings: savedWarnings,
      };
    },
    [storageSlug]
  );

  const updateGuideFromDocument = useCallback(
    async (content: unknown) => {
      const nextGuide = parseGuideSingleDoc(content, guide);
      if (isSameJson(nextGuide, guide)) {
        return { content };
      }
      setGuide(nextGuide);
      const persisted = await persistGuide(nextGuide);
      const savedGuide = persisted?.guide || nextGuide;
      return {
        content: buildGuideSingleDoc(savedGuide),
        warnings: persisted?.warnings || [],
      };
    },
    [guide, persistGuide]
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
      const response = await fetch(`/api/help/guides/${encodeURIComponent(storageSlug)}`, {
        method: "DELETE",
      });
      const body = (await response.json().catch(() => null)) as unknown;
      if (!response.ok) {
        setSaveState("error");
        setSaveError(parseErrorMessage(body));
        setIsResetting(false);
        return;
      }
      window.location.href = `/help/${storageSlug}`;
    } catch {
      setSaveState("error");
      setSaveError("Unable to reset guide right now. Try again.");
      setIsResetting(false);
    }
  }, [storageSlug]);

  const saveStateLabel =
    saveState === "saving"
      ? "Saving..."
      : saveState === "saved"
      ? "Saved"
      : saveState === "error"
      ? "Save failed"
      : "Edit mode";
  const displayTitle = String(guide.title || "").trim() || "Untitled";

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        <p className="font-semibold">Guide edit mode</p>
        <p className="mt-1">
          Edit this as one page. Keep top metadata lines as: Title, Summary, Audience, Estimated
          time.
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

      <section className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
        <NoteEditorClient
          entityId={`help-guide-${storageSlug}`}
          initialContent={editorInitialContent}
          title={`${displayTitle} guide`}
          placeholder="Start writing..."
          onSave={async (_entityId, content) => {
            return updateGuideFromDocument(content);
          }}
          showTopToolbar
          enableZoomControls
          contextMenuMode="favorites"
          initialContextMenuFavorites={["bold", "italic", "underline", "bulletList"]}
          editorHeightMode="fill"
          initiallyEditing
        />
      </section>
    </div>
  );
}
