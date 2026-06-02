"use client";

import Link from "next/link";
import {
  Fragment,
  type MouseEvent as ReactMouseEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import { useRouter } from "next/navigation";
import TaskInlineRow from "./TaskInlineRow";
import QuickAddTaskModal from "./_components/QuickAddTaskModal";
import type { QuickCreateTaskResult } from "./actions";
import {
  normalizeTaskSortDir,
  normalizeTaskSortKey,
  type TaskSortDir,
  type TaskSortKey,
} from "@/lib/taskSorting";
import {
  formatTaskStatusLabel,
  normalizeTaskStatusOrDefault,
} from "@/lib/taskStatus";
import { duePillClasses, getDueUrgency, priorityPillClasses } from "@/lib/taskIndicators";
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
import TableColumnConfigButton from "../_components/TableColumnConfigButton";
import {
  buildTaskFilterPersistenceKey,
  buildTaskListQuery,
  filterAllowedValues,
  normalizeStorageList,
  normalizeVisibleTaskColumns,
  type PersistedTaskFilterState,
  type TaskFilterState,
  type TaskTableColumnId,
  type TaskViewMode,
} from "./taskTableViewState";
import {
  buildTaskTimelineData,
  diffTimelineDays,
  buildTimelineTicks,
  buildTodayMarker,
} from "./taskTimeline";
import {
  buildEffectiveTaskList,
  buildEffectiveTaskStatusMap,
  buildHiddenTaskStatusSet,
  buildNextSubtaskDueDateMap,
  filterTasksByHiddenStatus,
  groupTasksByStatus,
  mergeServerTaskRecordMap,
  normalizeTaskStatusKey,
  shouldHideHiddenTaskStatuses,
} from "./taskViewModel";
import {
  TASK_NOTES_HOVER_CLOSE_DELAY_MS,
  TASK_NOTES_HOVER_OPEN_DELAY_MS,
  buildTaskEntityNameLookup,
  buildTaskPaginationSummary,
  buildTaskStatusColorLookup,
  buildTaskTableColumns,
  buildTaskUserNameLookup,
  computeAnchoredPanelPosition,
  computeTaskNotesHoverPosition,
  getTaskAssigneeLabel,
  getTaskHeaderMenuPanelWidth,
  resolveTaskStatusColor,
  type HeaderMenuKey,
  type TaskHoverAnchor,
  type TaskNotesHoverPayload,
  type TaskNotesHoverState,
} from "./taskViewUi";

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
  initialNextSubtaskDueDateByTaskId?: Record<string, string | null>;
  statusOptions: readonly string[];
  priorityOptions: readonly string[];
  dueOptions: readonly { value: string; label: string }[];
  initialView?: TaskViewMode;
  returnTo: string;
  initialFilters: TaskFilterState;
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
  searchQuery?: string;
  currentPage?: number;
  pageSize?: number;
  totalTaskCount?: number;
  onSavePreferences?: (formData: FormData) => Promise<unknown> | void;
  onQuickCreate?: (formData: FormData) => Promise<QuickCreateTaskResult>;
};

type QuickCreateTaskSuccess = Extract<QuickCreateTaskResult, { ok: true }>;

