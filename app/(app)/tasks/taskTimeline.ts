type TimelineTaskBase = {
  start_date: string | null;
  due_date: string | null;
  created_at: string | null;
};

export type TimelineTask<TTask extends TimelineTaskBase> = TTask & {
  start: Date;
  end: Date;
};

export type TaskTimelineData<TTask extends TimelineTaskBase> = {
  tasks: Array<TimelineTask<TTask>>;
  rangeStart: Date;
  rangeEnd: Date;
  rangeDays: number;
};

export function parseTaskTimelineDate(value?: string | null) {
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

export function diffTimelineDays(start: Date, end: Date) {
  const dayMs = 1000 * 60 * 60 * 24;
  return Math.round((toDayStamp(end) - toDayStamp(start)) / dayMs);
}

export function formatTimelineTick(date: Date) {
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function buildTaskTimelineData<TTask extends TimelineTaskBase>(
  tasks: readonly TTask[],
  now: Date = new Date()
): TaskTimelineData<TTask> {
  const normalized = tasks.map((task) => {
    const startDate =
      parseTaskTimelineDate(task.start_date) ??
      parseTaskTimelineDate(task.created_at) ??
      parseTaskTimelineDate(task.due_date) ??
      now;
    const dueDate = parseTaskTimelineDate(task.due_date) ?? startDate;
    const start = startDate;
    const end = dueDate < start ? start : dueDate;
    return { ...task, start, end };
  });

  if (!normalized.length) {
    return {
      tasks: [],
      rangeStart: now,
      rangeEnd: now,
      rangeDays: 1,
    };
  }

  const rangeStart = normalized.reduce(
    (min, task) => (task.start < min ? task.start : min),
    normalized[0].start
  );
  const rangeEnd = normalized.reduce(
    (max, task) => (task.end > max ? task.end : max),
    normalized[0].end
  );
  const rangeDays = Math.max(1, diffTimelineDays(rangeStart, rangeEnd) + 1);

  return { tasks: normalized, rangeStart, rangeEnd, rangeDays };
}

export function buildTimelineTicks(
  rangeStart: Date,
  rangeDays: number,
  steps = 4
) {
  const safeSteps = Math.max(1, steps);
  const safeRangeDays = Math.max(1, rangeDays);
  const ticks = [];
  for (let i = 0; i <= safeSteps; i += 1) {
    const offset = Math.round((safeRangeDays - 1) * (i / safeSteps));
    const tickDate = new Date(rangeStart);
    tickDate.setDate(tickDate.getDate() + offset);
    ticks.push({ label: formatTimelineTick(tickDate), left: (i / safeSteps) * 100 });
  }
  return ticks;
}

export function buildTodayMarker(
  rangeStart: Date,
  rangeDays: number,
  now: Date = new Date()
) {
  if (!rangeDays) return null;
  const todayOffset = diffTimelineDays(rangeStart, now);
  if (todayOffset < 0 || todayOffset > rangeDays - 1) return null;
  return { leftPercent: (todayOffset / rangeDays) * 100 };
}
