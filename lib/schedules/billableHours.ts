export type BillableShiftInput = {
  is_open: boolean;
  start_local_time: string;
  end_local_time: string;
  ends_next_day: boolean;
  break_minutes: number | null | undefined;
  job_code_id: string | null | undefined;
};

export type BillableMinutesOptions = {
  billableJobCodeIds: ReadonlySet<string>;
  breaksBillable: boolean;
};

function timeToMinutes(value: string) {
  const match = String(value || "").match(/^(\d{2}):(\d{2})/);
  if (!match) return 0;
  return Number(match[1]) * 60 + Number(match[2]);
}

function baseShiftMinutes(shift: BillableShiftInput) {
  const startMinutes = timeToMinutes(shift.start_local_time);
  let endMinutes = timeToMinutes(shift.end_local_time);
  if (shift.ends_next_day || endMinutes <= startMinutes) {
    endMinutes += 1440;
  }
  return Math.max(0, endMinutes - startMinutes);
}

export function computeBillableMinutes(
  shift: BillableShiftInput,
  options: BillableMinutesOptions
) {
  if (shift.is_open) return 0;

  const jobCodeId = String(shift.job_code_id || "").trim();
  if (!jobCodeId) return 0;

  if (!options.billableJobCodeIds.has(jobCodeId)) return 0;

  const minutes = baseShiftMinutes(shift);
  if (options.breaksBillable) return minutes;

  const breakMinutes = Math.max(0, Number(shift.break_minutes || 0));
  return Math.max(0, minutes - breakMinutes);
}
