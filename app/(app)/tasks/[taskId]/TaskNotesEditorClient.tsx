"use client";

import NoteEditorClient from "../../_components/NoteEditorClient";
import { updateTaskContent } from "./editorActions";

export default function TaskNotesEditorClient({
  taskId,
  initialContent,
  lastEditedAtLabel,
  lastEditedByLabel,
}: {
  taskId: string;
  initialContent: unknown;
  lastEditedAtLabel?: string | null;
  lastEditedByLabel?: string | null;
}) {
  return (
    <NoteEditorClient
      entityId={taskId}
      initialContent={initialContent}
      title="Task notes"
      placeholder="Start writing notes..."
      onSave={updateTaskContent}
      lastEditedAtLabel={lastEditedAtLabel}
      lastEditedByLabel={lastEditedByLabel}
    />
  );
}
