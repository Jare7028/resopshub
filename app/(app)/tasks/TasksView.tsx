"use client";

import Link from "next/link";
import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import { useRouter } from "next/navigation";
import TaskInlineRow from "./TaskInlineRow";
import {
  normalizeTaskSortDir,
  normalizeTaskSortKey,
  type TaskSortDir,
  type TaskSortKey,
} from "@/lib/taskSorting";
import { setCsvParam } from "@/lib/queryParams";
import {
  formatTaskStatusLabel,
  normalizeTaskStatus,
  normalizeTaskStatusOrDefault,
} from "@/lib/taskStatus";
import { duePillClasses, getDueUrgency, priorityPillClasses } from "@/lib/taskIndicators";
import { defaultStatusColorHex } from "@/lib/statusOptions";
import {
  statusBarStyle,
  statusDotStyle,
  statusPillStyle,
} from "@/lib/statusColorStyles";
import {
  isViewMode,
  readDefaultViewMode,
  writeDefaultViewMode,
  type ViewPreferenceScope,
} from "@/lib/viewPreferences";
import {
  persistTableColumnVisibility,
  readTableColumnVisibility,
} from "@/lib/tableColumnPreferences";
import {
  FilterIcon,
  FilterMenuMulti,
  FilterMenuSingle,
} from "../_components/TableHeaderFilters";
import MultiSelect from "../_components/MultiSelect";
import { getNextSubtaskDueDate } from "@/lib/taskNextSubtaskDueDate";
import TableColumnConfigButton, {
  type TableColumnOption,
} from "../_components/TableColumnConfigButton";

type UserOption = {
  id: string;
  full_name: string | null;
  email: string | null;
};

type AssignmentGroupOption = {
  id: string;
  name: string;
  memberCount: number;
};

type ClientOption = {
  id: string;
  name: string;
};

type ProjectOption = {
  id: string;
  name: string;
  client_id: string | null;
  clients?: { name: string | null } | { name: string | null }[] | null;
};

type TaskRow = {
  id: string;
  title: string;
  status: string | null;
  priority: string | null;
  start_date: string | null;
  due_date: string | null;
  due_time?: string | null;
  created_at: string | null;
  assignee_user_id: string | null;
  client_id: string | null;
  project_id: string | null;
  projects?: { name: string | null } | { name: string | null }[] | null;
  clients?: { name: string | null } | { name: string | null }[] | null;
};

type OpenSubtaskRow = {
  id: string;
  parent_task_id: string | null;
  title: string;
  status: string | null;
  priority: string | null;
  start_date: string | null;
  due_date: string | null;
  due_time?: string | null;
  assignee_user_id: string | null;
  client_id: string | null;
  project_id: string | null;
  projects?: { name: string | null } | { name: string | null }[] | null;
  clients?: { name: string | null } | { name: string | null }[] | null;
  assignee_user_ids: string[];
};

type TasksViewProps = {
  tasks: TaskRow[];
  users: UserOption[];
  groups: AssignmentGroupOption[];
  clients: ClientOption[];
  projects: ProjectOption[];
  assigneesByTask: Record<string, string[]>;
  openSubtaskCountByTaskId: Record<string, number>;
  openSubtasksByParentId?: Record<string, OpenSubtaskRow[]>;
  statusOptions: readonly string[];
  priorityOptions: readonly string[];
  dueOptions: readonly { value: string; label: string }[];
  initialView?: "table" | "gantt" | "board";
  returnTo: string;
  initialFilters: {
    status: string[];
    priority: string[];
    assignee: string[];
    due: string;
    client: string[];
    project: string[];
  };
  onUpdate: (formData: FormData) => Promise<unknown> | void;
  hideCompleted: boolean;
  hiddenStatusValues?: readonly string[];
  statusColorMap?: Record<string, string>;
  toggleUrl: string;
  includeWatching: boolean;
  watchToggleUrl: string;
  showWatchToggle?: boolean;
  sortKey: TaskSortKey;
  sortDir: TaskSortDir;
  addTaskUrl?: string;
  showHeaderTitle?: boolean;
  basePath?: string;
  fixedParams?: Record<string, string | null | undefined>;
  hasExplicitView?: boolean;
  viewPreferenceScope?: ViewPreferenceScope;
  filterPersistenceUserId?: string | null;
  filterPersistenceScope?: string;
  hasExplicitFilterParams?: boolean;
  columnPreferenceUserId?: string | null;
};

type HeaderMenuKey = "client" | "project" | "status" | "priority" | "assignees" | "due";
const TASK_FILTER_PERSISTENCE_KEY_PREFIX = "resolvable.task-filters.v1";
type TaskTableColumnId =
  | "task"
  | "open_subtasks"
  | "client"
  | "project"
  | "status"
  | "priority"
  | "assignees"
  | "start"
  | "next_subtask_due"
  | "due";

const TASK_REQUIRED_COLUMN_IDS = new Set<TaskTableColumnId>(["task"]);

type PersistedTaskFilterState = {
  status: string[];
  priority: string[];
  assignee: string[];
  due: string;
  client: string[];
  project: string[];
  hideCompleted: boolean;
  includeWatching: boolean;
  sortKey: TaskSortKey;
  sortDir: TaskSortDir;
  view: "table" | "gantt" | "board";
};

type TaskHoverAnchor = {
  left: number;
  bottom: number;
};

type TaskNotesHoverState = {
  open: boolean;
  taskId: string | null;
  x: number;
  y: number;
  loading: boolean;
  error: string;
  notesPreview: string | null;
};

type TaskNotesHoverPayload = {
  notesPreview: string | null;
};

const TASK_NOTES_HOVER_OPEN_DELAY_MS = 120;
const TASK_NOTES_HOVER_CLOSE_DELAY_MS = 120;
const TASK_NOTES_HOVER_WIDTH = 320;
const TASK_NOTES_HOVER_HEIGHT = 220;

function normalizeStorageList(value: unknown) {
  if (!Array.isArray(value)) return [] as string[];
  return Array.from(
    new Set(
      value
        .map((item) => String(item || "").trim())
        .filter(Boolean)
    )
  );
}

function filterAllowedValues(values: string[], allowedValues: Set<string>) {
  return values.filter((value) => allowedValues.has(value));
}

function normalizeTaskStatusKey(value: string | null | undefined) {
  return normalizeTaskStatus(value) || String(value || "").trim().toLowerCase();
}

function normalizeVisibleTaskColumns(
  values: string[],
  knownColumnIds: TaskTableColumnId[]
) {
  const knownColumnIdSet = new Set<TaskTableColumnId>(knownColumnIds);
  const normalized = Array.from(
    new Set(
      values.filter((value): value is TaskTableColumnId =>
        knownColumnIdSet.has(value as TaskTableColumnId)
      )
    )
  );

  const withRequiredColumns = normalized.slice();
  TASK_REQUIRED_COLUMN_IDS.forEach((requiredColumnId) => {
    if (!knownColumnIdSet.has(requiredColumnId)) return;
    if (!withRequiredColumns.includes(requiredColumnId)) {
      withRequiredColumns.unshift(requiredColumnId);
    }
  });

  return withRequiredColumns.length ? withRequiredColumns : knownColumnIds.slice();
}

function toDate(value?: string | null) {
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year, month, day] = value.split("-").map(Number);
    return new Date(year, month - 1, day);
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function toDayStamp(date: Date) {
  return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
}

function diffDays(start: Date, end: Date) {
  const dayMs = 1000 * 60 * 60 * 24;
  return Math.round((toDayStamp(end) - toDayStamp(start)) / dayMs);
}

