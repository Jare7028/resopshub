"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import NoteEditorClient from "../../_components/NoteEditorClient";
import type { HelpGuide, HelpGuideSection } from "../_data/guides";

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

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function normalizeSectionId(value: string) {
  const normalized = String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized;
}

function createParagraphNode(text = "") {
  if (!text) {
    return { type: "paragraph" } as Record<string, unknown>;
  }
  return {
    type: "paragraph",
    content: [{ type: "text", text }],
  } as Record<string, unknown>;
}

function createHeadingNode(text: string) {
  return {
    type: "heading",
    attrs: { level: 2 },
    content: [{ type: "text", text }],
  } as Record<string, unknown>;
}

function normalizeDoc(value: unknown) {
  if (isObjectRecord(value) && value.type === "doc" && Array.isArray(value.content)) {
    return cloneJson(value) as { type: "doc"; content: Array<Record<string, unknown>> };
  }
  return {
    type: "doc",
    content: [createParagraphNode()],
  } as { type: "doc"; content: Array<Record<string, unknown>> };
}

function extractPlainText(value: unknown): string {
  if (!isObjectRecord(value)) return "";
  if (typeof value.text === "string") {
    return value.text;
  }
  if (!Array.isArray(value.content)) {
    return "";
  }
  return value.content.map((item) => extractPlainText(item)).join(" ");
}

function isSectionHeadingNode(node: Record<string, unknown>) {
  if (node.type !== "heading") return false;
  const attrs = isObjectRecord(node.attrs) ? node.attrs : null;
  const levelRaw = attrs?.level;
  const level = typeof levelRaw === "number" ? levelRaw : Number(levelRaw || 0);
  return Number.isFinite(level) && level >= 1 && level <= 2;
}

function buildEditorDocumentFromGuide(guide: HelpGuide) {
  const content: Array<Record<string, unknown>> = [];
  guide.sections.forEach((section) => {
    const headingText = String(section.title || "").trim() || "Section";
    content.push(createHeadingNode(headingText));
    const sectionDoc = normalizeDoc(section.content);
    if (sectionDoc.content.length) {
      content.push(...sectionDoc.content);
    } else {
      content.push(createParagraphNode());
    }
  });

  if (!content.length) {
    content.push(createParagraphNode());
  }

  return {
    type: "doc",
    content,
  };
}

function buildGuideSectionsFromDocument(docContent: unknown, previousGuide: HelpGuide) {
  const doc = normalizeDoc(docContent);
  const previousSectionsById = new Map(previousGuide.sections.map((section) => [section.id, section]));

  const draftSections: Array<{ title: string; nodes: Array<Record<string, unknown>> }> = [];
  let currentSection: { title: string; nodes: Array<Record<string, unknown>> } | null = null;

  const defaultTitle = String(previousGuide.sections[0]?.title || "Guide").trim() || "Guide";

  doc.content.forEach((node) => {
    if (isSectionHeadingNode(node)) {
      const headingText = extractPlainText(node).replace(/\s+/g, " ").trim();
      const nextTitle = headingText || `Section ${draftSections.length + 1}`;
      currentSection = { title: nextTitle, nodes: [] };
      draftSections.push(currentSection);
      return;
    }

    if (!currentSection) {
      currentSection = { title: defaultTitle, nodes: [] };
      draftSections.push(currentSection);
    }
    currentSection.nodes.push(node);
  });

  if (!draftSections.length) {
    draftSections.push({
      title: defaultTitle,
      nodes: doc.content,
    });
  }

  const usedIds = new Set<string>();
  const nextSections: HelpGuideSection[] = draftSections.map((draft, index) => {
    const title = draft.title.trim() || `Section ${index + 1}`;
    const baseId = normalizeSectionId(title) || `section-${index + 1}`;
    let id = baseId;
    let suffix = 2;
    while (usedIds.has(id)) {
      id = `${baseId}-${suffix}`;
      suffix += 1;
    }
    usedIds.add(id);

    const existingById = previousSectionsById.get(id);
    const existingByIndex = previousGuide.sections[index];
    const links = existingById?.links || existingByIndex?.links;
    const sectionContent = draft.nodes.length ? draft.nodes : [createParagraphNode()];

    const nextSection: HelpGuideSection = {
      id,
      title,
      content: {
        type: "doc",
        content: sectionContent,
      },
    };
    if (links?.length) {
      nextSection.links = cloneJson(links);
    }
    return nextSection;
  });

  return nextSections.length
    ? nextSections
    : [
        {
          id: "guide",
          title: "Guide",
          content: {
            type: "doc",
            content: [createParagraphNode()],
          },
        },
      ];
}

export default function HelpGuideEditorClient({
  initialGuide,
  initialHasOverride,
}: {
  initialGuide: HelpGuide;
  initialHasOverride: boolean;
}) {
  const [guide, setGuide] = useState<HelpGuide>(initialGuide);
  const [editorInitialContent, setEditorInitialContent] = useState<unknown>(() =>
    buildEditorDocumentFromGuide(initialGuide)
  );
  const [hasOverride, setHasOverride] = useState(initialHasOverride);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [saveError, setSaveError] = useState("");
  const [isResetting, setIsResetting] = useState(false);
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestSaveRequestRef = useRef(0);

  useEffect(() => {
    setGuide(initialGuide);
    setEditorInitialContent(buildEditorDocumentFromGuide(initialGuide));
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

  const updateGuideFromDocument = useCallback(
    async (content: unknown) => {
      const nextSections = buildGuideSectionsFromDocument(content, guide);
      if (isSameJson(nextSections, guide.sections)) {
        return;
      }
      const nextGuide: HelpGuide = {
        ...guide,
        sections: nextSections,
      };
      setGuide(nextGuide);
      await persistGuide(nextGuide);
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
          Single-page editor mode (same style as Personal pages). Use headings and lists freely.
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
        <p className="text-xs text-slate-500">
          Tip: use a level-2 heading to start a new section in the saved guide.
        </p>
        <NoteEditorClient
          entityId={`help-guide-${guide.slug}`}
          initialContent={editorInitialContent}
          title={`${guide.title} guide`}
          placeholder="Start writing..."
          onSave={async (_entityId, content) => {
            await updateGuideFromDocument(content);
          }}
          showTopToolbar
          enableZoomControls
          contextMenuMode="favorites"
          initialContextMenuFavorites={["bold", "italic", "underline", "bulletList"]}
          editorHeightMode="fill"
        />
      </section>
    </div>
  );
}
