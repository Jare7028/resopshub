export type TimeOffPaySource = "carryover" | "entitlement" | "unpaid";

export type TimeOffYearState = {
  entitlementRemaining: number;
  carryoverRemaining: number;
  carryoverExpiryDate: string | null;
};

export type TimeOffAllocationDay = {
  day: string;
  leaveYear: number;
  paySource: TimeOffPaySource;
};

function isIsoDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function toDateOnly(value: Date) {
  return value.toISOString().slice(0, 10);
}

function parseDateOnly(value: string) {
  if (!isIsoDate(value)) return null;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

function addDays(date: Date, amount: number) {
  const copy = new Date(`${toDateOnly(date)}T00:00:00.000Z`);
  copy.setUTCDate(copy.getUTCDate() + amount);
  return copy;
}

function daysInYear(year: number) {
  const jan1 = Date.UTC(year, 0, 1);
  const nextJan1 = Date.UTC(year + 1, 0, 1);
  return Math.round((nextJan1 - jan1) / (24 * 60 * 60 * 1000));
}

function asNonNegativeInt(value: number | null | undefined) {
  const normalized = Number(value);
  if (!Number.isFinite(normalized)) return 0;
  return Math.max(0, Math.floor(normalized));
}

export function computeProratedEntitlementDays(args: {
  annualBaseDays: number;
  startDate: string | null;
  leaveYear: number;
}) {
  const annualBase = asNonNegativeInt(args.annualBaseDays);
  if (!annualBase) return 0;

  const leaveYear = Math.floor(Number(args.leaveYear));
  if (!Number.isFinite(leaveYear)) return 0;

  const startDate = parseDateOnly(String(args.startDate || ""));
  if (!startDate) return 0;

  const startYear = startDate.getUTCFullYear();
  if (startYear > leaveYear) return 0;
  if (startYear < leaveYear) return annualBase;

  const yearEnd = new Date(Date.UTC(leaveYear, 11, 31));
  const eligibleDays = Math.max(
    0,
    Math.floor((yearEnd.getTime() - startDate.getTime()) / (24 * 60 * 60 * 1000)) + 1
  );
  const totalDays = daysInYear(leaveYear);
  if (!eligibleDays || !totalDays) return 0;

  return Math.floor((annualBase * eligibleDays) / totalDays);
}

export function buildCarryoverExpiryDate(args: {
  leaveYear: number;
  carryoverEnabled: boolean;
  expiryMonth: number | null;
  expiryDay: number | null;
}) {
  if (!args.carryoverEnabled) return null;
  const month = Number(args.expiryMonth);
  const day = Number(args.expiryDay);
  if (!Number.isFinite(month) || !Number.isFinite(day)) return null;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;

  const leaveYear = Math.floor(Number(args.leaveYear));
  if (!Number.isFinite(leaveYear)) return null;

  const monthStart = new Date(Date.UTC(leaveYear, month - 1, 1));
  const monthEnd = new Date(Date.UTC(leaveYear, month, 0));
  const maxDay = monthEnd.getUTCDate();
  const clampedDay = Math.min(Math.floor(day), maxDay);
  const expiry = new Date(Date.UTC(leaveYear, monthStart.getUTCMonth(), clampedDay));
  return toDateOnly(expiry);
}

export function allocateTimeOffRange(args: {
  startDate: string;
  endDate: string;
  yearStateByYear: Record<number, TimeOffYearState>;
}) {
  const start = parseDateOnly(args.startDate);
  const end = parseDateOnly(args.endDate);
  if (!start || !end) {
    throw new Error("Invalid date range");
  }
  if (end < start) {
    throw new Error("End date must be on or after start date");
  }

  const workingState = new Map<number, TimeOffYearState>();
  const ensureYearState = (year: number) => {
    const existing = workingState.get(year);
    if (existing) return existing;
    const source = args.yearStateByYear[year] || {
      entitlementRemaining: 0,
      carryoverRemaining: 0,
      carryoverExpiryDate: null,
    };
    const initialized: TimeOffYearState = {
      entitlementRemaining: asNonNegativeInt(source.entitlementRemaining),
      carryoverRemaining: asNonNegativeInt(source.carryoverRemaining),
      carryoverExpiryDate: parseDateOnly(String(source.carryoverExpiryDate || ""))
        ? String(source.carryoverExpiryDate)
        : null,
    };
    workingState.set(year, initialized);
    return initialized;
  };

  const results: TimeOffAllocationDay[] = [];
  const totalDays = Math.floor((end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000)) + 1;
  for (let index = 0; index < totalDays; index += 1) {
    const dayDate = addDays(start, index);
    const day = toDateOnly(dayDate);
    const leaveYear = dayDate.getUTCFullYear();
    const yearState = ensureYearState(leaveYear);

    let paySource: TimeOffPaySource = "unpaid";
    const carryoverValid =
      Boolean(yearState.carryoverExpiryDate) &&
      day <= String(yearState.carryoverExpiryDate);

    if (yearState.carryoverRemaining > 0 && carryoverValid) {
      yearState.carryoverRemaining -= 1;
      paySource = "carryover";
    } else if (yearState.entitlementRemaining > 0) {
      yearState.entitlementRemaining -= 1;
      paySource = "entitlement";
    }

    results.push({ day, leaveYear, paySource });
  }

  return results;
}
