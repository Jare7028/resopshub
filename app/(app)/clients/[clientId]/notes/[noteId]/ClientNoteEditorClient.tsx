"use client";

import { useCallback, useEffect, useRef } from "react";
import NoteEditorClient from "../../../../_components/NoteEditorClient";
import { createTaskFromClientNote, updateClientNoteContent } from "./editorActions";
import {
  createTaskFromPersonalPage,
  updatePersonalPageContent,
} from "../../../../personal/[pageId]/editorActions";
import { uploadPersonalPageImage } from "@/lib/personalPageImageUpload";

export default function ClientNoteEditorClient({
  clientId,
  noteId,
  sourcePersonalPageId,
  sourcePersonalPageUpdatedAt,
  initialContent,
  lastEditedAtLabel,
  lastEditedByLabel,
}: {
  clientId: string;
  noteId: string;
  sourcePersonalPageId: string | null;
  sourcePersonalPageUpdatedAt?: string | null;
  initialContent: unknown;
  lastEditedAtLabel?: string | null;
  lastEditedByLabel?: string | null;
}) {
  const sourcePageExpectedUpdatedAtRef = useRef<string | null>(
    sourcePersonalPageUpdatedAt ?? null
  );

  useEffect(() => {
    sourcePageExpectedUpdatedAtRef.current = sourcePersonalPageUpdatedAt ?? null;
  }, [sourcePersonalPageId, sourcePersonalPageUpdatedAt]);

  const handleSave = useCallback(
    async (entityId: string, content: unknown) => {
      if (sourcePersonalPageId) {
        const result = await updatePersonalPageContent(sourcePersonalPageId, content, {
          expectedUpdatedAt: sourcePageExpectedUpdatedAtRef.current,
        });
        if (result.status === "conflict") {
          throw new Error(result.message);
        }
        sourcePageExpectedUpdatedAtRef.current = result.updatedAt;
        return {
          content: result.content,
          updatedAt: result.updatedAt,
          warnings: result.warnings,
        };
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
  const handleUploadImageFile = useCallback(
    async (file: File) => {
      if (!sourcePersonalPageId) {
        throw new Error("Image uploads require a linked personal page.");
      }
      return uploadPersonalPageImage({
        pageId: sourcePersonalPageId,
        file,
      });
    },
    [sourcePersonalPageId]
  );
  return (
    <NoteEditorClient
      entityId={noteId}
      initialContent={initialContent}
      title="Note"
      placeholder="Start writing your note..."
      onSave={handleSave}
      onUploadImageFile={sourcePersonalPageId ? handleUploadImageFile : undefined}
      onCreateTask={handleCreateTask}
      lastEditedAtLabel={lastEditedAtLabel}
      lastEditedByLabel={lastEditedByLabel}
      debugImagePersistence={Boolean(sourcePersonalPageId)}
    />
  );
}
