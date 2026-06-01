"use client";

import { useEffect, useMemo, useState } from "react";
import MultiSelect from "@/app/(app)/_components/MultiSelect";

const scheduleModeOptions = [
  { value: "none", label: "No schedule" },
  { value: "once", label: "Due date" },
  { value: "recurring", label: "Recurring" },
] as const;

const recurrencePatternOptions = [
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
  { value: "yearly", label: "Yearly" },
] as const;

const weekdayOptions = [
  { value: "1", label: "Monday" },
  { value: "2", label: "Tuesday" },
  { value: "3", label: "Wednesday" },
  { value: "4", label: "Thursday" },
  { value: "5", label: "Friday" },
  { value: "6", label: "Saturday" },
  { value: "0", label: "Sunday" },
] as const;

const weekdayOrder = new Map<string, number>(
  weekdayOptions.map((option, index) => [option.value, index])
);

const monthDayOptions = Array.from({ length: 31 }, (_, index) => {
  const day = String(index + 1);
  return { value: day, label: day };
});

type ScheduleMode = (typeof scheduleModeOptions)[number]["value"];
type RecurrencePattern = (typeof recurrencePatternOptions)[number]["value"];
type FrequencyValue = "none" | "once" | RecurrencePattern;

type RecurrenceFieldsProps = {
  initialFrequency?: FrequencyValue;
  initialDueDate?: string;
  initialDueTime?: string;
  initialStartDate?: string;
  initialLeadDays?: number;
};

const fieldLabelClass =
  "text-[11px] font-semibold uppercase tracking-wide text-slate-500";
const fieldControlClass =
  "mt-1 h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm leading-5 text-slate-700 outline-none transition focus:border-slate-300 focus:ring-2 focus:ring-slate-200";
const fieldControlStaticClass =
  "h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm leading-5 text-slate-700 outline-none transition focus:border-slate-300 focus:ring-2 focus:ring-slate-200";

function isIsoDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function normalizeTime(value: string) {
  if (!value) return "09:00";
  if (/^\d{2}:\d{2}:\d{2}$/.test(value)) {
    return value.slice(0, 5);
  }
  if (/^\d{2}:\d{2}$/.test(value)) {
    return value;
  }
  return "09:00";
}

