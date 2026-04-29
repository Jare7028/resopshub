"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import NoteEditorClient from "../../_components/LazyNoteEditorClient";
import type {
  ContextMenuFavoriteActionId,
  NoteLiveContentSnapshot,
} from "../../_components/NoteEditorClient";
import {
  createTaskFromPersonalPage,
  savePersonalContextMenuFavorites,
  updatePersonalPageContent,
} from "./editorActions";
import {
  recordPersonalPageOpened,
  upsertPersonalPageUserState,
} from "../workspaceActions";
import type { PersonalWorkspaceRibbonTab } from "../types";
import { uploadPersonalPageImage } from "@/lib/personalPageImageUpload";
import { supabase } from "@/lib/supabaseClient";

export default function PersonalPageEditorClient({
  pageId,
  initialContent,
  lastEditedAtLabel,
  lastEditedByLabel,
  initialContextMenuFavorites,
  persistContextMenuFavorites,
  initialUpdatedAt = null,
  initialRibbonTab = "home",
  initialZoomPercent = 100,
  initialFocusMode = false,
}: {
  pageId: string;
  initialContent: unknown;
  lastEditedAtLabel?: string | null;
  lastEditedByLabel?: string | null;
  initialContextMenuFavorites: ContextMenuFavoriteActionId[];
  persistContextMenuFavorites: boolean;
  initialUpdatedAt?: string | null;
  initialRibbonTab?: PersonalWorkspaceRibbonTab;
  initialZoomPercent?: number;
  initialFocusMode?: boolean;
}) {
  const expectedUpdatedAtRef = useRef<string | null>(initialUpdatedAt ?? null);
  const [liveContentSnapshot, setLiveContentSnapshot] = useState<NoteLiveContentSnapshot | null>(
    null
  );
  const [shellFocusModeActive, setShellFocusModeActive] = useState(Boolean(initialFocusMode));

  useEffect(() => {
    void recordPersonalPageOpened({ pageId }).catch(() => undefined);
  }, [pageId]);

  useEffect(() => {
    expectedUpdatedAtRef.current = initialUpdatedAt ?? null;
  }, [initialUpdatedAt, pageId]);

  useEffect(() => {
    setShellFocusModeActive(Boolean(initialFocusMode));
  }, [initialFocusMode, pageId]);

  useEffect(() => {
    const bodyClassName = "personal-focus-mode";
    if (shellFocusModeActive) {
      document.body.classList.add(bodyClassName);
    } else {
      document.body.classList.remove(bodyClassName);
    }
    return () => {
      document.body.classList.remove(bodyClassName);
    };
  }, [shellFocusModeActive]);

  useEffect(() => {
    setLiveContentSnapshot(null);
    const channel = supabase
      .channel(`live:personal_pages:${pageId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "personal_pages",
          filter: `id=eq.${pageId}`,
        },
        (payload) => {
          const row = payload.new as Record<string, unknown>;
          if (!Object.prototype.hasOwnProperty.call(row, "content")) {
            return;
          }
          const nextUpdatedAt =
            typeof row.updated_at === "string" ? row.updated_at.trim() || null : null;
          if (nextUpdatedAt && nextUpdatedAt === expectedUpdatedAtRef.current) {
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
  }, [pageId]);

  const handleCreateTask = useCallback(
    (input: { title: string; dueDate: string | null; dueTime: string | null; assignToMe: boolean }) =>
      createTaskFromPersonalPage({ pageId, ...input }),
    [pageId]
  );

  const handleSave = useCallback(async (entityId: string, content: unknown) => {
    const result = await updatePersonalPageContent(entityId, content, {
      expectedUpdatedAt: expectedUpdatedAtRef.current,
    });
    if (result.status === "conflict") {
      throw new Error(result.message);
    }
    expectedUpdatedAtRef.current = result.updatedAt;
    return {
      content: result.content,
      updatedAt: result.updatedAt,
      warnings: result.warnings,
    };
  }, []);
  const handleUploadImageFile = useCallback(
    async (file: File) => uploadPersonalPageImage({ pageId, file }),
    [pageId]
  );
  const handleSaveContextMenuFavorites = useCallback(
    (favorites: string[]) => savePersonalContextMenuFavorites({ favorites }),
    []
  );
  const handleViewStateChange = useCallback(
    (state: { ribbonTab: PersonalWorkspaceRibbonTab; zoomPercent: number; focusMode: boolean }) => {
      setShellFocusModeActive(state.focusMode);
      return upsertPersonalPageUserState({
        pageId,
        ribbonTab: state.ribbonTab,
        zoomPercent: state.zoomPercent,
        focusMode: state.focusMode,
      }).then(() => undefined);
    },
    [pageId]
  );
  const handleFocusModeChange = useCallback((nextFocusMode: boolean) => {
    setShellFocusModeActive(nextFocusMode);
  }, []);
  const handleLiveSnapshotApplied = useCallback((updatedAt: string | null) => {
    expectedUpdatedAtRef.current = updatedAt;
  }, []);

  return (
    <NoteEditorClient
      entityId={pageId}
      initialContent={initialContent}
      initialUpdatedAt={initialUpdatedAt}
      liveContentSnapshot={liveContentSnapshot}
      onLiveSnapshotApplied={handleLiveSnapshotApplied}
      title="Page"
      placeholder="Start writing your page..."
      onSave={handleSave}
      onUploadImageFile={handleUploadImageFile}
      onCreateTask={handleCreateTask}
      lastEditedAtLabel={lastEditedAtLabel}
      lastEditedByLabel={lastEditedByLabel}
      showTopToolbar
      enableZoomControls
      disableHorizontalScroll
      contextMenuMode="favorites"
      initialContextMenuFavorites={initialContextMenuFavorites}
      onSaveContextMenuFavorites={
        persistContextMenuFavorites ? handleSaveContextMenuFavorites : undefined
      }
      initialRibbonTab={initialRibbonTab}
      initialZoomPercent={initialZoomPercent}
      initialFocusMode={initialFocusMode}
      editorHeightMode="fill"
      onViewStateChange={handleViewStateChange}
      onFocusModeChange={handleFocusModeChange}
      debugImagePersistence
      enforceImageNodeIntegrity
    />
  );
}
