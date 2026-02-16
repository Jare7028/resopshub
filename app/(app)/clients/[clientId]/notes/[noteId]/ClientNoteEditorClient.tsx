"use client";

import { useCallback } from "react";
import NoteEditorClient from "../../../../_components/NoteEditorClient";
import { createTaskFromClientNote, updateClientNoteContent } from "./editorActions";
import {
  createTaskFromPersonalPage,
  updatePersonalPageContent,
} from "../../../../personal/[pageId]/editorActions";

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
    (entityId: string, content: unknown) => {
      if (sourcePersonalPageId) {
        return updatePersonalPageContent(sourcePersonalPageId, content);
      }
      return updateClientNoteContent(clientId, entityId, content);
    },
    [clientId, sourcePersonalPageId]
  );

  const handleCreateTask = useCallback(
    (input: { title: string; dueDate: string | null; dueTime: string | null; assignToMe: boolean }) => {
      if (sourcePersonalPageId) {
        return createTaskFromPersonalPage({ pageId: sourcePersonalPageId, ...input });
      }
      return createTaskFromClientNote({ clientId, noteId, ...input });
    },
    [clientId, noteId, sourcePersonalPageId]
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
