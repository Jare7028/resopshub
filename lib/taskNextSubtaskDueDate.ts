type SubtaskDueDateCandidate = {
  id: string;
  status: string | null;
  due_date: string | null;
};

type EffectiveStatusLookup = Map<string, string> | Record<string, string>;

function normalizeStatusForDueDate(status: string | null | undefined) {
  if (typeof status !== "string") {
    return "";
  }
  return status.trim().toLowerCase().replace(/[-\s]+/g, "_");
}

function readEffectiveStatus(
  taskId: string,
  effectiveStatusByTaskId?: EffectiveStatusLookup
) {
  if (!effectiveStatusByTaskId) {
    return null;
  }
  if (effectiveStatusByTaskId instanceof Map) {
    const value = effectiveStatusByTaskId.get(taskId);
    return typeof value === "string" ? value : null;
  }
  const value = effectiveStatusByTaskId[taskId];
  return typeof value === "string" ? value : null;
}

export function getNextSubtaskDueDate(args: {
  subtasks: SubtaskDueDateCandidate[];
  effectiveStatusByTaskId?: EffectiveStatusLookup;
}) {
  let earliestDueDate: string | null = null;

  args.subtasks.forEach((subtask) => {
    const effectiveStatus = normalizeStatusForDueDate(
      readEffectiveStatus(subtask.id, args.effectiveStatusByTaskId) ?? subtask.status
    );
    if (effectiveStatus === "completed" || effectiveStatus === "cancelled") {
      return;
    }

    const dueDate = String(subtask.due_date || "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) {
      return;
    }

    if (!earliestDueDate || dueDate < earliestDueDate) {
      earliestDueDate = dueDate;
    }
  });

  return earliestDueDate;
}
