import {
  getFirstOccurrence,
  getNextOccurrence,
  type RecurrenceConfig,
} from "./recurrence";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^\d{2}:\d{2}(:\d{2})?$/;

function isIsoDate(value: string) {
  return DATE_PATTERN.test(value);
}

function parsePositiveInt(raw: string, fallback: number) {
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed) || parsed < 1) return fallback;
  return parsed;
}

function parseWeekdays(rawValues: string[]) {
  return Array.from(
    new Set(
      rawValues
        .map((value) => Number.parseInt(value, 10))
        .filter((value) => Number.isInteger(value) && value >= 0 && value <= 6)
    )
  ).sort((a, b) => a - b);
}

function weekdayFromDate(ymd: string) {
  const date = new Date(`${ymd}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? 1 : date.getUTCDay();
}

export type ParsedTaskSchedule = {
  dueDate: string | null;
  dueTime: string | null;
  startDate: string | null;
  recurrenceConfig: RecurrenceConfig | null;
  recurrenceNextDate: string | null;
  recurrenceLeadDays: number;
  recurrenceTimezone: string;
};

type ParseResult =
  | {
      error: string;
      value: null;
    }
  | {
      error: null;
      value: ParsedTaskSchedule;
    };

export function parseTaskScheduleFormData(
  formData: FormData,
  defaultTimeZone: string
): ParseResult {
  const dueDateRaw = String(formData.get("due_date") || "").trim();
  const dueTimeRaw = String(formData.get("due_time") || "").trim();
  const recurrenceFrequencyRaw = String(formData.get("recurrence_frequency") || "")
    .trim()
    .toLowerCase();
  const recurrenceTimezone =
    String(formData.get("recurrence_timezone") || "").trim() || defaultTimeZone;
  const recurrenceLeadDaysRaw = Number.parseInt(
    String(formData.get("recurrence_lead_days") || "7"),
    10
  );
  const recurrenceLeadDays =
    Number.isNaN(recurrenceLeadDaysRaw) || recurrenceLeadDaysRaw < 0
      ? 7
      : recurrenceLeadDaysRaw;

  const recurrenceFrequency =
    recurrenceFrequencyRaw === "daily" ||
    recurrenceFrequencyRaw === "weekly" ||
    recurrenceFrequencyRaw === "monthly" ||
    recurrenceFrequencyRaw === "yearly"
      ? (recurrenceFrequencyRaw as RecurrenceConfig["frequency"])
      : null;
  const startDateRaw = String(formData.get("start_date") || "").trim();

  if (!recurrenceFrequency) {
    if (!dueDateRaw && !dueTimeRaw) {
      if (startDateRaw && !isIsoDate(startDateRaw)) {
        return {
          error: "Start date must be a valid date",
          value: null,
        };
      }

      return {
        error: null,
        value: {
          dueDate: null,
          dueTime: null,
          startDate: startDateRaw || null,
          recurrenceConfig: null,
          recurrenceNextDate: null,
          recurrenceLeadDays,
          recurrenceTimezone,
        },
      };
    }

    if (!isIsoDate(dueDateRaw)) {
      return {
        error: "Due date is required",
        value: null,
      };
    }
    if (!TIME_PATTERN.test(dueTimeRaw)) {
      return {
        error: "Due time is required",
        value: null,
      };
    }
    if (startDateRaw && !isIsoDate(startDateRaw)) {
      return {
        error: "Start date must be a valid date",
        value: null,
      };
    }

    return {
      error: null,
      value: {
        dueDate: dueDateRaw,
        dueTime: dueTimeRaw,
        startDate: startDateRaw || null,
        recurrenceConfig: null,
        recurrenceNextDate: null,
        recurrenceLeadDays,
        recurrenceTimezone,
      },
    };
  }

  const recurrenceStartDate = String(formData.get("recurrence_start_date") || "").trim();
  if (!TIME_PATTERN.test(dueTimeRaw)) {
    return {
      error: "Due time is required",
      value: null,
    };
  }
  if (!isIsoDate(recurrenceStartDate)) {
    return {
      error: "Start date is required for recurring tasks",
      value: null,
    };
  }

  const recurrenceInterval = parsePositiveInt(
    String(formData.get("recurrence_interval") || "1"),
    1
  );
  const recurrenceEndMode = String(formData.get("recurrence_end_mode") || "never")
    .trim()
    .toLowerCase();
  const recurrenceEndDateRaw = String(formData.get("recurrence_end_date") || "").trim();
  let recurrenceEndDate: string | null = null;

  if (recurrenceEndMode === "on") {
    if (!isIsoDate(recurrenceEndDateRaw)) {
      return {
        error: "End date is required",
        value: null,
      };
    }
    if (recurrenceEndDateRaw < recurrenceStartDate) {
      return {
        error: "End date must be on or after start date",
        value: null,
      };
    }
    recurrenceEndDate = recurrenceEndDateRaw;
  }

  let recurrenceWeekdays: number[] | null = null;
  if (recurrenceFrequency === "weekly") {
    const parsedWeekdays = parseWeekdays(
      formData.getAll("recurrence_weekdays").map((value) => String(value).trim())
    );
    recurrenceWeekdays = parsedWeekdays.length
      ? parsedWeekdays
      : [weekdayFromDate(recurrenceStartDate)];
  }

  let recurrenceMonthDay: number | null = null;
  if (recurrenceFrequency === "monthly") {
    const parsedMonthDay = parsePositiveInt(
      String(formData.get("recurrence_month_day") || ""),
      Number.parseInt(recurrenceStartDate.split("-")[2] || "1", 10)
    );
    recurrenceMonthDay = Math.min(31, Math.max(1, parsedMonthDay));
  }

  const recurrenceConfig: RecurrenceConfig = {
    frequency: recurrenceFrequency,
    interval: recurrenceInterval,
    startDate: recurrenceStartDate,
    endDate: recurrenceEndDate,
    weekdays: recurrenceFrequency === "weekly" ? recurrenceWeekdays : null,
    monthDay: recurrenceFrequency === "monthly" ? recurrenceMonthDay : null,
    monthWeek: null,
    monthWeekday: null,
  };

  const firstOccurrence = getFirstOccurrence(recurrenceConfig);
  if (!isIsoDate(firstOccurrence)) {
    return {
      error: "Could not calculate first occurrence",
      value: null,
    };
  }

  if (recurrenceEndDate && firstOccurrence > recurrenceEndDate) {
    return {
      error: "End date must be on or after the first occurrence",
      value: null,
    };
  }

  const nextOccurrence = getNextOccurrence(recurrenceConfig, firstOccurrence);
  const boundedNextOccurrence =
    recurrenceEndDate && nextOccurrence > recurrenceEndDate ? null : nextOccurrence;

  return {
    error: null,
    value: {
      dueDate: firstOccurrence,
      dueTime: dueTimeRaw,
      startDate: recurrenceStartDate,
      recurrenceConfig,
      recurrenceNextDate: boundedNextOccurrence,
      recurrenceLeadDays,
      recurrenceTimezone,
    },
  };
}