function weekdayFromDate(ymd: string) {
  if (!isIsoDate(ymd)) return "1";
  const date = new Date(`${ymd}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return "1";
  return String(date.getUTCDay());
}

function sortWeekdays(values: string[]) {
  return Array.from(new Set(values))
    .filter((value) => weekdayOrder.has(value))
    .sort((a, b) => (weekdayOrder.get(a) || 0) - (weekdayOrder.get(b) || 0));
}

export default function RecurrenceFields({
  initialFrequency = "none",
  initialDueDate,
  initialDueTime,
  initialStartDate,
  initialLeadDays = 7,
}: RecurrenceFieldsProps) {
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const timeZone = useMemo(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone || "America/New_York",
    []
  );
  const initialDate = useMemo(
    () => (isIsoDate(initialStartDate || "") ? (initialStartDate as string) : today),
    [initialStartDate, today]
  );
  const initialRecurrencePattern: RecurrencePattern =
    initialFrequency === "daily" ||
    initialFrequency === "weekly" ||
    initialFrequency === "monthly" ||
    initialFrequency === "yearly"
      ? initialFrequency
      : "weekly";

  const [scheduleMode, setScheduleMode] = useState<ScheduleMode>(
    initialFrequency === "none"
      ? "none"
      : initialFrequency === "once"
        ? "once"
        : "recurring"
  );
  const [recurrencePattern, setRecurrencePattern] = useState<RecurrencePattern>(
    initialRecurrencePattern
  );
  const [dueDate, setDueDate] = useState(
    isIsoDate(initialDueDate || "") ? (initialDueDate as string) : today
  );
  const [dueTime, setDueTime] = useState(normalizeTime(initialDueTime || ""));
  const [onceStartDate, setOnceStartDate] = useState(
    isIsoDate(initialStartDate || "") && initialFrequency === "once"
      ? (initialStartDate as string)
      : ""
  );
  const [recurrenceStartDate, setRecurrenceStartDate] = useState(initialDate);
  const [recurrenceInterval, setRecurrenceInterval] = useState("1");
  const [recurrenceEndMode, setRecurrenceEndMode] = useState<"never" | "on">("never");
  const [recurrenceEndDate, setRecurrenceEndDate] = useState("");
  const [selectedWeekdays, setSelectedWeekdays] = useState<string[]>([
    weekdayFromDate(initialDate),
  ]);
  const [recurrenceMonthDay, setRecurrenceMonthDay] = useState(
    String(Number(initialDate.split("-")[2] || "1") || 1)
  );
  const intervalUnitLabel = useMemo(() => {
    if (recurrencePattern === "daily") return "Days";
    if (recurrencePattern === "weekly") return "Weeks";
    if (recurrencePattern === "monthly") return "Months";
    return "Years";
  }, [recurrencePattern]);
  const intervalUnitSummary = useMemo(() => {
    if (recurrencePattern === "daily") return "day";
    if (recurrencePattern === "weekly") return "week";
    if (recurrencePattern === "monthly") return "month";
    return "year";
  }, [recurrencePattern]);

  useEffect(() => {
    if (recurrencePattern !== "weekly") return;
    if (selectedWeekdays.length) return;
    setSelectedWeekdays([weekdayFromDate(recurrenceStartDate)]);
  }, [recurrencePattern, recurrenceStartDate, selectedWeekdays.length]);

  const normalizedInterval = useMemo(() => {
    const parsed = Number.parseInt(recurrenceInterval, 10);
    if (Number.isNaN(parsed) || parsed < 1) return 1;
    return parsed;
  }, [recurrenceInterval]);

  const normalizedMonthDay = useMemo(() => {
    const parsed = Number.parseInt(recurrenceMonthDay, 10);
    if (Number.isNaN(parsed) || parsed < 1) return 1;
    if (parsed > 31) return 31;
    return parsed;
  }, [recurrenceMonthDay]);

  const onceSummary = useMemo(() => {
    if (!dueDate || !dueTime) {
      return "Set a due date and time.";
    }

    const dateTime = new Date(`${dueDate}T${dueTime}:00`);
    if (Number.isNaN(dateTime.getTime())) {
      return "Set a due date and time.";
    }

    const dateLabel = dateTime.toLocaleDateString("en-US", {
      month: "long",
      day: "numeric",
      year: "numeric",
    });
    const timeLabel = dateTime.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
    });
    return `Due ${dateLabel} at ${timeLabel}.`;
  }, [dueDate, dueTime]);

  const recurringSummary = useMemo(() => {
    if (!recurrenceStartDate || !dueTime) {
      return "Set start date, interval, and time.";
    }

    const start = new Date(`${recurrenceStartDate}T${dueTime}:00`);
    if (Number.isNaN(start.getTime())) {
      return "Set start date, interval, and time.";
    }

    const timeLabel = start.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
    });
    const everyText =
      normalizedInterval === 1
        ? `every ${intervalUnitSummary}`
        : `every ${normalizedInterval} ${intervalUnitSummary}s`;

    if (recurrencePattern === "daily") {
      return `Repeats ${everyText} at ${timeLabel} (${timeZone}).`;
    }

    if (recurrencePattern === "weekly") {
      const dayLabels = sortWeekdays(selectedWeekdays)
        .map((value) => weekdayOptions.find((option) => option.value === value)?.label || "")
        .filter(Boolean);
      const daysText = dayLabels.length ? dayLabels.join(", ") : "selected days";
      return `Repeats ${everyText} on ${daysText} at ${timeLabel} (${timeZone}).`;
    }

    if (recurrencePattern === "monthly") {
      return `Repeats ${everyText} on day ${normalizedMonthDay} at ${timeLabel} (${timeZone}).`;
    }

    const yearlyDateLabel = new Date(`${recurrenceStartDate}T00:00:00`)
      .toLocaleDateString("en-US", { month: "long", day: "numeric" });
    return `Repeats ${everyText} on ${yearlyDateLabel} at ${timeLabel} (${timeZone}).`;
  }, [
    intervalUnitSummary,
    dueTime,
    normalizedInterval,
    normalizedMonthDay,
    recurrencePattern,
    recurrenceStartDate,
    selectedWeekdays,
    timeZone,
  ]);

  const recurring = scheduleMode === "recurring";
  const scheduledOnce = scheduleMode === "once";

  return (
    <fieldset className="md:col-span-6 rounded-xl bg-slate-50/70 p-4 ring-1 ring-slate-100 md:p-5">
      <legend className="px-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
        Schedule
      </legend>

      <div className="space-y-4">
        <div className="grid gap-4 md:grid-cols-6">
          <div className="md:col-span-2">
            <label className={fieldLabelClass}>Schedule</label>
            <select
              className={fieldControlClass}
              value={scheduleMode}
              onChange={(event) => setScheduleMode(event.target.value as ScheduleMode)}
            >
              {scheduleModeOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          {recurring ? (
            <>
              <div className="md:col-span-2">
                <label className={fieldLabelClass}>Recurs</label>
                <select
                  className={fieldControlClass}
                  value={recurrencePattern}
                  onChange={(event) =>
                    setRecurrencePattern(event.target.value as RecurrencePattern)
                  }
                >
                  {recurrencePatternOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="md:col-span-2">
                <label className={fieldLabelClass}>{`Every X ${intervalUnitLabel}`}</label>
                <input
                  type="number"
                  min={1}
                  name="recurrence_interval_input"
                  className={fieldControlClass}
                  value={recurrenceInterval}
                  onChange={(event) => setRecurrenceInterval(event.target.value)}
                  required
                />
              </div>
            </>
          ) : null}
        </div>

        {recurring ? (
          <div className="grid gap-4 md:grid-cols-6">
            <div className="md:col-span-2">
              <label className={fieldLabelClass}>Due time</label>
              <input
                type="time"
                name="due_time"
                className={fieldControlClass}
                value={dueTime}
                onChange={(event) => setDueTime(event.target.value)}
                required
              />
            </div>

            <div className="md:col-span-2">
              <label className={fieldLabelClass}>Start date</label>
              <input
                type="date"
                name="recurrence_start_date_input"
                className={fieldControlClass}
                value={recurrenceStartDate}
                onChange={(event) => setRecurrenceStartDate(event.target.value)}
                required
              />
            </div>

            <div className="md:col-span-2">
              <label className={fieldLabelClass}>End</label>
              <select
                className={fieldControlClass}
                value={recurrenceEndMode}
                onChange={(event) =>
                  setRecurrenceEndMode(event.target.value as "never" | "on")
                }
              >
                <option value="never">Never</option>
                <option value="on">On date</option>
              </select>
            </div>

            {recurrencePattern === "weekly" ? (
              <div className="md:col-span-4">
                <label className={fieldLabelClass}>On days</label>
                <div className="mt-1">
                  <MultiSelect
                    options={weekdayOptions}
                    selectedValues={selectedWeekdays}
                    placeholder="Select days"
                    summaryClassName={fieldControlStaticClass}
                    menuClassName="rounded-lg"
                    showCount={false}
                    headerLabel="Days"
                    onChange={(next) => setSelectedWeekdays(sortWeekdays(next))}
                  />
                </div>
              </div>
            ) : null}

            {recurrencePattern === "monthly" ? (
              <div className="md:col-span-2">
                <label className={fieldLabelClass}>Day of month</label>
                <select
                  className={fieldControlClass}
                  value={recurrenceMonthDay}
                  onChange={(event) => setRecurrenceMonthDay(event.target.value)}
                >
                  {monthDayOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}

            {recurrenceEndMode === "on" ? (
              <div className="md:col-span-2">
                <label className={fieldLabelClass}>End date</label>
                <input
                  type="date"
                  name="recurrence_end_date_input"
                  className={fieldControlClass}
                  value={recurrenceEndDate}
                  onChange={(event) => setRecurrenceEndDate(event.target.value)}
                  required
                />
              </div>
            ) : null}

            {recurrencePattern === "yearly" ? (
              <div className="md:col-span-6 rounded-lg bg-white px-3 py-2 text-xs text-slate-500 ring-1 ring-slate-100">
                Yearly recurrence uses the month/day from start date.
              </div>
            ) : null}
          </div>
        ) : scheduledOnce ? (
          <div className="grid gap-4 md:grid-cols-6">
            <div className="md:col-span-2">
              <label className={fieldLabelClass}>Due time</label>
              <input
                type="time"
                name="due_time"
                className={fieldControlClass}
                value={dueTime}
                onChange={(event) => setDueTime(event.target.value)}
                required
              />
            </div>

            <div className="md:col-span-2">
              <label className={fieldLabelClass}>Start date (optional)</label>
              <input
                type="date"
                name="start_date"
                className={fieldControlClass}
                value={onceStartDate}
                onChange={(event) => setOnceStartDate(event.target.value)}
              />
            </div>

            <div className="md:col-span-2">
              <label className={fieldLabelClass}>Due date</label>
              <input
                type="date"
                name="due_date"
                className={fieldControlClass}
                value={dueDate}
                onChange={(event) => setDueDate(event.target.value)}
                required
              />
            </div>
          </div>
        ) : null}

        <p className="rounded-lg bg-white px-3 py-2 text-xs text-slate-500 ring-1 ring-slate-100">
          {recurring ? recurringSummary : scheduledOnce ? onceSummary : "No schedule."}
        </p>
      </div>

      <input
        type="hidden"
        name="recurrence_frequency"
        value={recurring ? recurrencePattern : ""}
      />
      <input
        type="hidden"
        name="recurrence_interval"
        value={recurring ? String(normalizedInterval) : "1"}
      />
      <input
        type="hidden"
        name="recurrence_start_date"
        value={recurring ? recurrenceStartDate : ""}
      />
      <input
        type="hidden"
        name="recurrence_end_mode"
        value={recurring ? recurrenceEndMode : "never"}
      />
      <input
        type="hidden"
        name="recurrence_end_date"
        value={recurring && recurrenceEndMode === "on" ? recurrenceEndDate : ""}
      />
      <input
        type="hidden"
        name="recurrence_month_day"
        value={
          recurring && recurrencePattern === "monthly"
            ? String(normalizedMonthDay)
            : ""
        }
      />
      {recurring && recurrencePattern === "weekly"
        ? sortWeekdays(selectedWeekdays).map((weekday) => (
            <input
              key={weekday}
              type="hidden"
              name="recurrence_weekdays"
              value={weekday}
            />
          ))
        : null}
      <input
        type="hidden"
        name="recurrence_lead_days"
        value={String(initialLeadDays || 7)}
      />
      <input type="hidden" name="recurrence_timezone" value={timeZone} />
      {recurring ? <input type="hidden" name="due_date" value="" /> : null}
    </fieldset>
  );
}