function formatTick(date: Date) {
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export default function TasksView({
  tasks,
  users,
  groups,
  clients,
  projects,
  assigneesByTask,
  openSubtaskCountByTaskId,
  openSubtasksByParentId = {},
  statusOptions,
  priorityOptions,
  dueOptions,
  initialView = "table",
  returnTo,
  initialFilters,
  onUpdate,
  hideCompleted,
  hiddenStatusValues = [],
  statusColorMap = {},
  toggleUrl,
  includeWatching,
  watchToggleUrl,
  showWatchToggle = true,
  sortKey,
  sortDir,
  addTaskUrl,
  showHeaderTitle = false,
  basePath = "/tasks",
  fixedParams = {},
  hasExplicitView = false,
  viewPreferenceScope = "tasks",
  filterPersistenceUserId = null,
  filterPersistenceScope,
  hasExplicitFilterParams = false,
  columnPreferenceUserId = null,
}: TasksViewProps) {
  const [view, setView] = useState<"table" | "gantt" | "board">(initialView);
  const [defaultView, setDefaultView] = useState<"table" | "gantt" | "board" | null>(null);
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [filters, setFilters] = useState(initialFilters);
  const [openMenu, setOpenMenu] = useState<HeaderMenuKey | null>(null);
  const [openMenuPosition, setOpenMenuPosition] = useState<{ left: number; top: number } | null>(
    null
  );
  const menuRef = useRef<HTMLDivElement | null>(null);
  const openMenuAnchorRef = useRef<HTMLElement | null>(null);
  const [dragOverStatus, setDragOverStatus] = useState<string | null>(null);
  const [draggingTaskId, setDraggingTaskId] = useState<string | null>(null);
  const [optimisticStatusByTaskId, setOptimisticStatusByTaskId] = useState<
    Record<string, string>
  >({});
  const dragPreviewRef = useRef<HTMLElement | null>(null);
  const [expandedTaskIds, setExpandedTaskIds] = useState<Set<string>>(new Set());
  const [hasLoadedPersistedFilters, setHasLoadedPersistedFilters] = useState(false);
  const [taskNotesHover, setTaskNotesHover] = useState<TaskNotesHoverState>({
    open: false,
    taskId: null,
    x: 0,
    y: 0,
    loading: false,
    error: "",
    notesPreview: null,
  });
  const taskNotesHoverOpenTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const taskNotesHoverCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const taskNotesHoverRequestIdRef = useRef(0);
  const taskNotesHoverCacheRef = useRef<Record<string, TaskNotesHoverPayload>>({});
  const enableTaskNotesHover = basePath === "/tasks" && view === "table";
  const supportsNextSubtaskDueDateColumn = basePath === "/tasks";
  const showNextSubtaskDueDateColumn = supportsNextSubtaskDueDateColumn && view === "table";
  const taskStatusColorLookup = useMemo(() => {
    const lookup: Record<string, string> = {};
    statusOptions.forEach((status) => {
      const normalized = normalizeTaskStatusKey(status);
      lookup[normalized] =
        statusColorMap[normalized] ||
        statusColorMap[status] ||
        defaultStatusColorHex("task", normalized);
    });
    return lookup;
  }, [statusColorMap, statusOptions]);

  const getTaskStatusColor = useCallback(
    (status: string | null | undefined) => {
      const normalized = normalizeTaskStatusKey(status);
      if (!normalized) return defaultStatusColorHex("task", "");
      return taskStatusColorLookup[normalized] || defaultStatusColorHex("task", normalized);
    },
    [taskStatusColorLookup]
  );
  const taskTableColumns = useMemo<TableColumnOption[]>(
    () => [
      { id: "task", label: "Task", required: true },
      { id: "open_subtasks", label: "Open subtasks" },
      { id: "client", label: "Client" },
      { id: "project", label: "Project" },
      { id: "status", label: "Status" },
      { id: "priority", label: "Priority" },
      { id: "assignees", label: "Assignees" },
      { id: "start", label: "Start" },
      ...(supportsNextSubtaskDueDateColumn
        ? [{ id: "next_subtask_due", label: "Next subtask due" }]
        : []),
      { id: "due", label: "Due" },
    ],
    [supportsNextSubtaskDueDateColumn]
  );
  const taskTableColumnIds = useMemo(
    () => taskTableColumns.map((column) => column.id as TaskTableColumnId),
    [taskTableColumns]
  );
  const taskKnownColumnIdSet = useMemo(
    () => new Set<TaskTableColumnId>(taskTableColumnIds),
    [taskTableColumnIds]
  );
  const [visibleTaskColumns, setVisibleTaskColumns] = useState<TaskTableColumnId[]>(
    taskTableColumnIds
  );
  const visibleTaskColumnSet = useMemo(
    () => new Set<TaskTableColumnId>(visibleTaskColumns),
    [visibleTaskColumns]
  );
  const isTaskColumnVisible = useCallback(
    (columnId: TaskTableColumnId) => {
      if (columnId === "next_subtask_due" && !showNextSubtaskDueDateColumn) {
        return false;
      }
      return visibleTaskColumnSet.has(columnId);
    },
    [showNextSubtaskDueDateColumn, visibleTaskColumnSet]
  );

  const taskFilterPersistenceKey = useMemo(() => {
    const userId = String(filterPersistenceUserId || "").trim();
    if (!userId) return null;
    const rawScope = String(filterPersistenceScope || basePath || "/tasks")
      .trim()
      .toLowerCase();
    const scope = rawScope || "/tasks";
    return `${TASK_FILTER_PERSISTENCE_KEY_PREFIX}:${userId}:${scope}`;
  }, [basePath, filterPersistenceScope, filterPersistenceUserId]);

  const usersById = useMemo(
    () =>
      users.reduce<Record<string, string>>((acc, user) => {
        acc[user.id] = user.full_name || user.email || "Unknown user";
        return acc;
      }, {}),
    [users]
  );

  const clientNameById = useMemo(
    () =>
      clients.reduce<Record<string, string>>((acc, client) => {
        acc[client.id] = client.name;
        return acc;
      }, {}),
    [clients]
  );

  const projectNameById = useMemo(
    () =>
      projects.reduce<Record<string, string>>((acc, project) => {
        acc[project.id] = project.name;
        return acc;
      }, {}),
    [projects]
  );

  useEffect(() => {
    setVisibleTaskColumns((current) =>
      normalizeVisibleTaskColumns(current, taskTableColumnIds)
    );
  }, [taskTableColumnIds]);

  useEffect(() => {
    const loadedVisibleColumns = readTableColumnVisibility({
      scope: "tasks",
      knownColumnIds: taskKnownColumnIdSet,
      fallbackVisibleColumnIds: taskTableColumnIds,
      options: { userId: columnPreferenceUserId },
    });
    setVisibleTaskColumns(
      normalizeVisibleTaskColumns(loadedVisibleColumns, taskTableColumnIds)
    );
  }, [columnPreferenceUserId, taskKnownColumnIdSet, taskTableColumnIds]);

  useEffect(() => {
    persistTableColumnVisibility({
      scope: "tasks",
      visibleColumnIds: visibleTaskColumns,
      knownColumnIds: taskTableColumnIds,
      options: { userId: columnPreferenceUserId },
    });
  }, [columnPreferenceUserId, taskTableColumnIds, visibleTaskColumns]);

  useEffect(() => {
    const validIds = new Set(tasks.map((task) => task.id));
    setExpandedTaskIds((current) => {
      const next = new Set<string>();
      current.forEach((taskId) => {
        if (validIds.has(taskId)) {
          next.add(taskId);
        }
      });
      return next.size === current.size ? current : next;
    });
  }, [tasks]);

  useEffect(() => {
    const latestStatusByTaskId = new Map<string, string>();
    tasks.forEach((task) => {
      latestStatusByTaskId.set(task.id, normalizeTaskStatusOrDefault(task.status));
    });
    setOptimisticStatusByTaskId((current) => {
      let changed = false;
      const next: Record<string, string> = {};
      Object.entries(current).forEach(([taskId, optimisticStatus]) => {
        const latestStatus = latestStatusByTaskId.get(taskId);
        if (!latestStatus) {
          changed = true;
          return;
        }
        if (latestStatus === optimisticStatus) {
          changed = true;
          return;
        }
        next[taskId] = optimisticStatus;
      });
      return changed ? next : current;
    });
  }, [tasks]);

  useEffect(() => {
    if (!openMenu) {
      setOpenMenuPosition(null);
      openMenuAnchorRef.current = null;
      return;
    }

    const getMenuPanelWidth = (menuKey: HeaderMenuKey) => (menuKey === "due" ? 256 : 288);

    const closeOpenMenu = () => {
      setOpenMenu(null);
      setOpenMenuPosition(null);
      openMenuAnchorRef.current = null;
    };

    const syncOpenMenuPosition = () => {
      if (!openMenuAnchorRef.current || typeof window === "undefined") return;
      const rect = openMenuAnchorRef.current.getBoundingClientRect();
      const panelWidth = getMenuPanelWidth(openMenu);
      const viewportPadding = 8;
      const left = Math.min(
        Math.max(viewportPadding, rect.right - panelWidth),
        Math.max(viewportPadding, window.innerWidth - panelWidth - viewportPadding)
      );
      const top = Math.max(viewportPadding, rect.bottom + 8);
      setOpenMenuPosition({ left, top });
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeOpenMenu();
      }
    };

    const onPointerDown = (event: MouseEvent | PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (menuRef.current && !menuRef.current.contains(target)) {
        closeOpenMenu();
      }
    };

    syncOpenMenuPosition();
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("scroll", syncOpenMenuPosition, true);
    window.addEventListener("resize", syncOpenMenuPosition);

    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("scroll", syncOpenMenuPosition, true);
      window.removeEventListener("resize", syncOpenMenuPosition);
    };
  }, [openMenu]);

  const clearDragPreview = useCallback(() => {
    if (dragPreviewRef.current) {
      dragPreviewRef.current.remove();
      dragPreviewRef.current = null;
    }
  }, []);

  useEffect(() => clearDragPreview, [clearDragPreview]);

  const resetDragState = useCallback(() => {
    setDraggingTaskId(null);
    setDragOverStatus(null);
    clearDragPreview();
  }, [clearDragPreview]);

  useEffect(() => {
    const onDragFinish = () => {
      resetDragState();
    };

    window.addEventListener("dragend", onDragFinish);
    window.addEventListener("drop", onDragFinish);

    return () => {
      window.removeEventListener("dragend", onDragFinish);
      window.removeEventListener("drop", onDragFinish);
    };
  }, [resetDragState]);

  const clearTaskNotesHoverOpen = useCallback(() => {
    if (taskNotesHoverOpenTimerRef.current) {
      clearTimeout(taskNotesHoverOpenTimerRef.current);
      taskNotesHoverOpenTimerRef.current = null;
    }
  }, []);

  const clearTaskNotesHoverClose = useCallback(() => {
    if (taskNotesHoverCloseTimerRef.current) {
      clearTimeout(taskNotesHoverCloseTimerRef.current);
      taskNotesHoverCloseTimerRef.current = null;
    }
  }, []);

  const closeTaskNotesHover = useCallback(() => {
    setTaskNotesHover((prev) =>
      prev.open || prev.taskId || prev.loading || prev.error || prev.notesPreview
        ? {
            open: false,
            taskId: null,
            x: 0,
            y: 0,
            loading: false,
            error: "",
            notesPreview: null,
          }
        : prev
    );
  }, []);

  const scheduleTaskNotesHoverClose = useCallback(() => {
    clearTaskNotesHoverClose();
    taskNotesHoverCloseTimerRef.current = setTimeout(() => {
      closeTaskNotesHover();
    }, TASK_NOTES_HOVER_CLOSE_DELAY_MS);
  }, [clearTaskNotesHoverClose, closeTaskNotesHover]);

  const updateTaskNotesHoverPosition = useCallback((anchor: TaskHoverAnchor) => {
    if (typeof window === "undefined") {
      return;
    }
    const nextX = Math.max(
      12,
      Math.min(window.innerWidth - TASK_NOTES_HOVER_WIDTH - 12, Math.round(anchor.left))
    );
    const nextY = Math.max(
      12,
      Math.min(window.innerHeight - TASK_NOTES_HOVER_HEIGHT - 12, Math.round(anchor.bottom + 8))
    );
    setTaskNotesHover((prev) => ({ ...prev, x: nextX, y: nextY }));
  }, []);

  const fetchTaskNotesHoverData = useCallback((taskId: string) => {
    const cached = taskNotesHoverCacheRef.current[taskId];
    if (cached) {
      setTaskNotesHover((prev) => ({
        ...prev,
        open: true,
        loading: false,
        error: "",
        notesPreview: cached.notesPreview,
      }));
      return;
    }

    const requestId = taskNotesHoverRequestIdRef.current + 1;
    taskNotesHoverRequestIdRef.current = requestId;
    setTaskNotesHover((prev) => ({
      ...prev,
      open: true,
      loading: true,
      error: "",
      notesPreview: null,
    }));

    void fetch(`/api/tasks/${taskId}/hover`, { cache: "no-store" })
      .then(async (response) => {
        const payload = (await response.json().catch(() => ({}))) as {
          notesPreview?: unknown;
          error?: string;
        };
        if (!response.ok) {
          throw new Error(
            typeof payload.error === "string" && payload.error.trim()
              ? payload.error
              : "Unable to load notes"
          );
        }
        if (taskNotesHoverRequestIdRef.current !== requestId) {
          return;
        }
        const notesPreview =
          typeof payload.notesPreview === "string"
            ? payload.notesPreview.trim() || null
            : null;
        const nextPayload: TaskNotesHoverPayload = { notesPreview };
        taskNotesHoverCacheRef.current[taskId] = nextPayload;
        setTaskNotesHover((prev) => ({
          ...prev,
          open: true,
          loading: false,
          error: "",
          notesPreview: nextPayload.notesPreview,
        }));
      })
      .catch((error: unknown) => {
        if (taskNotesHoverRequestIdRef.current !== requestId) {
          return;
        }
        setTaskNotesHover((prev) => ({
          ...prev,
          open: true,
          loading: false,
          error: error instanceof Error ? error.message : "Unable to load notes",
          notesPreview: null,
        }));
      });
  }, []);

  const handleTaskTitleHoverStart = useCallback(
    (taskId: string, anchor: TaskHoverAnchor) => {
      if (!enableTaskNotesHover) {
        return;
      }
      clearTaskNotesHoverClose();
      clearTaskNotesHoverOpen();
      taskNotesHoverOpenTimerRef.current = setTimeout(() => {
        updateTaskNotesHoverPosition(anchor);
        setTaskNotesHover((prev) => ({ ...prev, open: true, taskId }));
        fetchTaskNotesHoverData(taskId);
      }, TASK_NOTES_HOVER_OPEN_DELAY_MS);
    },
    [
      clearTaskNotesHoverClose,
      clearTaskNotesHoverOpen,
      enableTaskNotesHover,
      fetchTaskNotesHoverData,
      updateTaskNotesHoverPosition,
    ]
  );

  const handleTaskTitleHoverMove = useCallback(
    (taskId: string, anchor: TaskHoverAnchor) => {
      if (!enableTaskNotesHover) {
        return;
      }
      if (taskNotesHover.open && taskNotesHover.taskId === taskId) {
        clearTaskNotesHoverClose();
        updateTaskNotesHoverPosition(anchor);
      }
    },
    [
      clearTaskNotesHoverClose,
      enableTaskNotesHover,
      taskNotesHover.open,
      taskNotesHover.taskId,
      updateTaskNotesHoverPosition,
    ]
  );

  const handleTaskTitleHoverEnd = useCallback(() => {
    clearTaskNotesHoverOpen();
    if (!enableTaskNotesHover) {
      return;
    }
    scheduleTaskNotesHoverClose();
  }, [clearTaskNotesHoverOpen, enableTaskNotesHover, scheduleTaskNotesHoverClose]);

  useEffect(() => {
    if (enableTaskNotesHover) {
      return;
    }
    clearTaskNotesHoverOpen();
    clearTaskNotesHoverClose();
    closeTaskNotesHover();
  }, [
    clearTaskNotesHoverClose,
    clearTaskNotesHoverOpen,
    closeTaskNotesHover,
    enableTaskNotesHover,
  ]);

  useEffect(
    () => () => {
      clearTaskNotesHoverOpen();
      clearTaskNotesHoverClose();
    },
    [clearTaskNotesHoverClose, clearTaskNotesHoverOpen]
  );

  const setDragPreviewFromCard = useCallback(
    (event: { dataTransfer: DataTransfer; currentTarget: EventTarget & HTMLElement }) => {
      if (typeof document === "undefined") return;
      clearDragPreview();
      const sourceCard = event.currentTarget;
      const sourceRect = sourceCard.getBoundingClientRect();
      if (!sourceRect.width || !sourceRect.height) return;
      const preview = sourceCard.cloneNode(true) as HTMLElement;
      preview.style.position = "fixed";
      preview.style.top = "-10000px";
      preview.style.left = "-10000px";
      preview.style.width = `${sourceRect.width}px`;
      preview.style.maxWidth = `${sourceRect.width}px`;
      preview.style.pointerEvents = "none";
      preview.style.margin = "0";
      preview.style.opacity = "0.96";
      preview.style.transform = "rotate(1.25deg)";
      preview.style.boxShadow = "0 18px 40px rgba(15, 23, 42, 0.24)";
      preview.style.borderRadius = "12px";
      preview.style.zIndex = "2147483647";
      document.body.appendChild(preview);
      dragPreviewRef.current = preview;
      event.dataTransfer.setDragImage(preview, 28, 24);
    },
    [clearDragPreview]
  );

  const initialKey = useMemo(() => JSON.stringify(initialFilters), [initialFilters]);
  useEffect(() => {
    setFilters(initialFilters);
  }, [initialKey, initialFilters]);

  const buildQuery = useCallback(
    (
      next: typeof filters,
      nextSortKey: TaskSortKey,
      nextSortDir: TaskSortDir,
      nextView: typeof view,
      nextHideCompleted: boolean,
      nextIncludeWatching: boolean = includeWatching
    ) => {
      const params = new URLSearchParams();
      Object.entries(fixedParams).forEach(([key, value]) => {
        const normalized = String(value || "").trim();
        if (normalized) {
          params.set(key, normalized);
        }
      });
      setCsvParam(params, "status", next.status);
      setCsvParam(params, "priority", next.priority);
      setCsvParam(params, "assignee", next.assignee);
      setCsvParam(params, "client", next.client);
      setCsvParam(params, "project", next.project);
      if (next.due && next.due !== "all") params.set("due", next.due);
      if (!nextHideCompleted) {
        params.set("hide", "0");
      }
      if (nextIncludeWatching) {
        params.set("watch", "1");
      }
      if (nextSortKey !== "created" || nextSortDir !== "desc") {
        params.set("sort", nextSortKey);
        params.set("dir", nextSortDir);
      }
      if (nextView !== "table") {
        params.set("view", nextView);
      }
      return params.toString();
    },
    [fixedParams, includeWatching]
  );

  useEffect(() => {
    setHasLoadedPersistedFilters(!taskFilterPersistenceKey);
  }, [taskFilterPersistenceKey]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!taskFilterPersistenceKey || hasLoadedPersistedFilters) return;

    if (hasExplicitFilterParams) {
      setHasLoadedPersistedFilters(true);
      return;
    }

    try {
      const raw = window.localStorage.getItem(taskFilterPersistenceKey);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<PersistedTaskFilterState>;
        const statusSet = new Set(statusOptions.map((value) => String(value).trim()));
        const prioritySet = new Set(priorityOptions.map((value) => String(value).trim()));
        const assigneeSet = new Set(users.map((value) => String(value.id).trim()));
        assigneeSet.add("unassigned");
        const dueSet = new Set(dueOptions.map((value) => String(value.value).trim()));
        const clientSet = new Set(clients.map((value) => String(value.id).trim()));
        const projectSet = new Set(projects.map((value) => String(value.id).trim()));

        const nextFilters = {
          status: filterAllowedValues(normalizeStorageList(parsed.status), statusSet),
          priority: filterAllowedValues(normalizeStorageList(parsed.priority), prioritySet),
          assignee: filterAllowedValues(normalizeStorageList(parsed.assignee), assigneeSet),
          due:
            dueSet.has(String(parsed.due || "").trim()) && String(parsed.due || "").trim()
              ? String(parsed.due || "").trim()
              : "all",
          client: filterAllowedValues(normalizeStorageList(parsed.client), clientSet),
          project: filterAllowedValues(normalizeStorageList(parsed.project), projectSet),
        };
        const nextHideCompleted =
          typeof parsed.hideCompleted === "boolean" ? parsed.hideCompleted : hideCompleted;
        const nextIncludeWatching =
          typeof parsed.includeWatching === "boolean" ? parsed.includeWatching : includeWatching;
        const nextSortKey = normalizeTaskSortKey(String(parsed.sortKey || sortKey || ""));
        const nextSortDir = normalizeTaskSortDir(String(parsed.sortDir || sortDir || ""));
        const parsedView = String(parsed.view || "").trim();
        const nextView = isViewMode(parsedView) ? parsedView : view;
        const currentQuery = buildQuery(filters, sortKey, sortDir, view, hideCompleted);
        const restoredQuery = buildQuery(
          nextFilters,
          nextSortKey,
          nextSortDir,
          nextView,
          nextHideCompleted,
          nextIncludeWatching
        );

        if (restoredQuery !== currentQuery) {
          setFilters(nextFilters);
          setView(nextView);
          startTransition(() => {
            router.replace(restoredQuery ? `${basePath}?${restoredQuery}` : basePath, {
              scroll: false,
            });
          });
        }
      }
    } catch {
      // Ignore localStorage and JSON parse failures.
    }

    setHasLoadedPersistedFilters(true);
  }, [
    basePath,
    buildQuery,
    clients,
    dueOptions,
    filters,
    hasExplicitFilterParams,
    hasLoadedPersistedFilters,
    hideCompleted,
    includeWatching,
    priorityOptions,
    projects,
    router,
    sortDir,
    sortKey,
    startTransition,
    statusOptions,
    taskFilterPersistenceKey,
    users,
    view,
  ]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!taskFilterPersistenceKey || !hasLoadedPersistedFilters) return;

    const payload: PersistedTaskFilterState = {
      status: filters.status,
      priority: filters.priority,
      assignee: filters.assignee,
      due: filters.due,
      client: filters.client,
      project: filters.project,
      hideCompleted,
      includeWatching,
      sortKey,
      sortDir,
      view,
    };

    try {
      window.localStorage.setItem(taskFilterPersistenceKey, JSON.stringify(payload));
    } catch {
      // Ignore localStorage write failures.
    }
  }, [
    filters,
    hasLoadedPersistedFilters,
    hideCompleted,
    includeWatching,
    sortDir,
    sortKey,
    taskFilterPersistenceKey,
    view,
  ]);

  const inlineReturnToQuery = buildQuery(filters, sortKey, sortDir, view, hideCompleted);
  const inlineReturnTo = inlineReturnToQuery ? `${basePath}?${inlineReturnToQuery}` : returnTo;

  const applyFilters = (next: typeof filters) => {
    setFilters(next);
    const query = buildQuery(next, sortKey, sortDir, view, hideCompleted);
    startTransition(() => {
      router.replace(query ? `${basePath}?${query}` : basePath, { scroll: false });
    });
  };

  const buildSortUrl = (key: TaskSortKey) => {
    const nextDir: TaskSortDir =
      sortKey === key && sortDir === "asc" ? "desc" : "asc";
    const query = buildQuery(filters, key, nextDir, view, hideCompleted);
    return query ? `${basePath}?${query}` : basePath;
  };

  const applyView = (nextView: typeof view) => {
    setView(nextView);
    const query = buildQuery(filters, sortKey, sortDir, nextView, hideCompleted);
    startTransition(() => {
      router.replace(query ? `${basePath}?${query}` : basePath, { scroll: false });
    });
  };

  useEffect(() => {
    setView(initialView);
  }, [initialView]);

  useEffect(() => {
    setDefaultView(readDefaultViewMode(viewPreferenceScope));
  }, [viewPreferenceScope]);

  /* eslint-disable react-hooks/exhaustive-deps */
  useEffect(() => {
    if (hasExplicitView) return;
    const savedDefaultView = readDefaultViewMode(viewPreferenceScope);
    if (savedDefaultView && savedDefaultView !== initialView) {
      applyView(savedDefaultView);
    }
  }, [hasExplicitView, initialView, viewPreferenceScope]);
  /* eslint-enable react-hooks/exhaustive-deps */

  const saveDefaultView = () => {
    writeDefaultViewMode(viewPreferenceScope, view);
    setDefaultView(view);
  };

  const headerClass = (key: TaskSortKey) =>
    `inline-flex items-center gap-2 hover:text-slate-900 ${
      sortKey === key ? "text-slate-900" : "text-slate-500"
    }`;

  const sortIndicator = (key: TaskSortKey) => {
    if (sortKey !== key) return null;
    return (
      <span aria-hidden="true" className="text-[10px] text-slate-400">
        {sortDir === "asc" ? "^" : "v"}
      </span>
    );
  };

  const hiddenStatusSet = useMemo(() => {
    const keys = hiddenStatusValues
      .map((status) => normalizeTaskStatusKey(status))
      .filter(Boolean);
    return new Set(keys);
  }, [hiddenStatusValues]);

  const hasSelectedHiddenStatus = filters.status.some((status) =>
    hiddenStatusSet.has(normalizeTaskStatusKey(status))
  );

  const shouldHideHiddenStatuses =
    hideCompleted && hiddenStatusSet.size > 0 && !hasSelectedHiddenStatus;

  const visibleTasks = useMemo(() => {
    if (!shouldHideHiddenStatuses) {
      return tasks;
    }
    return tasks.filter((task) => {
      const status = optimisticStatusByTaskId[task.id] || normalizeTaskStatusKey(task.status);
      return !hiddenStatusSet.has(status);
    });
  }, [hiddenStatusSet, optimisticStatusByTaskId, shouldHideHiddenStatuses, tasks]);

  useEffect(() => {
    if (!taskNotesHover.taskId) {
      return;
    }
    const visibleTaskIdSet = new Set(visibleTasks.map((task) => task.id));
    if (!visibleTaskIdSet.has(taskNotesHover.taskId)) {
      closeTaskNotesHover();
    }
  }, [closeTaskNotesHover, taskNotesHover.taskId, visibleTasks]);

  const ganttData = useMemo(() => {
    const normalized = visibleTasks.map((task) => {
      const startDate =
        toDate(task.start_date) ??
        toDate(task.created_at) ??
        toDate(task.due_date) ??
        new Date();
      const dueDate = toDate(task.due_date) ?? startDate;
      const start = startDate;
      const end = dueDate < start ? start : dueDate;
      return { ...task, start, end };
    });

    if (!normalized.length) {
      const today = new Date();
      return {
        tasks: [],
        rangeStart: today,
        rangeEnd: today,
        rangeDays: 1,
      };
    }

    const rangeStart = normalized.reduce((min, task) =>
      task.start < min ? task.start : min
    , normalized[0].start);
    const rangeEnd = normalized.reduce((max, task) =>
      task.end > max ? task.end : max
    , normalized[0].end);
    const rangeDays = Math.max(1, diffDays(rangeStart, rangeEnd) + 1);

    return { tasks: normalized, rangeStart, rangeEnd, rangeDays };
  }, [visibleTasks]);

  const timelineWidth = useMemo(() => {
    const dayWidth = 18;
    return Math.max(560, ganttData.rangeDays * dayWidth);
  }, [ganttData.rangeDays]);

  const timelineTicks = useMemo(() => {
    const ticks = [];
    const steps = 4;
    for (let i = 0; i <= steps; i += 1) {
      const offset = Math.round((ganttData.rangeDays - 1) * (i / steps));
      const tickDate = new Date(ganttData.rangeStart);
      tickDate.setDate(tickDate.getDate() + offset);
      ticks.push({ label: formatTick(tickDate), left: (i / steps) * 100 });
    }
    return ticks;
  }, [ganttData.rangeDays, ganttData.rangeStart]);

  const todayMarker = useMemo(() => {
    if (!ganttData.rangeDays) return null;
    const todayOffset = diffDays(ganttData.rangeStart, new Date());
    if (todayOffset < 0 || todayOffset > ganttData.rangeDays - 1) return null;
    return { leftPercent: (todayOffset / ganttData.rangeDays) * 100 };
  }, [ganttData.rangeDays, ganttData.rangeStart]);

  const statusByTaskId = useMemo(() => {
    const map = new Map<string, string>();
    tasks.forEach((task) => {
      map.set(task.id, normalizeTaskStatusOrDefault(task.status));
    });
    return map;
  }, [tasks]);

  const effectiveStatusByTaskId = useMemo(() => {
    const map = new Map(statusByTaskId);
    Object.entries(optimisticStatusByTaskId).forEach(([taskId, status]) => {
      map.set(taskId, status);
    });
    return map;
  }, [optimisticStatusByTaskId, statusByTaskId]);

  const nextSubtaskDueDateByTaskId = useMemo(() => {
    if (!showNextSubtaskDueDateColumn) {
      return {} as Record<string, string | null>;
    }
    const nextDueByTaskId: Record<string, string | null> = {};
    visibleTasks.forEach((task) => {
      nextDueByTaskId[task.id] = getNextSubtaskDueDate({
        subtasks: openSubtasksByParentId[task.id] || [],
        effectiveStatusByTaskId,
      });
    });
    return nextDueByTaskId;
  }, [
    effectiveStatusByTaskId,
    openSubtasksByParentId,
    showNextSubtaskDueDateColumn,
    visibleTasks,
  ]);

  const boardTasksByStatus = useMemo(() => {
    const buckets = new Map<string, TaskRow[]>();
    statusOptions.forEach((status) => buckets.set(status, []));
    visibleTasks.forEach((task) => {
      const normalized =
        effectiveStatusByTaskId.get(task.id) || normalizeTaskStatusOrDefault(task.status);
      const bucketKey = buckets.has(normalized)
        ? normalized
        : statusOptions[0] || normalized;
      const bucket = buckets.get(bucketKey);
      if (bucket) {
        bucket.push(task);
      }
    });
    return buckets;
  }, [effectiveStatusByTaskId, statusOptions, visibleTasks]);

  const submitStatusUpdate = (taskId: string, status: string) => {
    const previousStatus = effectiveStatusByTaskId.get(taskId);
    setOptimisticStatusByTaskId((current) => {
      if (current[taskId] === status) {
        return current;
      }
      return {
        ...current,
        [taskId]: status,
      };
    });

    const formData = new FormData();
    formData.set("task_id", taskId);
    formData.set("status", status);
    formData.set("return_to", inlineReturnTo);

    startTransition(() => {
      void Promise.resolve(onUpdate(formData)).catch(() => {
        setOptimisticStatusByTaskId((current) => {
          if (!(taskId in current)) {
            return current;
          }
          if (!previousStatus) {
            const next = { ...current };
            delete next[taskId];
            return next;
          }
          return {
            ...current,
            [taskId]: previousStatus,
          };
        });
      });
    });
  };

  const toggleSubtasks = (taskId: string) => {
    setExpandedTaskIds((current) => {
      const nextExpandedTaskIds = new Set(current);
      if (nextExpandedTaskIds.has(taskId)) {
        nextExpandedTaskIds.delete(taskId);
      } else {
        nextExpandedTaskIds.add(taskId);
      }
      return nextExpandedTaskIds;
    });
  };

  const getAssigneeLabel = (userIds: string[]) => {
    if (!userIds.length) {
      return "Unassigned";
    }
    if (userIds.length > 1) {
      return `${usersById[userIds[0]] || "Assigned"} +${userIds.length - 1}`;
    }
    return usersById[userIds[0]] || "Assigned";
  };

  const getMenuPanelWidth = useCallback(
    (menuKey: HeaderMenuKey) => (menuKey === "due" ? 256 : 288),
    []
  );

  const computeHeaderMenuPosition = useCallback(
    (trigger: HTMLElement, menuKey: HeaderMenuKey) => {
      if (typeof window === "undefined") return null;
      const rect = trigger.getBoundingClientRect();
      const panelWidth = getMenuPanelWidth(menuKey);
      const viewportPadding = 8;
      const left = Math.min(
        Math.max(viewportPadding, rect.right - panelWidth),
        Math.max(viewportPadding, window.innerWidth - panelWidth - viewportPadding)
      );
      const top = Math.max(viewportPadding, rect.bottom + 8);
      return { left, top };
    },
    [getMenuPanelWidth]
  );

  const toggleHeaderMenu = useCallback(
    (menuKey: HeaderMenuKey, trigger: HTMLElement) => {
      if (openMenu === menuKey) {
        setOpenMenu(null);
        setOpenMenuPosition(null);
        openMenuAnchorRef.current = null;
        return;
      }
      openMenuAnchorRef.current = trigger;
      const nextPosition = computeHeaderMenuPosition(trigger, menuKey);
      setOpenMenuPosition(nextPosition);
      setOpenMenu(menuKey);
    },
    [computeHeaderMenuPosition, openMenu]
  );
  const tableColSpan = taskTableColumnIds.reduce((count, columnId) => {
    return isTaskColumnVisible(columnId) ? count + 1 : count;
  }, 0);

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-4 md:px-6">
        <div className="flex flex-wrap items-center gap-3">
          {view === "table" ? (
            <TableColumnConfigButton
              columns={taskTableColumns}
              visibleColumnIds={visibleTaskColumns}
              onVisibleColumnIdsChange={(nextVisibleColumnIds) =>
                setVisibleTaskColumns(
                  normalizeVisibleTaskColumns(nextVisibleColumnIds, taskTableColumnIds)
                )
              }
            />
          ) : null}
          {showHeaderTitle ? (
            <h2 className="text-lg font-semibold text-slate-900">Tasks</h2>
          ) : null}
          {addTaskUrl ? (
            <Link
              href={addTaskUrl}
              className="inline-flex min-h-11 items-center rounded-md border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:border-slate-400 hover:text-slate-900"
            >
              Add task
            </Link>
          ) : null}
          <a
            href={toggleUrl}
            onClick={(event) => {
              event.preventDefault();
              const query = buildQuery(
                filters,
                sortKey,
                sortDir,
                view,
                !hideCompleted
              );
              startTransition(() => {
                router.replace(query ? `${basePath}?${query}` : basePath, { scroll: false });
              });
            }}
            className="inline-flex min-h-11 items-center rounded-md border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:border-slate-400 hover:text-slate-900"
          >
            {hideCompleted ? "Show closed" : "Hide closed"}
          </a>
          {showWatchToggle ? (
            <a
              href={watchToggleUrl}
              onClick={(event) => {
                event.preventDefault();
                const query = buildQuery(
                  filters,
                  sortKey,
                  sortDir,
                  view,
                  hideCompleted
                );
                const params = new URLSearchParams(query);
                if (includeWatching) {
                  params.delete("watch");
                } else {
                  params.set("watch", "1");
                }
                const nextQuery = params.toString();
                startTransition(() => {
                  router.replace(nextQuery ? `${basePath}?${nextQuery}` : basePath, { scroll: false });
                });
              }}
              className={`inline-flex min-h-11 items-center rounded-md border px-3 py-1.5 text-xs font-semibold ${
                includeWatching
                  ? "border-blue-300 bg-blue-50 text-blue-700 hover:border-blue-400 hover:text-blue-800"
                  : "border-slate-300 text-slate-700 hover:border-slate-400 hover:text-slate-900"
              }`}
            >
              {includeWatching ? "Hide Tickets I'm watching" : "Show Tickets I'm watching"}
            </a>
          ) : null}
        </div>
        <div className="grid w-full grid-cols-2 gap-2 text-sm md:flex md:w-auto md:items-center md:gap-2">
          <button
            type="button"
            onClick={() => applyView("table")}
            className={`min-h-11 w-full rounded-md px-3 py-1.5 font-semibold md:w-auto ${
              view === "table"
                ? "bg-slate-900 text-white"
                : "border border-slate-300 text-slate-700"
            }`}
          >
            Table
          </button>
          <button
            type="button"
            onClick={() => applyView("gantt")}
            className={`min-h-11 w-full rounded-md px-3 py-1.5 font-semibold md:w-auto ${
              view === "gantt"
                ? "bg-slate-900 text-white"
                : "border border-slate-300 text-slate-700"
            }`}
          >
            Gantt
          </button>
          <button
            type="button"
            onClick={() => applyView("board")}
            className={`min-h-11 w-full rounded-md px-3 py-1.5 font-semibold md:w-auto ${
              view === "board"
                ? "bg-slate-900 text-white"
                : "border border-slate-300 text-slate-700"
            }`}
          >
            Board
          </button>
          <button
            type="button"
            onClick={saveDefaultView}
            className={`min-h-11 w-full rounded-md border px-3 py-1.5 text-xs font-semibold md:w-auto ${
              defaultView === view
                ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                : "border-slate-300 text-slate-700 hover:border-slate-400 hover:text-slate-900"
            }`}
          >
            {defaultView === view ? "Default view" : "Set as default"}
          </button>
        </div>
      </div>

      {view === "table" ? (
        <>
        <div className="mobile-filter-panel md:hidden">
          <div className="grid gap-3 sm:grid-cols-2">
            <MultiSelect
              options={statusOptions.map((status) => ({
                value: status,
                label: formatTaskStatusLabel(status),
              }))}
              selectedValues={filters.status}
              placeholder="All statuses"
              onChange={(next) => applyFilters({ ...filters, status: next })}
            />
            <MultiSelect
              options={priorityOptions.map((priority) => ({
                value: priority,
                label: priority,
              }))}
              selectedValues={filters.priority}
              placeholder="All priorities"
              onChange={(next) => applyFilters({ ...filters, priority: next })}
            />
            <MultiSelect
              options={[
                { value: "unassigned", label: "Unassigned" },
                ...users.map((user) => ({
                  value: user.id,
                  label: user.full_name || user.email || "Unnamed user",
                })),
              ]}
              selectedValues={filters.assignee}
              placeholder="All assignees"
              onChange={(next) => applyFilters({ ...filters, assignee: next })}
            />
            <select
              value={filters.due}
              onChange={(event) => applyFilters({ ...filters, due: event.target.value })}
              className="h-11 rounded-md border border-slate-300 px-3 text-sm text-slate-700"
            >
              {dueOptions.map((filter) => (
                <option key={filter.value} value={filter.value}>
                  {filter.label}
                </option>
              ))}
            </select>
            <MultiSelect
              options={clients.map((client) => ({ value: client.id, label: client.name }))}
              selectedValues={filters.client}
              placeholder="All clients"
              onChange={(next) => applyFilters({ ...filters, client: next })}
            />
            <MultiSelect
              options={projects.map((project) => {
                const clientName = Array.isArray(project.clients)
                  ? project.clients[0]?.name
                  : project.clients?.name;
                return {
                  value: project.id,
                  label: clientName ? `${project.name} - ${clientName}` : project.name,
                };
              })}
              selectedValues={filters.project}
              placeholder="All projects"
              onChange={(next) => applyFilters({ ...filters, project: next })}
            />
          </div>
        </div>
        <div className="hidden overflow-x-auto md:block">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                {isTaskColumnVisible("task") ? (
                  <th className="px-6 py-3">
                    <a href={buildSortUrl("title")} className={headerClass("title")}>
                      Task
                      {sortIndicator("title")}
                    </a>
                  </th>
                ) : null}
                {isTaskColumnVisible("open_subtasks") ? (
                  <th className="px-6 py-3 text-right text-slate-700">Open subtasks</th>
                ) : null}
                {isTaskColumnVisible("client") ? (
                  <th className="px-6 py-3">
                    <div className="relative flex items-center justify-between gap-2">
                      <a href={buildSortUrl("client")} className={headerClass("client")}>
                        Client
                        {sortIndicator("client")}
                      </a>
                      <button
                        type="button"
                        aria-label="Filter client"
                        onClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          toggleHeaderMenu("client", event.currentTarget);
                        }}
                      >
                        <FilterIcon active={filters.client.length > 0} />
                      </button>
                      {openMenu === "client" ? (
                        <div
                          ref={menuRef}
                          className="fixed z-[260]"
                          style={
                            openMenuPosition
                              ? { left: openMenuPosition.left, top: openMenuPosition.top }
                              : { left: 8, top: 8 }
                          }
                        >
                          <FilterMenuMulti
                            title="Client"
                            options={clients.map((client) => ({
                              value: client.id,
                              label: client.name,
                            }))}
                            selectedValues={filters.client}
                            onChange={(next) => applyFilters({ ...filters, client: next })}
                            onClear={() => applyFilters({ ...filters, client: [] })}
                          />
                        </div>
                      ) : null}
                    </div>
                  </th>
                ) : null}
                {isTaskColumnVisible("project") ? (
                  <th className="px-6 py-3">
                    <div className="relative flex items-center justify-between gap-2">
                      <a href={buildSortUrl("project")} className={headerClass("project")}>
                        Project
                        {sortIndicator("project")}
                      </a>
                      <button
                        type="button"
                        aria-label="Filter project"
                        onClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          toggleHeaderMenu("project", event.currentTarget);
                        }}
                      >
                        <FilterIcon active={filters.project.length > 0} />
                      </button>
                      {openMenu === "project" ? (
                        <div
                          ref={menuRef}
                          className="fixed z-[260]"
                          style={
                            openMenuPosition
                              ? { left: openMenuPosition.left, top: openMenuPosition.top }
                              : { left: 8, top: 8 }
                          }
                        >
                          <FilterMenuMulti
                            title="Project"
                            options={projects.map((project) => {
                              const clientName = Array.isArray(project.clients)
                                ? project.clients[0]?.name
                                : project.clients?.name;
                              const label = clientName
                                ? `${project.name} - ${clientName}`
                                : project.name;
                              return { value: project.id, label };
                            })}
                            selectedValues={filters.project}
                            onChange={(next) => applyFilters({ ...filters, project: next })}
                            onClear={() => applyFilters({ ...filters, project: [] })}
                          />
                        </div>
                      ) : null}
                    </div>
                  </th>
                ) : null}
                {isTaskColumnVisible("status") ? (
                  <th className="px-6 py-3">
                    <div className="relative flex items-center justify-between gap-2">
                      <a href={buildSortUrl("status")} className={headerClass("status")}>
                        Status
                        {sortIndicator("status")}
                      </a>
                      <button
                        type="button"
                        aria-label="Filter status"
                        onClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          toggleHeaderMenu("status", event.currentTarget);
                        }}
                      >
                        <FilterIcon active={filters.status.length > 0} />
                      </button>
                      {openMenu === "status" ? (
                        <div
                          ref={menuRef}
                          className="fixed z-[260]"
                          style={
                            openMenuPosition
                              ? { left: openMenuPosition.left, top: openMenuPosition.top }
                              : { left: 8, top: 8 }
                          }
                        >
                          <FilterMenuMulti
                            title="Status"
                            options={statusOptions.map((status) => ({
                              value: status,
                              label: formatTaskStatusLabel(status),
                            }))}
                            selectedValues={filters.status}
                            onChange={(next) => applyFilters({ ...filters, status: next })}
                            onClear={() => applyFilters({ ...filters, status: [] })}
                          />
                        </div>
                      ) : null}
                    </div>
                  </th>
                ) : null}
                {isTaskColumnVisible("priority") ? (
                  <th className="px-6 py-3">
                    <div className="relative flex items-center justify-between gap-2">
                      <a
                        href={buildSortUrl("priority")}
                        className={headerClass("priority")}
                      >
                        Priority
                        {sortIndicator("priority")}
                      </a>
                      <button
                        type="button"
                        aria-label="Filter priority"
                        onClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          toggleHeaderMenu("priority", event.currentTarget);
                        }}
                      >
                        <FilterIcon active={filters.priority.length > 0} />
                      </button>
                      {openMenu === "priority" ? (
                        <div
                          ref={menuRef}
                          className="fixed z-[260]"
                          style={
                            openMenuPosition
                              ? { left: openMenuPosition.left, top: openMenuPosition.top }
                              : { left: 8, top: 8 }
                          }
                        >
                          <FilterMenuMulti
                            title="Priority"
                            options={priorityOptions.map((priority) => ({
                              value: priority,
                              label: priority,
                            }))}
                            selectedValues={filters.priority}
                            onChange={(next) => applyFilters({ ...filters, priority: next })}
                            onClear={() => applyFilters({ ...filters, priority: [] })}
                          />
                        </div>
                      ) : null}
                    </div>
                  </th>
                ) : null}
                {isTaskColumnVisible("assignees") ? (
                  <th className="px-6 py-3">
                    <div className="relative flex items-center justify-between gap-2">
                      <a
                        href={buildSortUrl("assignees")}
                        className={headerClass("assignees")}
                      >
                        Assignees
                        {sortIndicator("assignees")}
                      </a>
                      <button
                        type="button"
                        aria-label="Filter assignees"
                        onClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          toggleHeaderMenu("assignees", event.currentTarget);
                        }}
                      >
                        <FilterIcon active={filters.assignee.length > 0} />
                      </button>
                      {openMenu === "assignees" ? (
                        <div
                          ref={menuRef}
                          className="fixed z-[260]"
                          style={
                            openMenuPosition
                              ? { left: openMenuPosition.left, top: openMenuPosition.top }
                              : { left: 8, top: 8 }
                          }
                        >
                          <FilterMenuMulti
                            title="Assignees"
                            options={[
                              { value: "unassigned", label: "Unassigned" },
                              ...users.map((user) => ({
                                value: user.id,
                                label: user.full_name || user.email || "Unnamed user",
                              })),
                            ]}
                            selectedValues={filters.assignee}
                            onChange={(next) => applyFilters({ ...filters, assignee: next })}
                            onClear={() => applyFilters({ ...filters, assignee: [] })}
                          />
                        </div>
                      ) : null}
                    </div>
                  </th>
                ) : null}
                {isTaskColumnVisible("start") ? (
                  <th className="px-6 py-3">
                    <a href={buildSortUrl("start")} className={headerClass("start")}>
                      Start
                      {sortIndicator("start")}
                    </a>
                  </th>
                ) : null}
                {isTaskColumnVisible("next_subtask_due") ? (
                  <th className="px-6 py-3 text-slate-700 whitespace-nowrap">
                    Next Subtask Due
                  </th>
                ) : null}
                {isTaskColumnVisible("due") ? (
                  <th className="px-6 py-3">
                    <div className="relative flex items-center justify-between gap-2">
                      <a href={buildSortUrl("due")} className={headerClass("due")}>
                        Due
                        {sortIndicator("due")}
                      </a>
                      <button
                        type="button"
                        aria-label="Filter due"
                        onClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          toggleHeaderMenu("due", event.currentTarget);
                        }}
                      >
                        <FilterIcon active={filters.due !== "all"} />
                      </button>
                      {openMenu === "due" ? (
                        <div
                          ref={menuRef}
                          className="fixed z-[260]"
                          style={
                            openMenuPosition
                              ? { left: openMenuPosition.left, top: openMenuPosition.top }
                              : { left: 8, top: 8 }
                          }
                        >
                          <FilterMenuSingle
                            title="Due"
                            options={dueOptions.map((opt) => ({
                              value: opt.value,
                              label: opt.label,
                            }))}
                            value={filters.due}
                            onChange={(next) => applyFilters({ ...filters, due: next })}
                            onClear={() => applyFilters({ ...filters, due: "all" })}
                          />
                        </div>
                      ) : null}
                    </div>
                  </th>
                ) : null}
              </tr>
            </thead>
            <tbody>
              {visibleTasks.length ? (
                visibleTasks.map((task) => {
                  const isExpanded = expandedTaskIds.has(task.id);
                  const openSubtasks = openSubtasksByParentId[task.id] || [];
                  const visibleOpenSubtasks = shouldHideHiddenStatuses
                    ? openSubtasks.filter((subtask) => {
                        const subtaskStatus =
                          effectiveStatusByTaskId.get(subtask.id) ||
                          normalizeTaskStatusKey(subtask.status);
                        return !hiddenStatusSet.has(subtaskStatus);
                      })
                    : openSubtasks;
                  const nextSubtaskDueDateIso = nextSubtaskDueDateByTaskId[task.id] || null;
                  return (
                    <Fragment key={task.id}>
                      <TaskInlineRow
                        task={task}
                        openSubtaskCount={openSubtaskCountByTaskId[task.id] ?? 0}
                        isSubtasksExpanded={isExpanded}
                        onToggleSubtasks={toggleSubtasks}
                        assigneeUserIds={assigneesByTask[task.id] || []}
                        users={users}
                        groups={groups}
                        clients={clients}
                        projects={projects}
                        statusOptions={statusOptions}
                        statusColorMap={taskStatusColorLookup}
                        priorityOptions={priorityOptions}
                        onUpdate={onUpdate}
                        onStatusUpdate={submitStatusUpdate}
                        statusValue={
                          effectiveStatusByTaskId.get(task.id) ||
                          normalizeTaskStatusOrDefault(task.status)
                        }
                        returnTo={inlineReturnTo}
                        onTitleHoverStart={
                          enableTaskNotesHover ? handleTaskTitleHoverStart : undefined
                        }
                        onTitleHoverMove={
                          enableTaskNotesHover ? handleTaskTitleHoverMove : undefined
                        }
                        onTitleHoverEnd={
                          enableTaskNotesHover ? handleTaskTitleHoverEnd : undefined
                        }
                        visibleColumnIds={visibleTaskColumnSet}
                        showNextSubtaskDueDateColumn={showNextSubtaskDueDateColumn}
                        nextSubtaskDueDateIso={nextSubtaskDueDateIso}
                      />
                      {isExpanded
                        ? visibleOpenSubtasks.map((subtask) => (
                            <TaskInlineRow
                              key={subtask.id}
                              task={subtask}
                              assigneeUserIds={subtask.assignee_user_ids}
                              users={users}
                              groups={groups}
                              clients={clients}
                              projects={projects}
                              statusOptions={statusOptions}
                              statusColorMap={taskStatusColorLookup}
                              priorityOptions={priorityOptions}
                              onUpdate={onUpdate}
                              onStatusUpdate={submitStatusUpdate}
                              statusValue={
                                effectiveStatusByTaskId.get(subtask.id) ||
                                normalizeTaskStatusOrDefault(subtask.status)
                              }
                              returnTo={inlineReturnTo}
                              rowVariant="subtask"
                              onTitleHoverStart={
                                enableTaskNotesHover ? handleTaskTitleHoverStart : undefined
                              }
                              onTitleHoverMove={
                                enableTaskNotesHover ? handleTaskTitleHoverMove : undefined
                              }
                              onTitleHoverEnd={
                                enableTaskNotesHover ? handleTaskTitleHoverEnd : undefined
                              }
                              visibleColumnIds={visibleTaskColumnSet}
                              showNextSubtaskDueDateColumn={showNextSubtaskDueDateColumn}
                              nextSubtaskDueDateIso={null}
                            />
                          ))
                        : null}
                    </Fragment>
                  );
                })
              ) : (
                <tr>
                  <td className="px-6 py-6 text-slate-500" colSpan={tableColSpan}>
                    No tasks found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="mobile-list-stack md:hidden">
          {visibleTasks.length ? (
            visibleTasks.map((task) => {
              const assigneeIds = assigneesByTask[task.id] || [];
              const clientName = task.client_id ? clientNameById[task.client_id] || null : null;
              const projectName = task.project_id
                ? projectNameById[task.project_id] || null
                : null;
              const effectiveStatus =
                effectiveStatusByTaskId.get(task.id) ||
                normalizeTaskStatusOrDefault(task.status);
              const dueLabel = task.due_date
                ? new Date(task.due_date).toLocaleDateString("en-US")
                : "No due date";
              const dueUrgency = getDueUrgency(task.due_date, task.due_time ?? null);
              return (
                <article
                  key={`mobile-${task.id}`}
                  className="mobile-list-card space-y-3"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <Link
                      href={`/tasks/${task.id}`}
                      className="text-base font-semibold text-slate-900 hover:underline"
                    >
                      {task.title}
                    </Link>
                    <span
                      className="rounded-full border border-slate-200 bg-slate-50 px-2 py-1 text-xs font-semibold text-slate-700"
                      style={statusPillStyle(getTaskStatusColor(effectiveStatus))}
                    >
                      {formatTaskStatusLabel(effectiveStatus)}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`rounded-md border px-2 py-1 text-[11px] font-semibold ${priorityPillClasses(
                        task.priority
                      )}`}
                    >
                      {(task.priority || "medium").toLowerCase()}
                    </span>
                    <span
                      className={`rounded-md border px-2 py-1 text-[11px] font-semibold ${duePillClasses(
                        dueUrgency
                      )}`}
                    >
                      {dueLabel}
                    </span>
                    <span className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] font-semibold text-slate-700">
                      {openSubtaskCountByTaskId[task.id] ?? 0} open subtasks
                    </span>
                  </div>
                  <div className="grid gap-1 text-sm text-slate-600">
                    <p>
                      <span className="font-semibold text-slate-700">Client:</span>{" "}
                      {clientName || "-"}
                    </p>
                    <p>
                      <span className="font-semibold text-slate-700">Project:</span>{" "}
                      {projectName || "-"}
                    </p>
                    <p>
                      <span className="font-semibold text-slate-700">Assignees:</span>{" "}
                      {getAssigneeLabel(assigneeIds)}
                    </p>
                  </div>
                  <Link
                    href={`/tasks/${task.id}`}
                    className="mobile-card-action"
                  >
                    Open task
                  </Link>
                </article>
              );
            })
          ) : (
            <p className="mobile-empty-state">
              No tasks found.
            </p>
          )}
        </div>
        {enableTaskNotesHover && taskNotesHover.open && taskNotesHover.taskId ? (
          <div
            className="fixed z-[70] w-[320px] rounded-md border border-slate-200 bg-white p-3 shadow-xl"
            style={{ left: taskNotesHover.x, top: taskNotesHover.y }}
            onMouseEnter={clearTaskNotesHoverClose}
            onMouseLeave={handleTaskTitleHoverEnd}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Task notes
            </p>
            {taskNotesHover.loading ? (
              <p className="mt-2 text-sm text-slate-500">Loading notes...</p>
            ) : taskNotesHover.error ? (
              <p className="mt-2 text-sm text-red-600">{taskNotesHover.error}</p>
            ) : taskNotesHover.notesPreview ? (
              <p className="mt-2 text-sm leading-6 text-slate-700 whitespace-pre-wrap break-words">
                {taskNotesHover.notesPreview}
              </p>
            ) : (
              <p className="mt-2 text-sm text-slate-500">No available notes</p>
            )}
          </div>
        ) : null}
        </>
      ) : view === "gantt" ? (
        <div className="overflow-x-auto">
          {ganttData.tasks.length ? (
            <div className="min-w-full" style={{ minWidth: timelineWidth + 240 }}>
              <div className="grid grid-cols-[240px_1fr] border-b border-slate-200">
                <div className="px-6 py-3 text-xs font-semibold uppercase text-slate-500">
                  Task
                </div>
                <div className="relative px-6 py-3 text-xs font-semibold uppercase text-slate-500">
                  <div className="absolute inset-y-0 left-6 right-6 flex items-end">
                    {todayMarker ? (
                      <div
                        aria-hidden="true"
                        className="pointer-events-none absolute inset-y-0 border-l border-dashed opacity-60"
                        style={{
                          left: `${todayMarker.leftPercent}%`,
                          borderColor: "#6954e2",
                        }}
                      />
                    ) : null}
                    {timelineTicks.map((tick) => (
                      <span
                        key={tick.label}
                        className="absolute bottom-0 -translate-x-1/2 text-[11px] text-slate-500"
                        style={{ left: `${tick.left}%` }}
                      >
                        {tick.label}
                      </span>
                    ))}
                  </div>
                </div>
              </div>

              {ganttData.tasks.map((task) => {
                const startOffset = diffDays(ganttData.rangeStart, task.start);
                const duration = Math.max(1, diffDays(task.start, task.end) + 1);
                const leftPercent = (startOffset / ganttData.rangeDays) * 100;
                const widthPercent = (duration / ganttData.rangeDays) * 100;
                const barColor = getTaskStatusColor(task.status);

                return (
                  <div
                    key={task.id}
                    className="grid grid-cols-[240px_1fr] border-b border-slate-100"
                  >
                    <div className="px-6 py-3 text-sm text-slate-900">
                      <Link href={`/tasks/${task.id}`} className="hover:underline">
                        {task.title}
                      </Link>
                    </div>
                    <div className="relative px-6 py-3">
                      <div className="absolute inset-y-0 left-6 right-6">
                        {todayMarker ? (
                          <div
                            aria-hidden="true"
                            className="pointer-events-none absolute inset-y-0 border-l border-dashed opacity-60"
                            style={{
                              left: `${todayMarker.leftPercent}%`,
                              borderColor: "#6954e2",
                            }}
                          />
                        ) : null}
                        <Link
                          href={`/tasks/${task.id}`}
                          className="absolute top-1/2 h-3 -translate-y-1/2 rounded-full"
                          style={{
                            left: `${leftPercent}%`,
                            width: `${widthPercent}%`,
                            ...statusBarStyle(barColor),
                          }}
                          aria-label={`Open ${task.title}`}
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="px-6 py-6 text-sm text-slate-500">No tasks found.</div>
          )}
        </div>
      ) : (
        <div className="overflow-x-auto">
          {visibleTasks.length ? (
            <div className="min-w-full px-6 py-6">
              <div className="flex min-w-max gap-4">
                {statusOptions.map((status) => {
                  const columnTasks = boardTasksByStatus.get(status) || [];
                  const color = getTaskStatusColor(status);
                  const isOver = dragOverStatus === status;

                  return (
                    <div
                      key={status}
                      className={`w-72 rounded-xl border border-slate-200 bg-slate-50/60 ${
                        isOver
                          ? "bg-slate-100/80 ring-2 ring-blue-200 shadow-[0_6px_24px_rgba(15,23,42,0.12)]"
                          : ""
                      }`}
                      onDragOver={(event) => {
                        event.preventDefault();
                        setDragOverStatus(status);
                        event.dataTransfer.dropEffect = "move";
                      }}
                      onDragLeave={(event) => {
                        const nextTarget = event.relatedTarget as Node | null;
                        if (nextTarget && event.currentTarget.contains(nextTarget)) return;
                        setDragOverStatus((current) => (current === status ? null : current));
                      }}
                      onDrop={(event) => {
                        event.preventDefault();
                        const taskId =
                          event.dataTransfer.getData("application/x-resopshub-task-id") ||
                          event.dataTransfer.getData("text/plain");
                        resetDragState();
                        if (!taskId) return;
                        const currentStatus = effectiveStatusByTaskId.get(taskId);
                        if (currentStatus === status) return;
                        submitStatusUpdate(taskId, status);
                      }}
                    >
                      <div className="flex items-center justify-between gap-2 border-b border-slate-200 px-4 py-3">
                        <div className="flex items-center gap-2">
                          <span
                            className="h-2.5 w-2.5 rounded-full"
                            style={statusDotStyle(color)}
                          />
                          <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                            {formatTaskStatusLabel(status)}
                          </p>
                        </div>
                        <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-xs font-semibold text-slate-600">
                          {columnTasks.length}
                        </span>
                      </div>

                      <div className="max-h-[70vh] space-y-3 overflow-y-auto p-3">
                        {columnTasks.length ? (
                          columnTasks.map((task) => {
                            const priority = (task.priority || "medium").toLowerCase();
                            const dueLabel = task.due_date
                              ? new Date(task.due_date).toLocaleDateString("en-US")
                              : "";
                            const dueUrgency = getDueUrgency(task.due_date, task.due_time ?? null);
                            const clientName = task.client_id
                              ? clientNameById[task.client_id] || null
                              : null;
                            const projectName = task.project_id
                              ? projectNameById[task.project_id] || null
                              : null;

                            return (
                              <div
                                key={task.id}
                                draggable
                                onDragStart={(event) => {
                                  event.dataTransfer.effectAllowed = "move";
                                  event.dataTransfer.setData(
                                    "application/x-resopshub-task-id",
                                    task.id
                                  );
                                  event.dataTransfer.setData("text/plain", task.id);
                                  setDraggingTaskId(task.id);
                                  setDragPreviewFromCard(event);
                                }}
                                onDragEnd={() => {
                                  resetDragState();
                                }}
                                className={`rounded-lg border border-slate-200 bg-white p-3 shadow-sm transition-[transform,box-shadow,opacity] duration-150 ${
                                  draggingTaskId === task.id
                                    ? "scale-[0.98] cursor-grabbing opacity-45 shadow-none"
                                    : "cursor-grab hover:-translate-y-0.5 hover:shadow-md"
                                }`}
                              >
                                <Link
                                  href={`/tasks/${task.id}`}
                                  draggable={false}
                                  className="block text-sm font-semibold text-slate-900 hover:underline"
                                >
                                  {task.title}
                                </Link>

                                {(clientName || projectName) ? (
                                  <p className="mt-1 text-xs text-slate-500">
                                    {clientName || "Client N/A"}
                                    {projectName ? ` - ${projectName}` : ""}
                                  </p>
                                ) : null}

                                <div className="mt-2 flex flex-wrap items-center gap-2">
                                  <span
                                    className={`rounded-md border px-2 py-0.5 text-[11px] font-semibold ${priorityPillClasses(
                                      task.priority
                                    )}`}
                                  >
                                    {priority}
                                  </span>
                                  <span
                                    className={`rounded-md border px-2 py-0.5 text-[11px] font-semibold ${duePillClasses(
                                      dueUrgency
                                    )}`}
                                  >
                                    {dueLabel ? `Due ${dueLabel}` : "No due date"}
                                  </span>
                                </div>
                              </div>
                            );
                          })
                        ) : (
                          <p className="px-1 py-4 text-sm text-slate-500">
                            No tasks.
                          </p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="px-6 py-6 text-sm text-slate-500">No tasks found.</div>
          )}
        </div>
      )}
    </>
  );
}
