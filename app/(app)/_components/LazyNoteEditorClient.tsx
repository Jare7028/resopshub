"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import NoteContentViewer from "./NoteContentViewer";
import type { NoteEditorClientProps } from "./NoteEditorClient";

type LazyNoteEditorClientProps = NoteEditorClientProps & {
  initiallyEditing?: boolean;
  editButtonLabel?: string;
};

const loadNoteEditorClient = () => import("./NoteEditorClient");

const DeferredNoteEditorClient = dynamic<NoteEditorClientProps>(loadNoteEditorClient, {
  ssr: false,
  loading: () => (
    <section className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="h-[260px] animate-pulse rounded-md bg-slate-100" />
    </section>
  ),
});

function editLabel(title: string, explicitLabel?: string) {
  if (explicitLabel) return explicitLabel;
  const normalizedTitle = title.trim();
  return normalizedTitle ? `Edit ${normalizedTitle.toLowerCase()}` : "Edit";
}

export default function LazyNoteEditorClient({
  initiallyEditing = false,
  editButtonLabel,
  ...editorProps
}: LazyNoteEditorClientProps) {
  const [isEditing, setIsEditing] = useState(() => Boolean(initiallyEditing));

  useEffect(() => {
    if (initiallyEditing) {
      setIsEditing(true);
    }
  }, [initiallyEditing]);

  if (isEditing) {
    return <DeferredNoteEditorClient {...editorProps} />;
  }

  const viewerContent = editorProps.liveContentSnapshot?.content ?? editorProps.initialContent;
  const metaParts = [
    editorProps.lastEditedAtLabel ? `Last edited ${editorProps.lastEditedAtLabel}` : "",
    editorProps.lastEditedByLabel ? `by ${editorProps.lastEditedByLabel}` : "",
  ].filter(Boolean);
  const viewerClassName =
    editorProps.editorHeightMode === "fill" ? "min-h-[clamp(420px,62vh,980px)]" : "";
  const preloadEditor = () => {
    void loadNoteEditorClient();
  };
  const openEditor = () => {
    preloadEditor();
    setIsEditing(true);
  };

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-2" aria-label={editorProps.title}>
      {editorProps.adjacentToolbarTabs?.length ? (
        <div className="mb-2 flex min-w-0 flex-wrap items-center gap-1 border-b border-slate-200 px-1">
          {editorProps.adjacentToolbarTabs.map((tab) => (
            <a
              key={tab.id}
              href={tab.href}
              className={`rounded-t-md border border-b-0 px-3 py-1 text-xs font-semibold transition ${
                tab.active
                  ? "border-slate-300 bg-white text-slate-900"
                  : "border-transparent bg-transparent text-slate-500 hover:text-slate-700"
              }`}
            >
              {tab.label}
            </a>
          ))}
        </div>
      ) : null}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-slate-900">{editorProps.title}</h2>
          {metaParts.length ? (
            <p className="mt-1 text-xs text-slate-500">{metaParts.join(" ")}</p>
          ) : null}
        </div>
        <button
          type="button"
          onMouseEnter={preloadEditor}
          onFocus={preloadEditor}
          onClick={openEditor}
          className="rounded-md btn-primary px-4 py-2 text-sm font-semibold text-white"
        >
          {editLabel(editorProps.title, editButtonLabel)}
        </button>
      </div>
      <div className="mt-2">
        <NoteContentViewer
          content={viewerContent}
          placeholder={editorProps.placeholder}
          className={viewerClassName}
        />
      </div>
    </section>
  );
}
