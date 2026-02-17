type TaskCalendarInput = {
  id: string;
  title: string | null;
  description?: string | null;
  start_date?: string | null;
  due_date?: string | null;
  due_time?: string | null;
};

function isIsoDate(value: string | null | undefined): value is string {
  return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value));
}

function normalizeTime(value: string | null | undefined): string | null {
  if (!value) return null;
  const match = value.match(/^(\d{2}):(\d{2})/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) return null;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function dayIndex(date: string): number {
  return Math.floor(Date.parse(`${date}T00:00:00Z`) / 86400000);
}

function dateFromDayIndex(index: number): string {
  return new Date(index * 86400000).toISOString().slice(0, 10);
}

function addDays(date: string, amount: number): string {
  return dateFromDayIndex(dayIndex(date) + amount);
}

function minuteStamp(date: string, time: string): number {
  const [hours, minutes] = time.split(":").map(Number);
  return dayIndex(date) * 1440 + hours * 60 + minutes;
}

function addMinutes(date: string, time: string, amount: number) {
  const total = minuteStamp(date, time) + amount;
  const nextDayIndex = Math.floor(total / 1440);
  const minutesWithinDay = ((total % 1440) + 1440) % 1440;
  const hours = Math.floor(minutesWithinDay / 60);
  const minutes = minutesWithinDay % 60;
  return {
    date: dateFromDayIndex(nextDayIndex),
    time: `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`,
  };
}

function taskLink(taskId: string, appBaseUrl?: string) {
  const base = String(appBaseUrl || "").trim().replace(/\/+$/, "");
  if (!base) return null;
  if (base.startsWith("http://") || base.startsWith("https://")) {
    return `${base}/tasks/${taskId}`;
  }
  return `https://${base}/tasks/${taskId}`;
}

export function buildOutlookTaskComposeUrl(
  task: TaskCalendarInput,
  options?: { appBaseUrl?: string }
) {
  const url = new URL("https://outlook.office.com/calendar/0/deeplink/compose");
  url.searchParams.set("path", "/calendar/action/compose");
  url.searchParams.set("rru", "addevent");
  url.searchParams.set("subject", String(task.title || "Task").trim() || "Task");

  const bodyParts: string[] = [];
  if (task.description) {
    bodyParts.push(task.description.trim());
  }
  const link = taskLink(task.id, options?.appBaseUrl);
  if (link) {
    bodyParts.push(`Task link: ${link}`);
  }
  if (bodyParts.length) {
    url.searchParams.set("body", bodyParts.join("\n\n"));
  }

  const startDate = isIsoDate(task.start_date) ? task.start_date : null;
  const dueDate = isIsoDate(task.due_date) ? task.due_date : null;
  const eventStartDate = startDate || dueDate;
  const eventEndDate = dueDate || startDate;
  const dueTime = normalizeTime(task.due_time);

  if (eventStartDate && eventEndDate) {
    if (dueTime) {
      const startTime = eventStartDate === eventEndDate ? dueTime : "09:00";
      const startStamp = minuteStamp(eventStartDate, startTime);
      const endStamp = minuteStamp(eventEndDate, dueTime);
      let endDate = eventEndDate;
      let endTime = dueTime;
      if (endStamp <= startStamp) {
        const next = addMinutes(eventStartDate, startTime, 30);
        endDate = next.date;
        endTime = next.time;
      }
      url.searchParams.set("allday", "false");
      url.searchParams.set("startdt", `${eventStartDate}T${startTime}:00`);
      url.searchParams.set("enddt", `${endDate}T${endTime}:00`);
    } else {
      let rangeEndExclusive = addDays(eventEndDate, 1);
      if (rangeEndExclusive <= eventStartDate) {
        rangeEndExclusive = addDays(eventStartDate, 1);
      }
      url.searchParams.set("allday", "true");
      url.searchParams.set("startdt", eventStartDate);
      url.searchParams.set("enddt", rangeEndExclusive);
    }
  }

  return url.toString();
}