export default function TasksView({
  tasks,
  users,
  groups,
  clients,
  projects,
  assigneesByTask,
  openSubtaskCountByTaskId,
  openSubtasksByParentId = {},
  initialNextSubtaskDueDateByTaskId = {},
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
  searchQuery = "",
  currentPage = 1,
  pageSize = 50,
  totalTaskCount = tasks.length,
  onSavePreferences,
  onQuickCreate,
}: TasksViewProps) {
  const [view, setView] = useState<TaskViewMode>(initialView);
  const [defaultView, setDefaultView] = useState<TaskViewMode | null>(null);
  const [isOpeningAddTask, setIsOpeningAddTask] = useState(false);
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [filters, setFilters] = useState(initialFilters);
  const [taskSearchQuery, setTaskSearchQuery] = useState(searchQuery);
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
  const [quickCreatedTasks, setQuickCreatedTasks] = useState<TaskRow[]>([]);
  const [quickCreatedAssigneesByTask, setQuickCreatedAssigneesByTask] = useState<
    Record<string, string[]>
  >({});
  const [quickCreatedOpenSubtaskCountByTaskId, setQuickCreatedOpenSubtaskCountByTaskId] =
    useState<Record<string, number>>({});
  const [quickCreatedSubtasksByParentId, setQuickCreatedSubtasksByParentId] = useState<
    Record<string, OpenSubtaskRow[]>
  >({});
  const effectiveTasks = useMemo(
    () => buildEffectiveTaskList({ quickCreatedTasks, serverTasks: tasks }),
    [quickCreatedTasks, tasks]
  );
  const locallyVisibleQuickTaskCount = Math.max(0, effectiveTasks.length - tasks.length);
  const effectiveAssigneesByTask = useMemo(
    () =>
      mergeServerTaskRecordMap({
        quickCreatedValues: quickCreatedAssigneesByTask,
        serverValues: assigneesByTask,
      }),
    [assigneesByTask, quickCreatedAssigneesByTask]
  );
  const effectiveOpenSubtaskCountByTaskId = useMemo(
    () =>
      mergeServerTaskRecordMap({
        quickCreatedValues: quickCreatedOpenSubtaskCountByTaskId,
        serverValues: openSubtaskCountByTaskId,
      }),
    [openSubtaskCountByTaskId, quickCreatedOpenSubtaskCountByTaskId]
  );
  const effectiveOpenSubtasksByParentId = useMemo(
    () =>
      mergeServerTaskRecordMap({
        quickCreatedValues: quickCreatedSubtasksByParentId,
        serverValues: openSubtasksByParentId,
      }),
    [openSubtasksByParentId, quickCreatedSubtasksByParentId]
  );
  const [loadedSubtasksByParentId, setLoadedSubtasksByParentId] = useState<
    Record<string, OpenSubtaskRow[]>
  >(effectiveOpenSubtasksByParentId);
  const [subtasksLoadingByTaskId, setSubtasksLoadingByTaskId] = useState<Record<string, boolean>>(
    {}
  );
  const [subtasksErrorByTaskId, setSubtasksErrorByTaskId] = useState<Record<string, string>>({});
  const subtasksRequestInFlightRef = useRef<Set<string>>(new Set());
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
  const taskStatusColorLookup = useMemo(
    () => buildTaskStatusColorLookup({ statusOptions, statusColorMap }),
    [statusColorMap, statusOptions]
  );

  const getTaskStatusColor = useCallback(
    (status: string | null | undefined) => {
      return resolveTaskStatusColor(status, taskStatusColorLookup);
    },
    [taskStatusColorLookup]
  );
  const taskTableColumns = useMemo(
    () => buildTaskTableColumns({ supportsNextSubtaskDueDateColumn }),
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
    return buildTaskFilterPersistenceKey({
      userId: filterPersistenceUserId,
      scope: filterPersistenceScope || basePath,
    });
  }, [basePath, filterPersistenceScope, filterPersistenceUserId]);

  const usersById = useMemo(
    () => buildTaskUserNameLookup(users),
    [users]
  );

  const clientNameById = useMemo(
    () => buildTaskEntityNameLookup(clients),
    [clients]
  );

  const projectNameById = useMemo(
    () => buildTaskEntityNameLookup(projects),
    [projects]
  );

  const handleQuickTaskCreated = useCallback((result: QuickCreateTaskSuccess) => {
    setQuickCreatedTasks((current) => [
      result.task,
      ...current.filter((task) => task.id !== result.task.id),
    ]);
    setQuickCreatedAssigneesByTask((current) => ({
      ...current,
      [result.task.id]: result.assigneeUserIds,
    }));
    setQuickCreatedOpenSubtaskCountByTaskId((current) => ({
      ...current,
      [result.task.id]: result.openSubtaskCount,
    }));

    if (result.subtasks.length) {
      setQuickCreatedSubtasksByParentId((current) => ({
        ...current,
        [result.task.id]: result.subtasks,
      }));
      setLoadedSubtasksByParentId((current) => ({
        ...current,
        [result.task.id]: result.subtasks,
      }));
      setExpandedTaskIds((current) => {
        const next = new Set(current);
        next.add(result.task.id);
        return next;
      });
    }
  }, []);

  useEffect(() => {
    setLoadedSubtasksByParentId(effectiveOpenSubtasksByParentId);
    setSubtasksLoadingByTaskId({});
    setSubtasksErrorByTaskId({});
    subtasksRequestInFlightRef.current.clear();
  }, [effectiveOpenSubtasksByParentId]);

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
    const validIds = new Set(effectiveTasks.map((task) => task.id));
    setExpandedTaskIds((current) => {
      const next = new Set<string>();
      current.forEach((taskId) => {
        if (validIds.has(taskId)) {
          next.add(taskId);
        }
      });
      return next.size === current.size ? current : next;
    });
  }, [effectiveTasks]);

  useEffect(() => {
    const latestStatusByTaskId = new Map<string, string>();
    effectiveTasks.forEach((task) => {
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
  }, [effectiveTasks]);

  useEffect(() => {
    if (!openMenu) {
      setOpenMenuPosition(null);
      openMenuAnchorRef.current = null;
      return;
    }

    const closeOpenMenu = () => {
      setOpenMenu(null);
      setOpenMenuPosition(null);
      openMenuAnchorRef.current = null;
    };

    const syncOpenMenuPosition = () => {
      if (!openMenuAnchorRef.current || typeof window === "undefined") return;
      const rect = openMenuAnchorRef.current.getBoundingClientRect();
      setOpenMenuPosition(
        computeAnchoredPanelPosition({
          rect,
          panelWidth: getTaskHeaderMenuPanelWidth(openMenu),
          viewportWidth: window.innerWidth,
        })
      );
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
    const nextPosition = computeTaskNotesHoverPosition({
      anchor,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
    });
    setTaskNotesHover((prev) => ({
      ...prev,
      x: nextPosition.x,
      y: nextPosition.y,
    }));
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

  useEffect(() => {
    setTaskSearchQuery(searchQuery);
  }, [searchQuery]);

  const buildQuery = useCallback(
    (
      next: typeof filters,
      nextSortKey: TaskSortKey,
      nextSortDir: TaskSortDir,
      nextView: typeof view,
      nextHideCompleted: boolean,
      nextIncludeWatching: boolean = includeWatching,
      nextSearchQuery: string = taskSearchQuery,
      nextPage: number = 1
    ) => {
      return buildTaskListQuery({
        filters: next,
        sortKey: nextSortKey,
        sortDir: nextSortDir,
        view: nextView,
        hideCompleted: nextHideCompleted,
        includeWatching: nextIncludeWatching,
        searchQuery: nextSearchQuery,
        page: nextPage,
        fixedParams,
      });
    },
    [fixedParams, includeWatching, taskSearchQuery]
  );

  const saveTaskPreferences = useCallback(
    (
      nextFilters: typeof filters,
      nextSortKey: TaskSortKey,
      nextSortDir: TaskSortDir,
      nextView: typeof view,
      nextHideCompleted: boolean,
      nextIncludeWatching: boolean
    ) => {
      if (!onSavePreferences) return;
      const formData = new FormData();
      const setCsvField = (key: string, values: string[]) => {
        const cleaned = Array.from(
          new Set(values.map((value) => value.trim()).filter(Boolean))
        );
        formData.set(key, cleaned.join(","));
      };
      setCsvField("status", nextFilters.status);
      setCsvField("priority", nextFilters.priority);
      setCsvField("assignee", nextFilters.assignee);
      setCsvField("client", nextFilters.client);
      setCsvField("project", nextFilters.project);
      formData.set("due", nextFilters.due || "all");
      formData.set("hide_completed", nextHideCompleted ? "1" : "0");
      formData.set("include_watching", nextIncludeWatching ? "1" : "0");
      formData.set("sort_key", nextSortKey);
      formData.set("sort_dir", nextSortDir);
      formData.set("view_mode", nextView);
      void Promise.resolve(onSavePreferences(formData)).catch(() => {
        // Preference writes should never block navigation or inline work.
      });
    },
    [onSavePreferences]
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

        const restoredAssignees = filterAllowedValues(
          normalizeStorageList(parsed.assignee),
          assigneeSet
        );
        const nextFilters = {
          status: filterAllowedValues(normalizeStorageList(parsed.status), statusSet),
          priority: filterAllowedValues(normalizeStorageList(parsed.priority), prioritySet),
          assignee: restoredAssignees.length > 0 ? restoredAssignees : initialFilters.assignee,
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
    initialFilters.assignee,
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

  const inlineReturnToQuery = buildQuery(
    filters,
    sortKey,
    sortDir,
    view,
    hideCompleted,
    includeWatching,
    taskSearchQuery,
    currentPage
  );
  const inlineReturnTo = inlineReturnToQuery ? `${basePath}?${inlineReturnToQuery}` : returnTo;

  const applyFilters = (next: typeof filters) => {
    setFilters(next);
    const query = buildQuery(next, sortKey, sortDir, view, hideCompleted);
    saveTaskPreferences(next, sortKey, sortDir, view, hideCompleted, includeWatching);
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

  const applySort = (key: TaskSortKey) => {
    const nextDir: TaskSortDir =
      sortKey === key && sortDir === "asc" ? "desc" : "asc";
    const query = buildQuery(filters, key, nextDir, view, hideCompleted);
    saveTaskPreferences(filters, key, nextDir, view, hideCompleted, includeWatching);
    startTransition(() => {
      router.replace(query ? `${basePath}?${query}` : basePath, { scroll: false });
    });
  };

  const applyView = (nextView: typeof view) => {
    setView(nextView);
    const query = buildQuery(filters, sortKey, sortDir, nextView, hideCompleted);
    saveTaskPreferences(filters, sortKey, sortDir, nextView, hideCompleted, includeWatching);
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

  useEffect(() => {
    if (hasExplicitView) return;
    const savedDefaultView = readDefaultViewMode(viewPreferenceScope);
    if (savedDefaultView && savedDefaultView !== initialView) {
      setView(savedDefaultView);
    }
  }, [hasExplicitView, initialView, viewPreferenceScope]);

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

  const hiddenStatusSet = useMemo(
    () => buildHiddenTaskStatusSet(hiddenStatusValues),
    [hiddenStatusValues]
  );

  const shouldHideHiddenStatuses = shouldHideHiddenTaskStatuses({
    hideCompleted,
    hiddenStatusSet,
    selectedStatusValues: filters.status,
  });

  const visibleTasks = useMemo(() => {
    return filterTasksByHiddenStatus({
      tasks: effectiveTasks,
      hiddenStatusSet,
      optimisticStatusByTaskId,
      shouldHideHiddenStatuses,
    });
  }, [effectiveTasks, hiddenStatusSet, optimisticStatusByTaskId, shouldHideHiddenStatuses]);

  useEffect(() => {
    if (!taskNotesHover.taskId) {
      return;
    }
    const visibleTaskIdSet = new Set(visibleTasks.map((task) => task.id));
    if (!visibleTaskIdSet.has(taskNotesHover.taskId)) {
      closeTaskNotesHover();
    }
  }, [closeTaskNotesHover, taskNotesHover.taskId, visibleTasks]);

  const ganttData = useMemo(() => buildTaskTimelineData(visibleTasks), [visibleTasks]);

  const timelineWidth = useMemo(() => {
    const dayWidth = 18;
    return Math.max(560, ganttData.rangeDays * dayWidth);
  }, [ganttData.rangeDays]);

  const timelineTicks = useMemo(() => {
    return buildTimelineTicks(ganttData.rangeStart, ganttData.rangeDays);
  }, [ganttData.rangeDays, ganttData.rangeStart]);

  const todayMarker = useMemo(() => {
    return buildTodayMarker(ganttData.rangeStart, ganttData.rangeDays);
  }, [ganttData.rangeDays, ganttData.rangeStart]);

  const effectiveStatusByTaskId = useMemo(() => {
    return buildEffectiveTaskStatusMap(effectiveTasks, optimisticStatusByTaskId);
  }, [effectiveTasks, optimisticStatusByTaskId]);

  const nextSubtaskDueDateByTaskId = useMemo(() => {
    return buildNextSubtaskDueDateMap({
      enabled: showNextSubtaskDueDateColumn,
      initialNextSubtaskDueDateByTaskId,
      visibleTasks,
      loadedSubtasksByParentId,
      effectiveStatusByTaskId,
    });
  }, [
    effectiveStatusByTaskId,
    initialNextSubtaskDueDateByTaskId,
    loadedSubtasksByParentId,
    showNextSubtaskDueDateColumn,
    visibleTasks,
  ]);

  const boardTasksByStatus = useMemo(() => {
    return groupTasksByStatus({
      tasks: visibleTasks,
      statusOptions,
      effectiveStatusByTaskId,
    });
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

  const loadSubtasksForTask = useCallback(
    async (taskId: string) => {
      if (!taskId) return;
      if (Object.prototype.hasOwnProperty.call(loadedSubtasksByParentId, taskId)) return;
      if (subtasksRequestInFlightRef.current.has(taskId)) return;

      subtasksRequestInFlightRef.current.add(taskId);
      setSubtasksLoadingByTaskId((current) => ({ ...current, [taskId]: true }));
      setSubtasksErrorByTaskId((current) => {
        if (!(taskId in current)) return current;
        const next = { ...current };
        delete next[taskId];
        return next;
      });

      try {
        const response = await fetch(`/api/tasks/${taskId}/subtasks`, { cache: "no-store" });
        const payload = (await response.json().catch(() => ({}))) as {
          subtasks?: OpenSubtaskRow[];
          error?: string;
        };
        if (!response.ok) {
          throw new Error(
            typeof payload.error === "string" && payload.error.trim()
              ? payload.error
              : "Unable to load subtasks"
          );
        }
        const subtasks = Array.isArray(payload.subtasks) ? payload.subtasks : [];
        setLoadedSubtasksByParentId((current) => ({
          ...current,
          [taskId]: subtasks,
        }));
      } catch (error) {
        setSubtasksErrorByTaskId((current) => ({
          ...current,
          [taskId]: error instanceof Error ? error.message : "Unable to load subtasks",
        }));
      } finally {
        subtasksRequestInFlightRef.current.delete(taskId);
        setSubtasksLoadingByTaskId((current) => {
          if (!(taskId in current)) return current;
          const next = { ...current };
          delete next[taskId];
          return next;
        });
      }
    },
    [loadedSubtasksByParentId]
  );

  const toggleSubtasks = (taskId: string) => {
    const isExpanded = expandedTaskIds.has(taskId);
    setExpandedTaskIds((current) => {
      const nextExpandedTaskIds = new Set(current);
      if (nextExpandedTaskIds.has(taskId)) {
        nextExpandedTaskIds.delete(taskId);
      } else {
        nextExpandedTaskIds.add(taskId);
      }
      return nextExpandedTaskIds;
    });

    if (
      !isExpanded &&
      (effectiveOpenSubtaskCountByTaskId[taskId] ?? 0) > 0 &&
      !Object.prototype.hasOwnProperty.call(loadedSubtasksByParentId, taskId)
    ) {
      void loadSubtasksForTask(taskId);
    }
  };

  const getAssigneeLabel = useCallback(
    (userIds: string[]) => getTaskAssigneeLabel(userIds, usersById),
    [usersById]
  );

  const computeHeaderMenuPosition = useCallback(
    (trigger: HTMLElement, menuKey: HeaderMenuKey) => {
      if (typeof window === "undefined") return null;
      const rect = trigger.getBoundingClientRect();
      return computeAnchoredPanelPosition({
        rect,
        panelWidth: getTaskHeaderMenuPanelWidth(menuKey),
        viewportWidth: window.innerWidth,
      });
    },
    []
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
  const {
    normalizedPage,
    normalizedTotalCount,
    showingFrom,
    showingTo,
    hasPreviousPage,
    hasNextPage,
  } = buildTaskPaginationSummary({
    currentPage,
    pageSize,
    totalTaskCount,
    locallyVisibleQuickTaskCount,
  });
  const buildPageUrl = (page: number) => {
    const query = buildQuery(
      filters,
      sortKey,
      sortDir,
      view,
      hideCompleted,
      includeWatching,
      searchQuery,
      page
    );
    return query ? `${basePath}?${query}` : basePath;
  };
  const applySearch = (nextSearchQuery: string) => {
    const query = buildQuery(
      filters,
      sortKey,
      sortDir,
      view,
      hideCompleted,
      includeWatching,
      nextSearchQuery,
      1
    );
    startTransition(() => {
      router.replace(query ? `${basePath}?${query}` : basePath, { scroll: false });
    });
  };
  const handleAddTaskClick = (event: ReactMouseEvent<HTMLAnchorElement>) => {
    if (
      event.defaultPrevented ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey ||
      event.button !== 0
    ) {
      return;
    }
    setIsOpeningAddTask(true);
  };

  return (
    <>
      {onQuickCreate ? (
        <QuickAddTaskModal
          open={quickAddOpen}
          advancedHref={addTaskUrl}
          onClose={() => setQuickAddOpen(false)}
          onCreate={onQuickCreate}
          onCreated={handleQuickTaskCreated}
        />
      ) : null}
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
          {onQuickCreate ? (
            <button
              type="button"
              onClick={() => setQuickAddOpen(true)}
              className="inline-flex min-h-11 items-center rounded-md border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:border-slate-400 hover:text-slate-900"
            >
              Add task
            </button>
          ) : addTaskUrl ? (
            <Link
              href={addTaskUrl}
              prefetch={false}
              onClick={handleAddTaskClick}
              aria-disabled={isOpeningAddTask}
              className="inline-flex min-h-11 items-center rounded-md border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:border-slate-400 hover:text-slate-900"
            >
              {isOpeningAddTask ? "Opening..." : "Add task"}
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
              saveTaskPreferences(
                filters,
                sortKey,
                sortDir,
                view,
                !hideCompleted,
                includeWatching
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
                saveTaskPreferences(
                  filters,
                  sortKey,
                  sortDir,
                  view,
                  hideCompleted,
                  !includeWatching
                );
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
          <button
            type="button"
            onClick={() => applySort("queue")}
            className={`inline-flex min-h-11 items-center rounded-md border px-3 py-1.5 text-xs font-semibold ${
              sortKey === "queue"
                ? "border-indigo-300 bg-indigo-50 text-indigo-700 hover:border-indigo-400 hover:text-indigo-800"
                : "border-slate-300 text-slate-700 hover:border-slate-400 hover:text-slate-900"
            }`}
          >
            My queue
          </button>
        </div>
        <form
          className="flex w-full min-w-0 items-center gap-2 md:max-w-md"
          onSubmit={(event) => {
            event.preventDefault();
            applySearch(taskSearchQuery);
          }}
        >
          <input
            type="search"
            value={taskSearchQuery}
            onChange={(event) => setTaskSearchQuery(event.target.value)}
            className="min-h-11 min-w-0 flex-1 rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
            placeholder="Search tasks or notes"
            aria-label="Search tasks or notes"
          />
          <button
            type="submit"
            className="inline-flex min-h-11 items-center rounded-md border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:border-slate-400 hover:text-slate-900"
          >
            Search
          </button>
          {searchQuery ? (
            <button
              type="button"
              onClick={() => {
                setTaskSearchQuery("");
                applySearch("");
              }}
              className="inline-flex min-h-11 items-center rounded-md border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:border-slate-400 hover:text-slate-900"
            >
              Clear
            </button>
          ) : null}
        </form>
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
                    <a
                      href={buildSortUrl("title")}
                      className={headerClass("title")}
                      onClick={(event) => {
                        event.preventDefault();
                        applySort("title");
                      }}
                    >
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
                      <a
                        href={buildSortUrl("client")}
                        className={headerClass("client")}
                        onClick={(event) => {
                          event.preventDefault();
                          applySort("client");
                        }}
                      >
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
                      <a
                        href={buildSortUrl("project")}
                        className={headerClass("project")}
                        onClick={(event) => {
                          event.preventDefault();
                          applySort("project");
                        }}
                      >
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
                      <a
                        href={buildSortUrl("status")}
                        className={headerClass("status")}
                        onClick={(event) => {
                          event.preventDefault();
                          applySort("status");
                        }}
                      >
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
                        onClick={(event) => {
                          event.preventDefault();
                          applySort("priority");
                        }}
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
                        onClick={(event) => {
                          event.preventDefault();
                          applySort("assignees");
                        }}
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
                    <a
                      href={buildSortUrl("start")}
                      className={headerClass("start")}
                      onClick={(event) => {
                        event.preventDefault();
                        applySort("start");
                      }}
                    >
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
                       <a
                         href={buildSortUrl("due")}
                         className={headerClass("due")}
                         onClick={(event) => {
                           event.preventDefault();
                           applySort("due");
                         }}
                       >
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
                  const openSubtasks = loadedSubtasksByParentId[task.id] || [];
                  const visibleOpenSubtasks = shouldHideHiddenStatuses
                    ? openSubtasks.filter((subtask) => {
                        const subtaskStatus =
                          effectiveStatusByTaskId.get(subtask.id) ||
                          normalizeTaskStatusKey(subtask.status);
                        return !hiddenStatusSet.has(subtaskStatus);
                      })
                    : openSubtasks;
                  const isSubtasksLoading = Boolean(subtasksLoadingByTaskId[task.id]);
                  const subtaskLoadError = subtasksErrorByTaskId[task.id] || "";
                  const nextSubtaskDueDateIso = nextSubtaskDueDateByTaskId[task.id] || null;
                  return (
                    <Fragment key={task.id}>
                      <TaskInlineRow
                        task={task}
                        openSubtaskCount={effectiveOpenSubtaskCountByTaskId[task.id] ?? 0}
                        isSubtasksExpanded={isExpanded}
                        onToggleSubtasks={toggleSubtasks}
                        assigneeUserIds={effectiveAssigneesByTask[task.id] || []}
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
                      {isExpanded ? (
                        <>
                          {isSubtasksLoading ? (
                            <tr className="border-t border-slate-100 bg-slate-50/60">
                              <td className="px-6 py-3 text-sm text-slate-500" colSpan={tableColSpan}>
                                Loading subtasks...
                              </td>
                            </tr>
                          ) : null}
                          {!isSubtasksLoading && subtaskLoadError ? (
                            <tr className="border-t border-slate-100 bg-rose-50/50">
                              <td className="px-6 py-3 text-sm text-rose-700" colSpan={tableColSpan}>
                                <div className="flex items-center justify-between gap-3">
                                  <span>{subtaskLoadError}</span>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      void loadSubtasksForTask(task.id);
                                    }}
                                    className="rounded-md border border-rose-300 px-2 py-1 text-xs font-semibold text-rose-700 hover:bg-rose-100"
                                  >
                                    Retry
                                  </button>
                                </div>
                              </td>
                            </tr>
                          ) : null}
                          {!isSubtasksLoading && !subtaskLoadError
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
                        </>
                      ) : null}
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
              const assigneeIds = effectiveAssigneesByTask[task.id] || [];
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
                      prefetch={false}
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
                      {effectiveOpenSubtaskCountByTaskId[task.id] ?? 0} open subtasks
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
                    prefetch={false}
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
                const startOffset = diffTimelineDays(ganttData.rangeStart, task.start);
                const duration = Math.max(1, diffTimelineDays(task.start, task.end) + 1);
                const leftPercent = (startOffset / ganttData.rangeDays) * 100;
                const widthPercent = (duration / ganttData.rangeDays) * 100;
                const barColor = getTaskStatusColor(task.status);

                return (
                  <div
                    key={task.id}
                    className="grid grid-cols-[240px_1fr] border-b border-slate-100"
                  >
                    <div className="px-6 py-3 text-sm text-slate-900">
                      <Link href={`/tasks/${task.id}`} prefetch={false} className="hover:underline">
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
                          prefetch={false}
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
                                  prefetch={false}
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
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 px-4 py-3 text-sm text-slate-600 md:px-6">
        <p>
          {normalizedTotalCount
            ? `Showing ${showingFrom}-${showingTo} of ${normalizedTotalCount}`
            : searchQuery
              ? "No tasks match this search."
              : "No tasks match these filters."}
        </p>
        {(hasPreviousPage || hasNextPage) ? (
          <div className="flex items-center gap-2">
            {hasPreviousPage ? (
              <Link
                href={buildPageUrl(normalizedPage - 1)}
                className="inline-flex min-h-10 items-center rounded-md border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:border-slate-400 hover:text-slate-900"
              >
                Previous
              </Link>
            ) : null}
            {hasNextPage ? (
              <Link
                href={buildPageUrl(normalizedPage + 1)}
                className="inline-flex min-h-10 items-center rounded-md border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:border-slate-400 hover:text-slate-900"
              >
                Next
              </Link>
            ) : null}
          </div>
        ) : null}
      </div>
    </>
  );
}
