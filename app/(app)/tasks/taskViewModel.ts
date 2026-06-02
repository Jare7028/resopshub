import {
  normalizeTaskStatus,
  normalizeTaskStatusOrDefault,
} from "@/lib/taskStatus";

type TaskStatusLike = {
  id: string;
  status: string | null;
};

export function normalizeTaskStatusKey(value: string | null | undefined) {
  return normalizeTaskStatus(value) || String(value || "").trim().toLowerCase();
}

export function buildHiddenTaskStatusSet(hiddenStatusValues: readonly string[]) {
  const keys = hiddenStatusValues
    .map((status) => normalizeTaskStatusKey(status))
    .filter(Boolean);
  return new Set(keys);
}

export function shouldHideHiddenTaskStatuses({
  hideCompleted,
  hiddenStatusSet,
  selectedStatusValues,
}: {
  hideCompleted: boolean;
  hiddenStatusSet: ReadonlySet<string>;
  selectedStatusValues: readonly string[];
}) {
  if (!hideCompleted || hiddenStatusSet.size === 0) {
    return false;
  }

  return !selectedStatusValues.some((status) =>
    hiddenStatusSet.has(normalizeTaskStatusKey(status))
  );
}

export function filterTasksByHiddenStatus<T extends TaskStatusLike>({
  tasks,
  hiddenStatusSet,
  optimisticStatusByTaskId,
  shouldHideHiddenStatuses,
}: {
  tasks: readonly T[];
  hiddenStatusSet: ReadonlySet<string>;
  optimisticStatusByTaskId: Record<string, string>;
  shouldHideHiddenStatuses: boolean;
}) {
  if (!shouldHideHiddenStatuses) {
    return tasks;
  }

  return tasks.filter((task) => {
    const status =
      optimisticStatusByTaskId[task.id] || normalizeTaskStatusKey(task.status);
    return !hiddenStatusSet.has(status);
  });
}

export function buildTaskStatusMap<T extends TaskStatusLike>(tasks: readonly T[]) {
  const map = new Map<string, string>();
  tasks.forEach((task) => {
    map.set(task.id, normalizeTaskStatusOrDefault(task.status));
  });
  return map;
}

export function buildEffectiveTaskStatusMap<T extends TaskStatusLike>(
  tasks: readonly T[],
  optimisticStatusByTaskId: Record<string, string>
) {
  const map = buildTaskStatusMap(tasks);
  Object.entries(optimisticStatusByTaskId).forEach(([taskId, status]) => {
    map.set(taskId, status);
  });
  return map;
}

export function groupTasksByStatus<T extends TaskStatusLike>({
  tasks,
  statusOptions,
  effectiveStatusByTaskId,
}: {
  tasks: readonly T[];
  statusOptions: readonly string[];
  effectiveStatusByTaskId: ReadonlyMap<string, string>;
}) {
  const buckets = new Map<string, T[]>();
  statusOptions.forEach((status) => buckets.set(status, []));

  tasks.forEach((task) => {
    const normalized =
      effectiveStatusByTaskId.get(task.id) ||
      normalizeTaskStatusOrDefault(task.status);
    const bucketKey = buckets.has(normalized)
      ? normalized
      : statusOptions[0] || normalized;
    const bucket = buckets.get(bucketKey);
    if (bucket) {
      bucket.push(task);
    }
  });

  return buckets;
}
