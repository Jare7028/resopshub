"use client";

import { useCallback } from "react";
import NoteEditorClient from "../../_components/NoteEditorClient";
import { createTaskFromTaskNote, updateTaskContent } from "./editorActions";

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
  const handleCreateTask = useCallback(
    (input: { title: string; dueDate: string | null; dueTime: string | null; assignToMe: boolean }) =>
      createTaskFromTaskNote({ taskId, ...input }),
    [taskId]
  );

  return (
    <NoteEditorClient
      entityId={taskId}
      initialContent={initialContent}
      title="Task notes"
      placeholder="Start writing notes..."
      onSave={updateTaskContent}
      onCreateTask={handleCreateTask}
      blockNavigationWhileSaving={false}
      lastEditedAtLabel={lastEditedAtLabel}
      lastEditedByLabel={lastEditedByLabel}
    />
  );
}
