"use client";

import { useCallback } from "react";
import NoteEditorClient from "../../../../_components/NoteEditorClient";
import { createTaskFromClientNote, updateClientNoteContent } from "./editorActions";

export default function ClientNoteEditorClient({
  clientId,
  noteId,
  sourcePersonalPageId,
  initialContent,
  lastEditedAtLabel,
  lastEditedByLabel,
}: {
  clientId: string;
  noteId: string;
  sourcePersonalPageId: string | null;
  initialContent: unknown;
  lastEditedAtLabel?: string | null;
  lastEditedByLabel?: string | null;
}) {
  const handleSave = useCallback(
    (entityId: string, content: unknown) =>
      updateClientNoteContent(clientId, entityId, content, sourcePersonalPageId),
    [clientId, sourcePersonalPageId]
  );

  const handleCreateTask = useCallback(
    (input: { title: string; dueDate: string | null; dueTime: string | null; assignToMe: boolean }) =>
      createTaskFromClientNote({ clientId, noteId, ...input }),
    [clientId, noteId]
  );

  return (
    <NoteEditorClient
      entityId={noteId}
      initialContent={initialContent}
      title="Note"
      placeholder="Start writing your note..."
      onSave={handleSave}
      onCreateTask={handleCreateTask}
      lastEditedAtLabel={lastEditedAtLabel}
      lastEditedByLabel={lastEditedByLabel}
    />
  );
}
