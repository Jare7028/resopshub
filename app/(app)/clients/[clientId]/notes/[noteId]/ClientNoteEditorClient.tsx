"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import NoteEditorClient from "../../../../_components/LazyNoteEditorClient";
import type { NoteLiveContentSnapshot } from "../../../../_components/NoteEditorClient";
import { createTaskFromClientNote, updateClientNoteContent } from "./editorActions";
import {
  createTaskFromPersonalPage,
  updatePersonalPageContent,
} from "../../../../personal/[pageId]/editorActions";
import { uploadPersonalPageImage } from "@/lib/personalPageImageUpload";
import { supabase } from "@/lib/supabaseClient";

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
  const [liveContentSnapshot, setLiveContentSnapshot] = useState<NoteLiveContentSnapshot | null>(
    null
  );

  useEffect(() => {
    sourcePageExpectedUpdatedAtRef.current = sourcePersonalPageUpdatedAt ?? null;
  }, [sourcePersonalPageId, sourcePersonalPageUpdatedAt]);

  useEffect(() => {
    setLiveContentSnapshot(null);
    if (!sourcePersonalPageId) {
      return;
    }
    const channel = supabase
      .channel(`live:personal_pages:${sourcePersonalPageId}:from_client_note`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "personal_pages",
          filter: `id=eq.${sourcePersonalPageId}`,
        },
        (payload) => {
          const row = payload.new as Record<string, unknown>;
          if (!Object.prototype.hasOwnProperty.call(row, "content")) {
            return;
          }
          const nextUpdatedAt =
            typeof row.updated_at === "string" ? row.updated_at.trim() || null : null;
          if (nextUpdatedAt && nextUpdatedAt === sourcePageExpectedUpdatedAtRef.current) {
            return;
          }
          setLiveContentSnapshot({
            content: row.content ?? null,
            updatedAt: nextUpdatedAt,
          });
        }
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [sourcePersonalPageId]);

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
  const editorEntityId = sourcePersonalPageId || noteId;
  const handleLiveSnapshotApplied = useCallback((updatedAt: string | null) => {
    sourcePageExpectedUpdatedAtRef.current = updatedAt;
  }, []);
  return (
    <NoteEditorClient
      entityId={editorEntityId}
      initialContent={initialContent}
      initialUpdatedAt={sourcePersonalPageUpdatedAt ?? null}
      liveContentSnapshot={sourcePersonalPageId ? liveContentSnapshot : null}
      onLiveSnapshotApplied={sourcePersonalPageId ? handleLiveSnapshotApplied : undefined}
      title="Note"
      placeholder="Start writing your note..."
      onSave={handleSave}
      onUploadImageFile={sourcePersonalPageId ? handleUploadImageFile : undefined}
      onCreateTask={handleCreateTask}
      blockNavigationWhileSaving={false}
      lastEditedAtLabel={lastEditedAtLabel}
      lastEditedByLabel={lastEditedByLabel}
      debugImagePersistence={Boolean(sourcePersonalPageId)}
      enforceImageNodeIntegrity={Boolean(sourcePersonalPageId)}
    />
  );
}
