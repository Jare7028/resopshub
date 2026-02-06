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

function firstMondayOfMonth(year: number, monthIndex: number) {
  const firstDay = new Date(Date.UTC(year, monthIndex, 1));
  const dayOfWeek = firstDay.getUTCDay(); // 0 = Sunday, 1 = Monday
  const offset = (1 - dayOfWeek + 7) % 7;
  const date = new Date(Date.UTC(year, monthIndex, 1 + offset));
  return ymdFromDate(date);
}

export function firstMondayOnOrAfter(ymd: string) {
  const date = ymdToDate(ymd);
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  const candidate = firstMondayOfMonth(year, month);
  if (candidate >= ymd) {
    return candidate;
  }
  return firstMondayOfMonth(year, month + 1);
}

export function nextFirstMondayAfter(ymd: string) {
  const date = ymdToDate(ymd);
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  return firstMondayOfMonth(year, month + 1);
}

export function getNextOccurrence(rule: string, afterYmd: string) {
  if (rule === "monthly:first_monday") {
    return nextFirstMondayAfter(afterYmd);
  }
  return null;
}
