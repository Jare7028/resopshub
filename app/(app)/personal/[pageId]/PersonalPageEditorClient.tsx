"use client";

import NoteEditorClient from "../../_components/NoteEditorClient";
import { updatePersonalPageContent } from "./editorActions";

export default function PersonalPageEditorClient({
  pageId,
  initialContent,
  lastEditedAtLabel,
  lastEditedByLabel,
}: {
  pageId: string;
  initialContent: unknown;
  lastEditedAtLabel?: string | null;
  lastEditedByLabel?: string | null;
}) {
  return (
    <NoteEditorClient
      entityId={pageId}
      initialContent={initialContent}
      title="Page"
      placeholder="Start writing your page..."
      onSave={updatePersonalPageContent}
      lastEditedAtLabel={lastEditedAtLabel}
      lastEditedByLabel={lastEditedByLabel}
    />
  );
}
