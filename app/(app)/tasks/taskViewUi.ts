export type HeaderMenuKey =
  "client"
  | "project"
  | "status"
  | "priority"
  | "assignees"
  | "due";

export type TaskHoverAnchor = {
  left: number;
  bottom: number;
};

export type TaskNotesHoverState = {
  open: boolean;
  taskId: string | null;
  x: number;
  y: number;
  loading: boolean;
  error: string;
  notesPreview: string | null;
};

export type TaskNotesHoverPayload = {
  notesPreview: string | null;
};

export const TASK_NOTES_HOVER_OPEN_DELAY_MS = 120;
export const TASK_NOTES_HOVER_CLOSE_DELAY_MS = 120;
export const TASK_NOTES_HOVER_WIDTH = 320;
export const TASK_NOTES_HOVER_HEIGHT = 220;

type AnchorRect = {
  right: number;
  bottom: number;
};

export function getTaskHeaderMenuPanelWidth(menuKey: HeaderMenuKey) {
  return menuKey === "due" ? 256 : 288;
}

export function computeAnchoredPanelPosition({
  rect,
  panelWidth,
  viewportWidth,
  viewportPadding = 8,
  offsetY = 8,
}: {
  rect: AnchorRect;
  panelWidth: number;
  viewportWidth: number;
  viewportPadding?: number;
  offsetY?: number;
}) {
  const left = Math.min(
    Math.max(viewportPadding, rect.right - panelWidth),
    Math.max(viewportPadding, viewportWidth - panelWidth - viewportPadding)
  );
  const top = Math.max(viewportPadding, rect.bottom + offsetY);
  return { left, top };
}

export function computeTaskNotesHoverPosition({
  anchor,
  viewportWidth,
  viewportHeight,
  panelWidth = TASK_NOTES_HOVER_WIDTH,
  panelHeight = TASK_NOTES_HOVER_HEIGHT,
  viewportPadding = 12,
  offsetY = 8,
}: {
  anchor: TaskHoverAnchor;
  viewportWidth: number;
  viewportHeight: number;
  panelWidth?: number;
  panelHeight?: number;
  viewportPadding?: number;
  offsetY?: number;
}) {
  const x = Math.max(
    viewportPadding,
    Math.min(viewportWidth - panelWidth - viewportPadding, Math.round(anchor.left))
  );
  const y = Math.max(
    viewportPadding,
    Math.min(
      viewportHeight - panelHeight - viewportPadding,
      Math.round(anchor.bottom + offsetY)
    )
  );
  return { x, y };
}

export function buildTaskPaginationSummary({
  currentPage,
  pageSize,
  totalTaskCount,
  locallyVisibleQuickTaskCount = 0,
}: {
  currentPage: number;
  pageSize: number;
  totalTaskCount: number;
  locallyVisibleQuickTaskCount?: number;
}) {
  const normalizedPage = Math.max(1, currentPage);
  const normalizedPageSize = Math.max(1, pageSize);
  const normalizedTotalCount = Math.max(
    0,
    totalTaskCount + locallyVisibleQuickTaskCount
  );
  const showingFrom = normalizedTotalCount
    ? (normalizedPage - 1) * normalizedPageSize + 1
    : 0;
  const showingTo = normalizedTotalCount
    ? Math.min(normalizedPage * normalizedPageSize, normalizedTotalCount)
    : 0;

  return {
    normalizedPage,
    normalizedPageSize,
    normalizedTotalCount,
    showingFrom,
    showingTo,
    hasPreviousPage: normalizedPage > 1,
    hasNextPage: showingTo < normalizedTotalCount,
  };
}
