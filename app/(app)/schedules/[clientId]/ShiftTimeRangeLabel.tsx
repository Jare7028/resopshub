"use client";

import { useEffect, useState } from "react";

type ShiftTimeRangeLabelProps = {
  startAt: string | null | undefined;
  endAt: string | null | undefined;
  fallbackStartLocalTime: string;
  fallbackEndLocalTime: string;
  fallbackTimezone: string;
  compact?: boolean;
  className?: string;
  timezoneClassName?: string;
};

type RenderedRange = {
  rangeText: string;
  timezoneText: string;
};

function pad2(value: number) {
  return String(value).padStart(2, "0");
}

function formatFallbackTime(value: string, compact: boolean) {
  const match = String(value || "").match(/^(\d{2}):(\d{2})/);
  if (!match) return String(value || "");
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const period = hours >= 12 ? "PM" : "AM";
  const displayHours = hours % 12 === 0 ? 12 : hours % 12;
  if (compact && minutes === 0) return `${displayHours}${period.toLowerCase()}`;
  return `${displayHours}:${pad2(minutes)} ${period}`;
}

function fallbackRange(
  startLocalTime: string,
  endLocalTime: string,
  fallbackTimezone: string,
  compact: boolean
): RenderedRange {
  return {
    rangeText: `${formatFallbackTime(startLocalTime, compact)} - ${formatFallbackTime(endLocalTime, compact)}`,
    timezoneText: fallbackTimezone || "UTC",
  };
}

function getDatePartsInTimeZone(value: Date, timeZone: string) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = formatter.formatToParts(value);
  const year = Number(parts.find((part) => part.type === "year")?.value || "0");
  const month = Number(parts.find((part) => part.type === "month")?.value || "0");
  const day = Number(parts.find((part) => part.type === "day")?.value || "0");
  return { year, month, day };
}

function formatInViewerTimezone(
  startAt: string | null | undefined,
  endAt: string | null | undefined,
  fallbackStartLocalTime: string,
  fallbackEndLocalTime: string,
  fallbackTimezone: string,
  compact: boolean
) {
  if (!startAt || !endAt) {
    return fallbackRange(fallbackStartLocalTime, fallbackEndLocalTime, fallbackTimezone, compact);
  }

  const startDate = new Date(startAt);
  const endDate = new Date(endAt);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
    return fallbackRange(fallbackStartLocalTime, fallbackEndLocalTime, fallbackTimezone, compact);
  }

  const viewerTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || fallbackTimezone || "UTC";
  const timeFormatter = new Intl.DateTimeFormat("en-US", {
    timeZone: viewerTimeZone,
    hour: "numeric",
    minute: "2-digit",
  });
  const timezoneFormatter = new Intl.DateTimeFormat("en-US", {
    timeZone: viewerTimeZone,
    timeZoneName: "short",
  });
  const timezoneText =
    timezoneFormatter.formatToParts(startDate).find((part) => part.type === "timeZoneName")?.value ||
    viewerTimeZone;

  const startParts = getDatePartsInTimeZone(startDate, viewerTimeZone);
  const endParts = getDatePartsInTimeZone(endDate, viewerTimeZone);
  const startStamp = Date.UTC(startParts.year, startParts.month - 1, startParts.day);
  const endStamp = Date.UTC(endParts.year, endParts.month - 1, endParts.day);
  const dayDiff = Math.round((endStamp - startStamp) / (24 * 60 * 60 * 1000));
  const daySuffix = dayDiff === 0 ? "" : ` (${dayDiff > 0 ? `+${dayDiff}` : String(dayDiff)}d)`;

  return {
    rangeText: `${timeFormatter.format(startDate)} - ${timeFormatter.format(endDate)}${daySuffix}`,
    timezoneText,
  };
}

export default function ShiftTimeRangeLabel({
  startAt,
  endAt,
  fallbackStartLocalTime,
  fallbackEndLocalTime,
  fallbackTimezone,
  compact = false,
  className,
  timezoneClassName,
}: ShiftTimeRangeLabelProps) {
  const [rendered, setRendered] = useState<RenderedRange>(() =>
    fallbackRange(fallbackStartLocalTime, fallbackEndLocalTime, fallbackTimezone, compact)
  );

  useEffect(() => {
    setRendered(
      formatInViewerTimezone(
        startAt,
        endAt,
        fallbackStartLocalTime,
        fallbackEndLocalTime,
        fallbackTimezone,
        compact
      )
    );
  }, [startAt, endAt, fallbackStartLocalTime, fallbackEndLocalTime, fallbackTimezone, compact]);

  return (
    <>
      <span className={className}>{rendered.rangeText}</span>
      <span className={timezoneClassName}> ({rendered.timezoneText})</span>
    </>
  );
}
