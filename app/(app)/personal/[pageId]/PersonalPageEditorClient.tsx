"use client";

import NoteEditorClient from "../../_components/NoteEditorClient";
import type { ContextMenuFavoriteActionId } from "../../_components/NoteEditorClient";
import { useCallback, useEffect, useRef } from "react";
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

  useEffect(() => {
    void recordPersonalPageOpened({ pageId }).catch(() => undefined);
  }, [pageId]);

  useEffect(() => {
    expectedUpdatedAtRef.current = initialUpdatedAt ?? null;
  }, [initialUpdatedAt, pageId]);

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
  }, []);
  const handleSaveContextMenuFavorites = useCallback(
    (favorites: string[]) => savePersonalContextMenuFavorites({ favorites }),
    []
  );
  const handleViewStateChange = useCallback(
    (state: { ribbonTab: PersonalWorkspaceRibbonTab; zoomPercent: number; focusMode: boolean }) =>
      upsertPersonalPageUserState({
        pageId,
        ribbonTab: state.ribbonTab,
        zoomPercent: state.zoomPercent,
        focusMode: state.focusMode,
      }).then(() => undefined),
    [pageId]
  );

  return (
    <NoteEditorClient
      entityId={pageId}
      initialContent={initialContent}
      title="Page"
      placeholder="Start writing your page..."
      onSave={handleSave}
      onCreateTask={handleCreateTask}
      lastEditedAtLabel={lastEditedAtLabel}
      lastEditedByLabel={lastEditedByLabel}
      showTopToolbar
      enableZoomControls
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
    />
  );
}
