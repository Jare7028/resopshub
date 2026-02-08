"use client";

import { useMemo, useState } from "react";

type RecurrenceFieldsProps = {
  className?: string;
};

const frequencyOptions = [
  { value: "once", label: "Once" },
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
  { value: "yearly", label: "Yearly" },
] as const;

type FrequencyValue = (typeof frequencyOptions)[number]["value"];

export default function RecurrenceFields({ className }: RecurrenceFieldsProps) {
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const timeZone = useMemo(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone || "America/New_York",
    []
  );
  const [frequency, setFrequency] = useState<FrequencyValue>("once");
  const [dueDate, setDueDate] = useState(today);
  const [dueTime, setDueTime] = useState("09:00");

  const summary = useMemo(() => {
    if (!dueDate || !dueTime) {
      return "Choose a deadline date and time.";
    }

    const dateTime = new Date(`${dueDate}T${dueTime}:00`);
    const dateLabel = dateTime.toLocaleDateString("en-US", {
      month: "long",
      day: "numeric",
      year: "numeric",
    });
    const timeLabel = dateTime.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
    });
    const weekdayLabel = dateTime.toLocaleDateString("en-US", { weekday: "long" });

    if (frequency === "once") {
      return `Due ${dateLabel} at ${timeLabel}.`;
    }

    if (frequency === "daily") {
      return `Repeats daily at ${timeLabel} (${timeZone}).`;
    }

    if (frequency === "weekly") {
      return `Repeats every ${weekdayLabel} at ${timeLabel} (${timeZone}).`;
    }

    if (frequency === "monthly") {
      const dayOfMonth = Number(dueDate.split("-")[2]);
      return `Repeats monthly on day ${dayOfMonth} at ${timeLabel} (${timeZone}).`;
    }

    return `Repeats yearly on ${dateTime.toLocaleDateString("en-US", {
      month: "long",
      day: "numeric",
    })} at ${timeLabel} (${timeZone}).`;
  }, [dueDate, dueTime, frequency, timeZone]);

  return (
    <fieldset className={className}>
      <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-3">
        <div className="flex flex-wrap items-center gap-3">
          <span className="min-w-20 text-xs font-semibold uppercase tracking-wide text-slate-500">
            Frequency
          </span>
          <div className="flex flex-wrap gap-2 rounded-md border border-slate-200 bg-white p-1">
            {frequencyOptions.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setFrequency(option.value)}
                className={[
                  "rounded-md px-3 py-1.5 text-sm font-medium transition",
                  frequency === option.value
                    ? "bg-slate-900 text-white"
                    : "text-slate-600 hover:bg-slate-100",
                ].join(" ")}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-6">
          <div className="md:col-span-1">
            <label className="text-xs font-semibold text-slate-500">On</label>
          </div>

          <div className="md:col-span-2">
            <label className="text-xs font-semibold text-slate-500">Time</label>
            <input
              type="time"
              name="due_time"
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              value={dueTime}
              onChange={(event) => setDueTime(event.target.value)}
              required
            />
          </div>

          <div className="md:col-span-3">
            <label className="text-xs font-semibold text-slate-500">Date</label>
            <input
              type="date"
              name="due_date"
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              value={dueDate}
              onChange={(event) => setDueDate(event.target.value)}
              required
            />
          </div>
        </div>

        <p className="mt-3 text-xs text-slate-500">{summary}</p>

        <input
          type="hidden"
          name="recurrence_frequency"
          value={frequency === "once" ? "" : frequency}
        />
        <input type="hidden" name="recurrence_interval" value="1" />
        <input type="hidden" name="recurrence_lead_days" value="7" />
        <input type="hidden" name="recurrence_timezone" value={timeZone} />
      </div>
    </fieldset>
  );
}
