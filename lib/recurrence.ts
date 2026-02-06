export const DEFAULT_RECURRENCE_TZ =
  process.env.NOTIFICATIONS_TZ || "America/New_York";

export function formatYmdInTimeZone(date: Date, timeZone: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function ymdToDate(ymd: string) {
  return new Date(`${ymd}T00:00:00Z`);
}

export function ymdFromDate(date: Date) {
  const year = date.getUTCFullYear();
  const month = `${date.getUTCMonth() + 1}`.padStart(2, "0");
  const day = `${date.getUTCDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function addDaysToYmd(ymd: string, days: number) {
  const date = ymdToDate(ymd);
  date.setUTCDate(date.getUTCDate() + days);
  return ymdFromDate(date);
}

function addMonthsToYmd(ymd: string, months: number) {
  const date = ymdToDate(ymd);
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  const day = date.getUTCDate();
  const target = new Date(Date.UTC(year, month + months, 1));
  const lastDay = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)
  ).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  return ymdFromDate(target);
}

function lastDayOfMonth(year: number, monthIndex: number) {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

function weekdayOfYmd(ymd: string) {
  return ymdToDate(ymd).getUTCDay();
}

function nthWeekdayOfMonth(
  year: number,
  monthIndex: number,
  week: number,
  weekday: number
) {
  if (week === -1) {
    const lastDay = new Date(Date.UTC(year, monthIndex + 1, 0));
    const lastWeekday = lastDay.getUTCDay();
    const offset = (lastWeekday - weekday + 7) % 7;
    const date = new Date(Date.UTC(year, monthIndex, lastDay.getUTCDate() - offset));
    return ymdFromDate(date);
  }
  const firstDay = new Date(Date.UTC(year, monthIndex, 1));
  const firstWeekday = firstDay.getUTCDay();
  const offset = (weekday - firstWeekday + 7) % 7;
  const day = 1 + offset + (week - 1) * 7;
  return ymdFromDate(new Date(Date.UTC(year, monthIndex, day)));
}

export type RecurrenceConfig = {
  frequency: "daily" | "weekly" | "monthly";
  interval: number;
  startDate: string;
  endDate?: string | null;
  weekdays?: number[] | null;
  monthDay?: number | null;
  monthWeek?: number | null;
  monthWeekday?: number | null;
};

export function getFirstOccurrence(config: RecurrenceConfig) {
  const interval = Math.max(config.interval || 1, 1);
  if (config.frequency === "daily") {
    return config.startDate;
  }

  if (config.frequency === "weekly") {
    const weekdays =
      config.weekdays && config.weekdays.length
        ? config.weekdays
        : [weekdayOfYmd(config.startDate)];
    let candidate = config.startDate;
    for (let i = 0; i < 366 * 5; i += 1) {
      const diffDays =
        (ymdToDate(candidate).getTime() - ymdToDate(config.startDate).getTime()) /
        86400000;
      const weekIndex = Math.floor(diffDays / 7);
      if (weekIndex % interval === 0 && weekdays.includes(weekdayOfYmd(candidate))) {
        return candidate;
      }
      candidate = addDaysToYmd(candidate, 1);
    }
    return config.startDate;
  }

  const start = ymdToDate(config.startDate);
  const baseYear = start.getUTCFullYear();
  const baseMonth = start.getUTCMonth();

  const monthDay = config.monthDay ?? null;
  const monthWeek = config.monthWeek ?? null;
  const monthWeekday = config.monthWeekday ?? null;

  let year = baseYear;
  let month = baseMonth;

  for (let i = 0; i < 120; i += 1) {
    let candidate: string;
    if (monthWeek !== null && monthWeekday !== null) {
      candidate = nthWeekdayOfMonth(year, month, monthWeek, monthWeekday);
    } else {
      const day = Math.min(
        Math.max(monthDay || start.getUTCDate(), 1),
        lastDayOfMonth(year, month)
      );
      candidate = ymdFromDate(new Date(Date.UTC(year, month, day)));
    }
    if (candidate >= config.startDate) {
      return candidate;
    }
    const nextMonth = addMonthsToYmd(`${year}-${String(month + 1).padStart(2, "0")}-01`, interval);
    const nextDate = ymdToDate(nextMonth);
    year = nextDate.getUTCFullYear();
    month = nextDate.getUTCMonth();
  }
  return config.startDate;
}

export function getNextOccurrence(config: RecurrenceConfig, afterYmd: string) {
  const interval = Math.max(config.interval || 1, 1);
  if (config.frequency === "daily") {
    return addDaysToYmd(afterYmd, interval);
  }
  if (config.frequency === "weekly") {
    const weekdays =
      config.weekdays && config.weekdays.length
        ? config.weekdays
        : [weekdayOfYmd(config.startDate)];
    let candidate = addDaysToYmd(afterYmd, 1);
    for (let i = 0; i < 366 * 5; i += 1) {
      const diffDays =
        (ymdToDate(candidate).getTime() - ymdToDate(config.startDate).getTime()) /
        86400000;
      const weekIndex = Math.floor(diffDays / 7);
      if (weekIndex % interval === 0 && weekdays.includes(weekdayOfYmd(candidate))) {
        return candidate;
      }
      candidate = addDaysToYmd(candidate, 1);
    }
    return candidate;
  }

  const nextMonth = addMonthsToYmd(afterYmd, interval);
  const nextDate = ymdToDate(nextMonth);
  const year = nextDate.getUTCFullYear();
  const month = nextDate.getUTCMonth();

  if (config.monthWeek !== null && config.monthWeekday !== null) {
    return nthWeekdayOfMonth(year, month, config.monthWeek, config.monthWeekday);
  }
  const day = Math.min(
    Math.max(config.monthDay || nextDate.getUTCDate(), 1),
    lastDayOfMonth(year, month)
  );
  return ymdFromDate(new Date(Date.UTC(year, month, day)));
}
