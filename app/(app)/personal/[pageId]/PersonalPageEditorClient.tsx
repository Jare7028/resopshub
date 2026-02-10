"use client";

import NoteEditorClient from "../../_components/NoteEditorClient";
import { useCallback } from "react";
import { createTaskFromPersonalPage, updatePersonalPageContent } from "./editorActions";

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
  const handleCreateTask = useCallback(
    (input: { title: string; dueDate: string | null; dueTime: string | null; assignToMe: boolean }) =>
      createTaskFromPersonalPage({ pageId, ...input }),
    [pageId]
  );

  return (
    <NoteEditorClient
      entityId={pageId}
      initialContent={initialContent}
      title="Page"
      placeholder="Start writing your page..."
      onSave={updatePersonalPageContent}
      onCreateTask={handleCreateTask}
      lastEditedAtLabel={lastEditedAtLabel}
      lastEditedByLabel={lastEditedByLabel}
    />
  );
}
