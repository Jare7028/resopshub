"use client";

import { useMemo, useState } from "react";

type RecurrenceFieldsProps = {
  className?: string;
};

const weekDays = [
  { label: "Mon", value: 1 },
  { label: "Tue", value: 2 },
  { label: "Wed", value: 3 },
  { label: "Thu", value: 4 },
  { label: "Fri", value: 5 },
  { label: "Sat", value: 6 },
  { label: "Sun", value: 0 },
];

const monthWeekOptions = [
  { label: "First", value: 1 },
  { label: "Second", value: 2 },
  { label: "Third", value: 3 },
  { label: "Fourth", value: 4 },
  { label: "Last", value: -1 },
];

export default function RecurrenceFields({ className }: RecurrenceFieldsProps) {
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const [frequency, setFrequency] = useState("");
  const [interval, setInterval] = useState(1);
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState("");
  const [monthMode, setMonthMode] = useState<"day" | "weekday">("day");
  const [monthDay, setMonthDay] = useState(1);
  const [monthWeek, setMonthWeek] = useState(1);
  const [monthWeekday, setMonthWeekday] = useState(1);
  const [weekdays, setWeekdays] = useState<number[]>([1]);

  const toggleWeekday = (value: number) => {
    setWeekdays((current) =>
      current.includes(value)
        ? current.filter((day) => day !== value)
        : [...current, value]
    );
  };

  return (
    <fieldset className={className}>
      <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Recurrence
          </span>
        </div>
        <div className="mt-3 grid gap-3 md:grid-cols-6">
          <div className="md:col-span-2">
            <label className="text-xs font-semibold text-slate-500">Repeat</label>
            <select
              name="recurrence_frequency"
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              value={frequency}
              onChange={(event) => setFrequency(event.target.value)}
            >
              <option value="">None</option>
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
            </select>
          </div>

          <div className="md:col-span-1">
            <label className="text-xs font-semibold text-slate-500">Every</label>
            <input
              type="number"
              min={1}
              name="recurrence_interval"
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              value={interval}
              onChange={(event) => setInterval(Number(event.target.value) || 1)}
              disabled={!frequency}
            />
          </div>

          <div className="md:col-span-1">
            <label className="text-xs font-semibold text-slate-500">Starts</label>
            <input
              type="date"
              name="recurrence_start_date"
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              value={startDate}
              onChange={(event) => setStartDate(event.target.value)}
              disabled={!frequency}
            />
          </div>

          <div className="md:col-span-2">
            <label className="text-xs font-semibold text-slate-500">Ends</label>
            <input
              type="date"
              name="recurrence_end_date"
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              value={endDate}
              onChange={(event) => setEndDate(event.target.value)}
              disabled={!frequency}
            />
          </div>

          {frequency === "weekly" ? (
            <div className="md:col-span-6">
              <label className="text-xs font-semibold text-slate-500">
                Days of week
              </label>
              <div className="mt-2 flex flex-wrap gap-2">
                {weekDays.map((day) => (
                  <label
                    key={day.value}
                    className="flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-600"
                  >
                    <input
                      type="checkbox"
                      name="recurrence_weekdays"
                      value={day.value}
                      checked={weekdays.includes(day.value)}
                      onChange={() => toggleWeekday(day.value)}
                      disabled={!frequency}
                    />
                    {day.label}
                  </label>
                ))}
              </div>
            </div>
          ) : null}

          {frequency === "monthly" ? (
            <div className="md:col-span-6 space-y-2">
              <div className="flex flex-wrap items-center gap-3">
                <label className="flex items-center gap-2 text-xs text-slate-600">
                  <input
                    type="radio"
                    name="recurrence_month_mode"
                    value="day"
                    checked={monthMode === "day"}
                    onChange={() => setMonthMode("day")}
                  />
                  On day of month
                </label>
                <label className="flex items-center gap-2 text-xs text-slate-600">
                  <input
                    type="radio"
                    name="recurrence_month_mode"
                    value="weekday"
                    checked={monthMode === "weekday"}
                    onChange={() => setMonthMode("weekday")}
                  />
                  On the
                </label>
              </div>

              {monthMode === "day" ? (
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min={1}
                    max={31}
                    name="recurrence_month_day"
                    className="w-24 rounded-md border border-slate-300 px-3 py-2 text-sm"
                    value={monthDay}
                    onChange={(event) =>
                      setMonthDay(Number(event.target.value) || 1)
                    }
                    disabled={!frequency}
                  />
                  <span className="text-xs text-slate-500">of the month</span>
                </div>
              ) : (
                <div className="flex flex-wrap items-center gap-2">
                  <select
                    name="recurrence_month_week"
                    className="rounded-md border border-slate-300 px-3 py-2 text-sm"
                    value={monthWeek}
                    onChange={(event) =>
                      setMonthWeek(Number(event.target.value))
                    }
                    disabled={!frequency}
                  >
                    {monthWeekOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  <select
                    name="recurrence_month_weekday"
                    className="rounded-md border border-slate-300 px-3 py-2 text-sm"
                    value={monthWeekday}
                    onChange={(event) =>
                      setMonthWeekday(Number(event.target.value))
                    }
                    disabled={!frequency}
                  >
                    {weekDays.map((day) => (
                      <option key={day.value} value={day.value}>
                        {day.label}
                      </option>
                    ))}
                  </select>
                  <span className="text-xs text-slate-500">of the month</span>
                </div>
              )}
            </div>
          ) : null}

          <input type="hidden" name="recurrence_lead_days" value="7" />
        </div>
      </div>
    </fieldset>
  );
}
