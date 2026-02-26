import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
type RangeView = "week" | "day" | "month";

type WeekRow = {
  id: string;
  client_id: string;
  week_start_date: string;
  status: "draft" | "published";
  published_version: number;
};

type RosterRow = {
  id: string;
  user_id: string | null;
  display_name: string;
  email: string | null;
  role_token: string;
  role_label: string;
  active: boolean;
};

type ShiftRow = {
  id: string;
  week_id: string;
  roster_entry_id: string | null;
  is_open: boolean;
  local_date: string;
  start_local_time: string;
  end_local_time: string;
  ends_next_day: boolean;
  break_minutes: number;
  job_code_id: string | null;
  notes: string | null;
};

type JobCodeRow = {
  id: string;
  code: string;
  color_hex: string;
  is_active: boolean;
};

type TemplateRow = {
  id: string;
  name: string;
};

type AuditRow = {
  id: string;
  action: string;
  actor_user_id: string | null;
  created_at: string;
};

function normalizeRangeView(value: string | null | undefined): RangeView {
  const v = String(value || "").trim().toLowerCase();
  if (v === "day") return "day";
  if (v === "month") return "month";
  return "week";
}

function parseDateOnly(value: string | null | undefined) {
  const text = String(value || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const date = new Date(`${text}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function toDateOnly(value: Date) {
  return value.toISOString().slice(0, 10);
}

function startOfMonday(date: Date) {
  const copy = new Date(`${toDateOnly(date)}T00:00:00.000Z`);
  const day = copy.getUTCDay();
  const offset = day === 0 ? 6 : day - 1;
  copy.setUTCDate(copy.getUTCDate() - offset);
  return copy;
}

function addDays(date: Date, days: number) {
  const copy = new Date(`${toDateOnly(date)}T00:00:00.000Z`);
  copy.setUTCDate(copy.getUTCDate() + days);
  return copy;
}

function startOfMonth(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

function daysInMonth(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
}

function formatDateLabel(value: string) {
  const date = parseDateOnly(value);
  if (!date) return value;
  return date.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

function formatTimeLabel(value: string) {
  const match = String(value || "").match(/^(\d{2}):(\d{2})/);
  if (!match) return value;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const period = hours >= 12 ? "PM" : "AM";
  const displayHours = hours % 12 === 0 ? 12 : hours % 12;
  return `${displayHours}:${String(minutes).padStart(2, "0")} ${period}`;
}

function timeToMinutes(value: string) {
  const match = String(value || "").match(/^(\d{2}):(\d{2})/);
  if (!match) return 0;
  return Number(match[1]) * 60 + Number(match[2]);
}

function roleRank(roleToken: string) {
  const token = String(roleToken || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_");
  if (token === "manager") return 1;
  if (token === "team_leader") return 2;
  return 3;
}

function shiftWorkedMinutes(shift: ShiftRow) {
  const startMinutes = timeToMinutes(shift.start_local_time);
  let endMinutes = timeToMinutes(shift.end_local_time);
  if (shift.ends_next_day || endMinutes <= startMinutes) endMinutes += 1440;
  return Math.max(0, endMinutes - startMinutes - Math.max(0, Number(shift.break_minutes || 0)));
}

function formatHours(minutes: number) {
  const value = Math.max(0, Number(minutes || 0)) / 60;
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/\.?0+$/, "");
}

function buildSchedulePath(args: {
  clientId: string;
  weekStart: string;
  rangeView?: RangeView;
  day?: string;
  q?: string;
  roleFilter?: string;
  jobFilter?: string;
  error?: string;
  success?: string;
}) {
  const sp = new URLSearchParams();
  sp.set("week", args.weekStart);
  sp.set("range", args.rangeView || "week");
  if (args.day) sp.set("day", args.day);
  if (args.q) sp.set("q", args.q);
  if (args.roleFilter) sp.set("role", args.roleFilter);
  if (args.jobFilter) sp.set("job", args.jobFilter);
  if (args.error) sp.set("error", args.error);
  if (args.success) sp.set("success", args.success);
  return `/schedules/${args.clientId}?${sp.toString()}`;
}

function decodeContext(formData: FormData) {
  return {
    weekStart: String(formData.get("ctx_week") || "").trim(),
    rangeView: normalizeRangeView(String(formData.get("ctx_range") || "")),
    day: String(formData.get("ctx_day") || "").trim(),
    q: String(formData.get("ctx_q") || "").trim(),
    roleFilter: String(formData.get("ctx_role") || "").trim(),
    jobFilter: String(formData.get("ctx_job") || "").trim(),
  };
}

function stateFromContext(clientId: string, state: ReturnType<typeof decodeContext>, fallbackWeek: string) {
  return {
    clientId,
    weekStart: state.weekStart || fallbackWeek,
    rangeView: state.rangeView,
    day: state.day,
    q: state.q,
    roleFilter: state.roleFilter,
    jobFilter: state.jobFilter,
  };
}

export default async function ClientSchedulePage({
  params,
  searchParams,
}: {
  params: Promise<{ clientId: string }>;
  searchParams?: Promise<{
    week?: string;
    range?: string;
    day?: string;
    q?: string;
    role?: string;
    job?: string;
    error?: string;
    success?: string;
  }>;
}) {
  const resolvedParams = await params;
  const resolvedSearch = await searchParams;
  const clientId = String(resolvedParams.clientId || "").trim();
  if (!uuidRegex.test(clientId)) notFound();

  const weekDate = startOfMonday(parseDateOnly(resolvedSearch?.week) || new Date());
  const weekStart = toDateOnly(weekDate);
  const rangeView = normalizeRangeView(resolvedSearch?.range);
  const selectedDayDate = parseDateOnly(resolvedSearch?.day) || weekDate;
  const selectedDay = toDateOnly(selectedDayDate);
  const searchQueryRaw = String(resolvedSearch?.q || "").trim();
  const searchQuery = searchQueryRaw.toLowerCase();
  const roleFilterRaw = String(resolvedSearch?.role || "").trim();
  const roleFilter = roleFilterRaw
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_");
  const jobFilter = String(resolvedSearch?.job || "").trim();
  const visibleDays = (() => {
    if (rangeView === "day") return [selectedDay];
    if (rangeView === "month") {
      const monthStart = startOfMonth(selectedDayDate);
      const totalDays = daysInMonth(selectedDayDate);
      return Array.from({ length: totalDays }, (_, i) => toDateOnly(addDays(monthStart, i)));
    }
    return Array.from({ length: 7 }, (_, i) => toDateOnly(addDays(weekDate, i)));
  })();

  const supabase = createSupabaseServerClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user?.id) redirect("/login");

  async function finishAction(path: string) {
    "use server";
    revalidatePath(`/schedules/${clientId}`);
    revalidatePath("/schedules");
    redirect(path);
  }

  async function createOrLoadWeekAction(formData: FormData) {
    "use server";
    const state = decodeContext(formData);
    const nextWeek = state.weekStart || weekStart;
    const supabase = createSupabaseServerClient();
    const { error } = await supabase.rpc("schedule_get_or_create_week", {
      p_client_id: clientId,
      p_reference_date: nextWeek,
      p_timezone: "UTC",
    });
    const path = buildSchedulePath({
      ...stateFromContext(clientId, state, weekStart),
      weekStart: nextWeek,
      ...(error ? { error: error.message } : { success: "Week ready" }),
    });
    await finishAction(path);
  }

  async function syncRosterAction(formData: FormData) {
    "use server";
    const state = decodeContext(formData);
    const supabase = createSupabaseServerClient();
    const { error } = await supabase.rpc("schedule_sync_roster_for_client", { p_client_id: clientId });
    const path = buildSchedulePath({
      ...stateFromContext(clientId, state, weekStart),
      ...(error ? { error: error.message } : { success: "Roster synced" }),
    });
    await finishAction(path);
  }

  async function publishWeekAction(formData: FormData) {
    "use server";
    const state = decodeContext(formData);
    const weekId = String(formData.get("week_id") || "").trim();
    const supabase = createSupabaseServerClient();
    const { error } = await supabase.rpc("schedule_publish_week", { p_week_id: weekId });
    const path = buildSchedulePath({
      ...stateFromContext(clientId, state, weekStart),
      ...(error ? { error: error.message } : { success: "Week published" }),
    });
    await finishAction(path);
  }

  async function unpublishWeekAction(formData: FormData) {
    "use server";
    const state = decodeContext(formData);
    const weekId = String(formData.get("week_id") || "").trim();
    const supabase = createSupabaseServerClient();
    const { error } = await supabase.rpc("schedule_unpublish_week", { p_week_id: weekId });
    const path = buildSchedulePath({
      ...stateFromContext(clientId, state, weekStart),
      ...(error ? { error: error.message } : { success: "Week unpublished" }),
    });
    await finishAction(path);
  }

  async function addRosterUserAction(formData: FormData) {
    "use server";
    const state = decodeContext(formData);
    const userId = String(formData.get("user_id") || "").trim();
    const roleToken = String(formData.get("role_token") || "agent").trim();
    const supabase = createSupabaseServerClient();
    const { error } = await supabase.rpc("schedule_add_roster_user", {
      p_client_id: clientId,
      p_user_id: userId,
      p_role_token: roleToken,
    });
    const path = buildSchedulePath({
      ...stateFromContext(clientId, state, weekStart),
      ...(error ? { error: error.message } : { success: "User added to roster" }),
    });
    await finishAction(path);
  }

  async function removeRosterUserAction(formData: FormData) {
    "use server";
    const state = decodeContext(formData);
    const rosterEntryId = String(formData.get("roster_entry_id") || "").trim();
    const supabase = createSupabaseServerClient();
    const { error } = await supabase.rpc("schedule_remove_roster_user", {
      p_roster_entry_id: rosterEntryId,
    });
    const path = buildSchedulePath({
      ...stateFromContext(clientId, state, weekStart),
      ...(error ? { error: error.message } : { success: "Roster entry removed" }),
    });
    await finishAction(path);
  }

  async function upsertShiftAction(formData: FormData) {
    "use server";
    const state = decodeContext(formData);
    const shiftIdRaw = String(formData.get("shift_id") || "").trim();
    const rosterEntryIdRaw = String(formData.get("roster_entry_id") || "").trim();
    const jobCodeIdRaw = String(formData.get("job_code_id") || "").trim();
    const isOpen = String(formData.get("is_open") || "").trim() === "on";
    const supabase = createSupabaseServerClient();
    const { error } = await supabase.rpc("schedule_upsert_shift", {
      p_week_id: String(formData.get("week_id") || "").trim(),
      p_shift_id: uuidRegex.test(shiftIdRaw) ? shiftIdRaw : null,
      p_roster_entry_id: !isOpen && uuidRegex.test(rosterEntryIdRaw) ? rosterEntryIdRaw : null,
      p_is_open: isOpen,
      p_local_date: String(formData.get("local_date") || "").trim(),
      p_start_local_time: String(formData.get("start_local_time") || "").trim(),
      p_end_local_time: String(formData.get("end_local_time") || "").trim(),
      p_ends_next_day: String(formData.get("ends_next_day") || "").trim() === "on",
      p_break_minutes: Number.parseInt(String(formData.get("break_minutes") || "0"), 10) || 0,
      p_job_code_id: uuidRegex.test(jobCodeIdRaw) ? jobCodeIdRaw : null,
      p_notes: String(formData.get("notes") || "").trim() || null,
    });
    const path = buildSchedulePath({
      ...stateFromContext(clientId, state, weekStart),
      ...(error ? { error: error.message } : { success: "Shift saved" }),
    });
    await finishAction(path);
  }

  async function deleteShiftAction(formData: FormData) {
    "use server";
    const state = decodeContext(formData);
    const supabase = createSupabaseServerClient();
    const { error } = await supabase.rpc("schedule_delete_shift", {
      p_shift_id: String(formData.get("shift_id") || "").trim(),
    });
    const path = buildSchedulePath({
      ...stateFromContext(clientId, state, weekStart),
      ...(error ? { error: error.message } : { success: "Shift deleted" }),
    });
    await finishAction(path);
  }

  async function claimOpenShiftAction(formData: FormData) {
    "use server";
    const state = decodeContext(formData);
    const supabase = createSupabaseServerClient();
    const { error } = await supabase.rpc("schedule_claim_open_shift", {
      p_shift_id: String(formData.get("shift_id") || "").trim(),
    });
    const path = buildSchedulePath({
      ...stateFromContext(clientId, state, weekStart),
      ...(error ? { error: error.message } : { success: "Open shift claimed" }),
    });
    await finishAction(path);
  }

  async function copyPreviousWeekAction(formData: FormData) {
    "use server";
    const state = decodeContext(formData);
    const supabase = createSupabaseServerClient();
    const { data, error } = await supabase.rpc("schedule_copy_previous_week", {
      p_week_id: String(formData.get("week_id") || "").trim(),
    });
    const warningCount = Array.isArray((data as { warnings?: unknown[] } | null)?.warnings)
      ? ((data as { warnings?: unknown[] }).warnings || []).length
      : 0;
    const path = buildSchedulePath({
      ...stateFromContext(clientId, state, weekStart),
      ...(error
        ? { error: error.message }
        : { success: warningCount ? `Copied with ${warningCount} warning(s)` : "Copied from previous week" }),
    });
    await finishAction(path);
  }

  async function createTemplateAction(formData: FormData) {
    "use server";
    const state = decodeContext(formData);
    const supabase = createSupabaseServerClient();
    const { error } = await supabase.rpc("schedule_create_template_from_week", {
      p_week_id: String(formData.get("week_id") || "").trim(),
      p_name: String(formData.get("template_name") || "").trim(),
    });
    const path = buildSchedulePath({
      ...stateFromContext(clientId, state, weekStart),
      ...(error ? { error: error.message } : { success: "Template created" }),
    });
    await finishAction(path);
  }

  async function applyTemplateAction(formData: FormData) {
    "use server";
    const state = decodeContext(formData);
    const supabase = createSupabaseServerClient();
    const { data, error } = await supabase.rpc("schedule_apply_template_to_week", {
      p_week_id: String(formData.get("week_id") || "").trim(),
      p_template_id: String(formData.get("template_id") || "").trim(),
      p_mapping_mode: String(formData.get("mapping_mode") || "role_slot").trim(),
    });
    const warningCount = Array.isArray((data as { warnings?: unknown[] } | null)?.warnings)
      ? ((data as { warnings?: unknown[] }).warnings || []).length
      : 0;
    const path = buildSchedulePath({
      ...stateFromContext(clientId, state, weekStart),
      ...(error
        ? { error: error.message }
        : { success: warningCount ? `Template applied with ${warningCount} warning(s)` : "Template applied" }),
    });
    await finishAction(path);
  }

  async function upsertJobCodeAction(formData: FormData) {
    "use server";
    const state = decodeContext(formData);
    const jobCodeIdRaw = String(formData.get("job_code_id") || "").trim();
    const sortOrder = Number.parseInt(String(formData.get("sort_order") || "0"), 10);
    const supabase = createSupabaseServerClient();
    const { error } = await supabase.rpc("schedule_upsert_job_code", {
      p_job_code_id: uuidRegex.test(jobCodeIdRaw) ? jobCodeIdRaw : null,
      p_code: String(formData.get("code") || "").trim(),
      p_color_hex: String(formData.get("color_hex") || "").trim(),
      p_sort_order: Number.isFinite(sortOrder) ? sortOrder : 0,
      p_is_active: String(formData.get("is_active") || "").trim() === "on",
    });
    const path = buildSchedulePath({
      ...stateFromContext(clientId, state, weekStart),
      ...(error ? { error: error.message } : { success: "Job code saved" }),
    });
    await finishAction(path);
  }

  async function deleteJobCodeAction(formData: FormData) {
    "use server";
    const state = decodeContext(formData);
    const jobCodeIdRaw = String(formData.get("job_code_id") || "").trim();
    const supabase = createSupabaseServerClient();
    const { error } = await supabase.rpc("schedule_delete_job_code", {
      p_job_code_id: jobCodeIdRaw,
    });
    const path = buildSchedulePath({
      ...stateFromContext(clientId, state, weekStart),
      ...(error ? { error: error.message } : { success: "Job code removed" }),
    });
    await finishAction(path);
  }

  const [{ data: clientData }, { data: canEditData }, { data: canPublishData }, { data: canUnpublishData }, { data: canTemplatesData }, { data: canClaimData }, { data: canAuditData }, { data: canManageJobCodesData }] =
    await Promise.all([
      supabase.from("clients").select("id,name").eq("id", clientId).maybeSingle(),
      supabase.rpc("schedule_can_edit_client", { client_uuid: clientId }),
      supabase.rpc("schedule_can_publish_client", { client_uuid: clientId }),
      supabase.rpc("schedule_can_unpublish_client", { client_uuid: clientId }),
      supabase.rpc("schedule_can_manage_templates_client", { client_uuid: clientId }),
      supabase.rpc("schedule_can_claim_open_shift_client", { client_uuid: clientId }),
      supabase.rpc("schedule_can_view_audit_client", { client_uuid: clientId }),
      supabase.rpc("schedule_can_manage_job_codes"),
    ]);

  if (!clientData) notFound();
  const client = clientData as { id: string; name: string };
  const canEdit = Boolean(canEditData);
  const canPublish = Boolean(canPublishData);
  const canUnpublish = Boolean(canUnpublishData);
  const canManageTemplates = Boolean(canTemplatesData);
  const canClaim = Boolean(canClaimData);
  const canViewAudit = Boolean(canAuditData);
  const canManageJobCodes = Boolean(canManageJobCodesData);

  if (canEdit) {
    await supabase.rpc("schedule_sync_roster_for_client", { p_client_id: clientId });
    await supabase.rpc("schedule_get_or_create_week", {
      p_client_id: clientId,
      p_reference_date: weekStart,
      p_timezone: "UTC",
    });
  }

  const { data: weekData } = await supabase
    .from("schedule_weeks")
    .select("id,client_id,week_start_date,status,published_version")
    .eq("client_id", clientId)
    .eq("week_start_date", weekStart)
    .maybeSingle();
  const week = (weekData || null) as WeekRow | null;

  const [{ data: rosterData }, { data: shiftsData }, { data: jobCodesData }, { data: templatesData }, { data: usersData }, { data: auditData }] =
    await Promise.all([
      supabase
        .from("schedule_roster_entries")
        .select("id,user_id,display_name,email,role_token,role_label,active")
        .eq("client_id", clientId)
        .eq("active", true),
      week
        ? supabase
            .from("schedule_shifts")
            .select("id,week_id,roster_entry_id,is_open,local_date,start_local_time,end_local_time,ends_next_day,break_minutes,job_code_id,notes")
            .eq("week_id", week.id)
            .order("local_date", { ascending: true })
            .order("start_local_time", { ascending: true })
        : Promise.resolve({ data: [] as ShiftRow[], error: null }),
      supabase
        .from("schedule_job_codes")
        .select("id,code,color_hex,is_active")
        .order("sort_order", { ascending: true })
        .order("code", { ascending: true }),
      supabase.from("schedule_templates").select("id,name").eq("client_id", clientId),
      canEdit
        ? supabase
            .from("users")
            .select("id,full_name,email,status")
            .order("full_name", { ascending: true })
            .order("email", { ascending: true })
        : Promise.resolve({ data: [], error: null }),
      week && canViewAudit
        ? supabase
            .from("schedule_audit_events")
            .select("id,action,actor_user_id,created_at")
            .eq("week_id", week.id)
            .order("created_at", { ascending: false })
            .limit(60)
        : Promise.resolve({ data: [], error: null }),
    ]);

  const roster = ((rosterData || []) as RosterRow[]).sort((a, b) => {
    const rankDiff = roleRank(a.role_token) - roleRank(b.role_token);
    if (rankDiff !== 0) return rankDiff;
    return a.display_name.localeCompare(b.display_name, undefined, { sensitivity: "base" });
  });
  const shifts = (shiftsData || []) as ShiftRow[];
  const jobCodes = (jobCodesData || []) as JobCodeRow[];
  const templates = (templatesData || []) as TemplateRow[];
  const users = (usersData || []) as Array<{ id: string; full_name: string | null; email: string | null; status: string | null }>;
  const audits = (auditData || []) as AuditRow[];

  const jobCodeById = new Map(jobCodes.map((row) => [row.id, row]));
  const visibleDaySet = new Set(visibleDays);
  const filteredRoster = roster.filter((row) => {
    const rowRole = String(row.role_token || "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, "_");
    if (roleFilter && rowRole !== roleFilter) return false;
    if (!searchQuery) return true;
    const haystack = `${row.display_name} ${row.email || ""} ${row.role_label}`.toLowerCase();
    return haystack.includes(searchQuery);
  });
  const filteredRosterIds = new Set(filteredRoster.map((row) => row.id));
  const filteredShifts = shifts.filter((shift) => {
    if (!visibleDaySet.has(shift.local_date)) return false;
    if (jobFilter && shift.job_code_id !== jobFilter) return false;
    if (shift.is_open) return true;
    if (!shift.roster_entry_id) return false;
    return filteredRosterIds.has(shift.roster_entry_id);
  });
  const openShifts = filteredShifts.filter((shift) => shift.is_open);
  const shiftsByRosterDay = filteredShifts.reduce<Record<string, ShiftRow[]>>((acc, shift) => {
    if (shift.is_open || !shift.roster_entry_id) return acc;
    const key = `${shift.roster_entry_id}:${shift.local_date}`;
    acc[key] ||= [];
    acc[key].push(shift);
    return acc;
  }, {});
  const dayTotals = visibleDays.reduce<Record<string, number>>((acc, day) => {
    acc[day] = filteredShifts
      .filter((shift) => shift.local_date === day)
      .reduce((sum, shift) => sum + shiftWorkedMinutes(shift), 0);
    return acc;
  }, {});

  const prevWeek = toDateOnly(addDays(weekDate, -7));
  const nextWeek = toDateOnly(addDays(weekDate, 7));
  const prevSelectedDay = toDateOnly(addDays(selectedDayDate, -7));
  const nextSelectedDay = toDateOnly(addDays(selectedDayDate, 7));
  const thisWeekStart = toDateOnly(startOfMonday(new Date()));
  const thisDay = toDateOnly(new Date());
  const hasActiveFilters = Boolean(searchQuery || roleFilter || jobFilter);
  const renderContextFields = () => (
    <>
      <input type="hidden" name="ctx_week" value={weekStart} />
      <input type="hidden" name="ctx_range" value={rangeView} />
      <input type="hidden" name="ctx_day" value={selectedDay} />
      <input type="hidden" name="ctx_q" value={searchQueryRaw} />
      <input type="hidden" name="ctx_role" value={roleFilterRaw} />
      <input type="hidden" name="ctx_job" value={jobFilter} />
    </>
  );

  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <Link href="/schedules" className="text-sm text-slate-600 hover:underline">
          Back to clients
        </Link>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold text-slate-900">{client.name} Schedule</h1>
            <p className="text-sm text-slate-600">Week of {formatDateLabel(weekStart)}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href={buildSchedulePath({ clientId, weekStart: prevWeek, rangeView, day: prevSelectedDay, q: searchQueryRaw, roleFilter: roleFilterRaw, jobFilter })} className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-100">Previous week</Link>
            <Link href={buildSchedulePath({ clientId, weekStart: nextWeek, rangeView, day: nextSelectedDay, q: searchQueryRaw, roleFilter: roleFilterRaw, jobFilter })} className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-100">Next week</Link>
          </div>
        </div>
        {resolvedSearch?.error ? <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{resolvedSearch.error}</p> : null}
        {resolvedSearch?.success ? <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{resolvedSearch.success}</p> : null}
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-4 space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold text-slate-700">Week status:</span>
          <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${week?.status === "published" ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-700"}`}>{week?.status || "Draft"}</span>
          {week ? (
            <>
              {canPublish ? (
                <form action={publishWeekAction}>
                  <input type="hidden" name="week_id" value={week.id} />
                  {renderContextFields()}
                  <button type="submit" className="rounded-md border border-emerald-300 px-3 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-50">Publish</button>
                </form>
              ) : null}
              {canUnpublish ? (
                <form action={unpublishWeekAction}>
                  <input type="hidden" name="week_id" value={week.id} />
                  {renderContextFields()}
                  <button type="submit" className="rounded-md border border-amber-300 px-3 py-1.5 text-xs font-semibold text-amber-700 hover:bg-amber-50">Unpublish</button>
                </form>
              ) : null}
            </>
          ) : canEdit ? (
            <form action={createOrLoadWeekAction}>
              {renderContextFields()}
              <button type="submit" className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100">Create draft week</button>
            </form>
          ) : null}
          <Link
            href={buildSchedulePath({
              clientId,
              weekStart: thisWeekStart,
              rangeView,
              day: thisDay,
              q: searchQueryRaw,
              roleFilter: roleFilterRaw,
              jobFilter,
            })}
            className={`rounded-md border px-3 py-1.5 text-xs font-semibold ${
              weekStart === thisWeekStart ? "border-slate-900 bg-slate-900 text-white" : "border-slate-300 text-slate-700 hover:bg-slate-100"
            }`}
          >
            This week
          </Link>
          <details className="relative">
            <summary className="cursor-pointer list-none rounded-md border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100">
              Week
            </summary>
            <div className="absolute right-0 z-20 mt-2 w-72 rounded-lg border border-slate-200 bg-white p-3 shadow-lg">
              <form method="get" className="space-y-2">
                <input type="hidden" name="range" value={rangeView} />
                <input type="hidden" name="day" value={selectedDay} />
                <input type="hidden" name="q" value={searchQueryRaw} />
                <input type="hidden" name="role" value={roleFilterRaw} />
                <input type="hidden" name="job" value={jobFilter} />
                <label className="block text-xs text-slate-600">
                  Week date
                  <input type="date" name="week" defaultValue={weekStart} className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm" />
                </label>
                <button type="submit" className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100">Go to week</button>
              </form>
            </div>
          </details>
          {canEdit || canManageJobCodes || week ? (
            <details className="relative">
              <summary className="cursor-pointer list-none rounded-md border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100">
                Schedule actions
              </summary>
              <div className="absolute right-0 z-20 mt-2 w-[42rem] max-w-[calc(100vw-2rem)] rounded-lg border border-slate-200 bg-white p-3 shadow-lg">
                <div className="max-h-[70vh] space-y-3 overflow-auto pr-1">
                  {week ? (
                    <section className="space-y-2 rounded-md border border-slate-200 p-2">
                      <h3 className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Export</h3>
                      <Link href={`/schedules/${clientId}/export?week=${encodeURIComponent(weekStart)}`} className="inline-flex rounded-md border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100">Export CSV</Link>
                    </section>
                  ) : null}

                  {canEdit && week ? (
                    <section className="space-y-2 rounded-md border border-slate-200 p-2">
                      <h3 className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Create Shift</h3>
                      <form action={upsertShiftAction} className="grid gap-2 md:grid-cols-2">
                        <input type="hidden" name="week_id" value={week.id} />
                        {renderContextFields()}
                        <label className="text-xs text-slate-600">
                          Employee
                          <select name="roster_entry_id" className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm">
                            <option value="">Select employee</option>
                            {roster.map((row) => (
                              <option key={row.id} value={row.id}>{row.display_name} ({row.role_label})</option>
                            ))}
                          </select>
                        </label>
                        <label className="text-xs text-slate-600">
                          Date
                          <input type="date" name="local_date" defaultValue={selectedDay} className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm" required />
                        </label>
                        <label className="text-xs text-slate-600">
                          Start
                          <input type="time" name="start_local_time" defaultValue="09:00" className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm" required />
                        </label>
                        <label className="text-xs text-slate-600">
                          End
                          <input type="time" name="end_local_time" defaultValue="17:00" className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm" required />
                        </label>
                        <label className="text-xs text-slate-600">
                          Break minutes
                          <input type="number" name="break_minutes" min={0} defaultValue={30} className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm" />
                        </label>
                        <label className="text-xs text-slate-600">
                          Job code
                          <select name="job_code_id" className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm">
                            <option value="">None</option>
                            {jobCodes.filter((code) => code.is_active).map((code) => (
                              <option key={code.id} value={code.id}>{code.code}</option>
                            ))}
                          </select>
                        </label>
                        <label className="text-xs text-slate-600 md:col-span-2">
                          Notes
                          <input type="text" name="notes" className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm" />
                        </label>
                        <div className="flex items-center gap-4 text-xs text-slate-700 md:col-span-2">
                          <label className="inline-flex items-center gap-2"><input type="checkbox" name="is_open" value="on" />Open shift</label>
                          <label className="inline-flex items-center gap-2"><input type="checkbox" name="ends_next_day" value="on" />Ends next day</label>
                        </div>
                        <div className="md:col-span-2">
                          <button type="submit" className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100">Save shift</button>
                        </div>
                      </form>
                    </section>
                  ) : null}

                  {canEdit ? (
                    <section className="space-y-2 rounded-md border border-slate-200 p-2">
                      <h3 className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Roster</h3>
                      <form action={addRosterUserAction} className="space-y-2">
                        {renderContextFields()}
                        <label className="block text-xs text-slate-600">
                          User
                          <select name="user_id" className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm">
                            <option value="">Select user</option>
                            {users.map((user) => (
                              <option key={user.id} value={user.id}>
                                {user.full_name || user.email || user.id}
                                {user.email ? ` (${user.email})` : ""}
                                {user.status ? ` - ${user.status}` : ""}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="block text-xs text-slate-600">
                          Role
                          <select name="role_token" defaultValue="agent" className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm">
                            <option value="manager">Manager</option>
                            <option value="team_leader">Team Leader</option>
                            <option value="agent">Agent</option>
                          </select>
                        </label>
                        <button type="submit" className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100">Add user</button>
                      </form>
                      <form action={syncRosterAction}>
                        {renderContextFields()}
                        <button type="submit" className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100">Sync from Employee Info</button>
                      </form>
                    </section>
                  ) : null}

                  {canEdit && week ? (
                    <section className="space-y-2 rounded-md border border-slate-200 p-2">
                      <h3 className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Copy & Templates</h3>
                      <form action={copyPreviousWeekAction}>
                        <input type="hidden" name="week_id" value={week.id} />
                        {renderContextFields()}
                        <button type="submit" className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100">Copy from previous week</button>
                      </form>
                      {canManageTemplates ? (
                        <>
                          <form action={createTemplateAction} className="flex flex-wrap items-center gap-2">
                            <input type="hidden" name="week_id" value={week.id} />
                            {renderContextFields()}
                            <input name="template_name" placeholder="Template name" className="flex-1 rounded-md border border-slate-300 px-2 py-1.5 text-sm" />
                            <button type="submit" className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100">Create template</button>
                          </form>
                          <form action={applyTemplateAction} className="grid gap-2 md:grid-cols-[1fr,1fr,auto]">
                            <input type="hidden" name="week_id" value={week.id} />
                            {renderContextFields()}
                            <select name="template_id" className="rounded-md border border-slate-300 px-2 py-1.5 text-sm">
                              <option value="">Select template</option>
                              {templates.map((template) => (
                                <option key={template.id} value={template.id}>{template.name}</option>
                              ))}
                            </select>
                            <select name="mapping_mode" className="rounded-md border border-slate-300 px-2 py-1.5 text-sm" defaultValue="role_slot">
                              <option value="role_slot">By role-slot</option>
                              <option value="by_employee">By employee</option>
                            </select>
                            <button type="submit" className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100">Apply template</button>
                          </form>
                        </>
                      ) : null}
                    </section>
                  ) : null}

                  {canManageJobCodes ? (
                    <section className="space-y-2 rounded-md border border-slate-200 p-2">
                      <h3 className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Job Codes</h3>
                      <form action={upsertJobCodeAction} className="grid gap-2 md:grid-cols-2">
                        {renderContextFields()}
                        <label className="text-xs text-slate-600">Code
                          <input name="code" className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm" required />
                        </label>
                        <label className="text-xs text-slate-600">Color
                          <input name="color_hex" defaultValue="#2563EB" className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm" required />
                        </label>
                        <label className="text-xs text-slate-600">Sort
                          <input type="number" name="sort_order" defaultValue={0} className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm" />
                        </label>
                        <label className="inline-flex items-center gap-2 self-end text-xs text-slate-700">
                          <input type="checkbox" name="is_active" defaultChecked />
                          Active
                        </label>
                        <div className="md:col-span-2">
                          <button type="submit" className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100">Add job code</button>
                        </div>
                      </form>
                      <div className="max-h-56 space-y-1 overflow-auto pr-1">
                        {jobCodes.map((code) => (
                          <div key={code.id} className="flex items-center justify-between gap-2 rounded-md border border-slate-200 px-2 py-1.5 text-xs">
                            <div className="flex items-center gap-2">
                              <span className="inline-flex h-2.5 w-2.5 rounded-full" style={{ backgroundColor: code.color_hex }} />
                              <span className="font-semibold text-slate-900">{code.code}</span>
                              {!code.is_active ? <span className="text-amber-700">(inactive)</span> : null}
                            </div>
                            <form action={deleteJobCodeAction}>
                              <input type="hidden" name="job_code_id" value={code.id} />
                              {renderContextFields()}
                              <button type="submit" className="text-red-700 hover:underline">Remove</button>
                            </form>
                          </div>
                        ))}
                      </div>
                    </section>
                  ) : null}
                </div>
              </div>
            </details>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2 text-xs">
          <Link href={buildSchedulePath({ clientId, weekStart, rangeView: "week", day: selectedDay, q: searchQueryRaw, roleFilter: roleFilterRaw, jobFilter })} className={`rounded-md border px-3 py-1.5 ${rangeView === "week" ? "border-slate-900 bg-slate-900 text-white" : "border-slate-300 text-slate-700 hover:bg-slate-100"}`}>Week</Link>
          <Link href={buildSchedulePath({ clientId, weekStart, rangeView: "day", day: selectedDay, q: searchQueryRaw, roleFilter: roleFilterRaw, jobFilter })} className={`rounded-md border px-3 py-1.5 ${rangeView === "day" ? "border-slate-900 bg-slate-900 text-white" : "border-slate-300 text-slate-700 hover:bg-slate-100"}`}>Day</Link>
          <Link href={buildSchedulePath({ clientId, weekStart, rangeView: "month", day: selectedDay, q: searchQueryRaw, roleFilter: roleFilterRaw, jobFilter })} className={`rounded-md border px-3 py-1.5 ${rangeView === "month" ? "border-slate-900 bg-slate-900 text-white" : "border-slate-300 text-slate-700 hover:bg-slate-100"}`}>Month</Link>
        </div>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-4 space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Open Shifts</h2>
        {openShifts.length ? openShifts.map((shift) => (
          <div key={shift.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-slate-200 px-3 py-2 text-sm">
            <div>
              <p className="font-medium text-slate-900">{formatDateLabel(shift.local_date)} {formatTimeLabel(shift.start_local_time)} - {formatTimeLabel(shift.end_local_time)}</p>
              <p className="text-xs text-slate-600">Break {shift.break_minutes}m{shift.job_code_id ? ` - ${jobCodeById.get(shift.job_code_id)?.code || ""}` : ""}</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {canClaim ? (
                <form action={claimOpenShiftAction}>
                  <input type="hidden" name="shift_id" value={shift.id} />
                  {renderContextFields()}
                  <button type="submit" className="rounded-md border border-sky-300 px-3 py-1.5 text-xs font-semibold text-sky-700 hover:bg-sky-50">Claim shift</button>
                </form>
              ) : null}
              {canEdit ? (
                <form action={deleteShiftAction}>
                  <input type="hidden" name="shift_id" value={shift.id} />
                  {renderContextFields()}
                  <button type="submit" className="rounded-md border border-red-300 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-50">Delete</button>
                </form>
              ) : null}
            </div>
          </div>
        )) : <p className="text-sm text-slate-600">No open shifts for this range.</p>}
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Grid View</h2>
          <form method="get" className="flex flex-wrap items-center gap-2 text-xs">
            <input type="hidden" name="week" value={weekStart} />
            <input type="hidden" name="range" value={rangeView} />
            <input type="hidden" name="day" value={selectedDay} />
            <label className="text-slate-600">
              Search
              <input name="q" defaultValue={searchQueryRaw} className="ml-1 rounded-md border border-slate-300 px-2 py-1" placeholder="name/email/role" />
            </label>
            <label className="text-slate-600">
              Role
              <select name="role" defaultValue={roleFilterRaw} className="ml-1 rounded-md border border-slate-300 px-2 py-1">
                <option value="">All</option>
                <option value="manager">Manager</option>
                <option value="team_leader">Team Leader</option>
                <option value="agent">Agent</option>
              </select>
            </label>
            <label className="text-slate-600">
              Job
              <select name="job" defaultValue={jobFilter} className="ml-1 rounded-md border border-slate-300 px-2 py-1">
                <option value="">All</option>
                {jobCodes.map((code) => (
                  <option key={code.id} value={code.id}>{code.code}</option>
                ))}
              </select>
            </label>
            <button type="submit" className="rounded-md border border-slate-300 px-2.5 py-1 text-slate-700 hover:bg-slate-100">Apply</button>
          </form>
        </div>
        <div className="overflow-x-auto">
            <table className="min-w-full border-collapse text-sm">
              <thead>
                <tr className="bg-slate-50 text-xs uppercase text-slate-500">
                  <th className="border border-slate-200 px-3 py-2 text-left">Employee</th>
                  {visibleDays.map((day) => (
                    <th key={day} className="border border-slate-200 px-3 py-2 text-left">
                      <div>{formatDateLabel(day)}</div>
                      <div className="normal-case text-[11px] text-slate-500">{formatHours(dayTotals[day] || 0)}h workable</div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredRoster.length ? filteredRoster.map((row) => (
                  <tr key={row.id}>
                    <td className="border border-slate-200 px-3 py-2 align-top">
                      <p className="font-medium text-slate-900">{row.display_name}</p>
                      <p className="text-xs text-slate-500">{row.role_label}</p>
                      {canEdit ? (
                        <form action={removeRosterUserAction}>
                          <input type="hidden" name="roster_entry_id" value={row.id} />
                          {renderContextFields()}
                          <button type="submit" className="mt-1 text-xs text-red-700 hover:underline">Remove</button>
                        </form>
                      ) : null}
                    </td>
                    {visibleDays.map((day) => {
                      const dayShifts = shiftsByRosterDay[`${row.id}:${day}`] || [];
                      return (
                        <td key={day} className="relative border border-slate-200 p-2 align-top">
                          {canEdit && week ? (
                            <details className="absolute inset-0 z-0 open:z-20">
                              <summary
                                className="block h-full w-full cursor-pointer list-none rounded-sm hover:bg-sky-50/40"
                                aria-label={`Create shift for ${row.display_name} on ${day}`}
                              />
                              <div className="absolute left-2 right-2 top-2 rounded-md border border-slate-200 bg-white p-2 shadow-lg">
                                <p className="mb-1 text-[11px] font-semibold text-slate-800">
                                  Create shift: {row.display_name} ({formatDateLabel(day)})
                                </p>
                                <form action={upsertShiftAction} className="grid gap-1.5">
                                  <input type="hidden" name="week_id" value={week.id} />
                                  <input type="hidden" name="roster_entry_id" value={row.id} />
                                  <input type="hidden" name="local_date" value={day} />
                                  {renderContextFields()}
                                  <div className="grid grid-cols-2 gap-1.5">
                                    <input
                                      type="time"
                                      name="start_local_time"
                                      defaultValue="09:00"
                                      className="rounded border border-slate-300 px-2 py-1 text-xs"
                                      required
                                    />
                                    <input
                                      type="time"
                                      name="end_local_time"
                                      defaultValue="17:00"
                                      className="rounded border border-slate-300 px-2 py-1 text-xs"
                                      required
                                    />
                                  </div>
                                  <input
                                    type="number"
                                    name="break_minutes"
                                    min={0}
                                    defaultValue={30}
                                    className="rounded border border-slate-300 px-2 py-1 text-xs"
                                  />
                                  <select
                                    name="job_code_id"
                                    className="rounded border border-slate-300 px-2 py-1 text-xs"
                                  >
                                    <option value="">None</option>
                                    {jobCodes.filter((code) => code.is_active).map((code) => (
                                      <option key={code.id} value={code.id}>
                                        {code.code}
                                      </option>
                                    ))}
                                  </select>
                                  <input
                                    type="text"
                                    name="notes"
                                    placeholder="Notes (optional)"
                                    className="rounded border border-slate-300 px-2 py-1 text-xs"
                                  />
                                  <label className="inline-flex items-center gap-1 text-[11px] text-slate-700">
                                    <input type="checkbox" name="ends_next_day" value="on" />
                                    Ends next day
                                  </label>
                                  <button
                                    type="submit"
                                    className="rounded border border-slate-300 px-2 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-100"
                                  >
                                    Save shift
                                  </button>
                                </form>
                              </div>
                            </details>
                          ) : null}
                          <div className="relative z-10 space-y-2">
                            {dayShifts.map((shift) => {
                              const jobCode = shift.job_code_id ? jobCodeById.get(shift.job_code_id) : null;
                              const jobCodeText = jobCode ? jobCode.code : "None";
                              const shiftSummary = (
                                <>
                                  <div className="font-medium text-slate-900">
                                    {formatTimeLabel(shift.start_local_time)} - {formatTimeLabel(shift.end_local_time)}
                                  </div>
                                  <div className="flex flex-wrap items-center gap-2 text-slate-600">
                                    <span>Break {shift.break_minutes}m</span>
                                    {jobCode ? (
                                      <span
                                        className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold text-white"
                                        style={{ backgroundColor: jobCode.color_hex || "#1E293B" }}
                                      >
                                        {jobCode.code}
                                      </span>
                                    ) : null}
                                  </div>
                                  <div className="text-slate-600">Job code: {jobCodeText}</div>
                                  {shift.notes ? <div className="text-slate-500">{shift.notes}</div> : null}
                                </>
                              );

                              if (canEdit && week) {
                                return (
                                  <details key={shift.id} className="rounded-md border border-slate-200 bg-white text-xs">
                                    <summary className="list-none cursor-pointer p-2 hover:bg-slate-50">
                                      {shiftSummary}
                                      <p className="mt-1 text-[10px] font-medium text-slate-500">Click shift to edit</p>
                                    </summary>
                                    <div className="border-t border-slate-200 bg-slate-50 p-2">
                                      <form action={upsertShiftAction} className="grid gap-1.5">
                                        <input type="hidden" name="week_id" value={week.id} />
                                        <input type="hidden" name="shift_id" value={shift.id} />
                                        <input type="hidden" name="roster_entry_id" value={shift.roster_entry_id || ""} />
                                        {renderContextFields()}
                                        <input type="date" name="local_date" defaultValue={shift.local_date} className="rounded border border-slate-300 px-2 py-1" required />
                                        <div className="grid grid-cols-2 gap-1.5">
                                          <input type="time" name="start_local_time" defaultValue={shift.start_local_time.slice(0, 5)} className="rounded border border-slate-300 px-2 py-1" required />
                                          <input type="time" name="end_local_time" defaultValue={shift.end_local_time.slice(0, 5)} className="rounded border border-slate-300 px-2 py-1" required />
                                        </div>
                                        <input type="number" name="break_minutes" min={0} defaultValue={shift.break_minutes} className="rounded border border-slate-300 px-2 py-1" />
                                        <select name="job_code_id" defaultValue={shift.job_code_id || ""} className="rounded border border-slate-300 px-2 py-1">
                                          <option value="">None</option>
                                          {jobCodes.map((code) => (
                                            <option key={code.id} value={code.id}>{code.code}</option>
                                          ))}
                                        </select>
                                        <input type="text" name="notes" defaultValue={shift.notes || ""} className="rounded border border-slate-300 px-2 py-1" placeholder="Notes" />
                                        <label className="inline-flex items-center gap-1 text-[11px] text-slate-700">
                                          <input type="checkbox" name="ends_next_day" value="on" defaultChecked={shift.ends_next_day} />
                                          Ends next day
                                        </label>
                                        <button type="submit" className="rounded border border-slate-300 px-2 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-100">Save</button>
                                      </form>
                                      <form action={deleteShiftAction} className="mt-1.5">
                                        <input type="hidden" name="shift_id" value={shift.id} />
                                        {renderContextFields()}
                                        <button type="submit" className="w-full rounded border border-red-300 px-2 py-1 text-[11px] font-semibold text-red-700 hover:bg-red-50">Delete shift</button>
                                      </form>
                                    </div>
                                  </details>
                                );
                              }

                              return (
                                <div key={shift.id} className="rounded-md border border-slate-200 p-2 text-xs">
                                  {shiftSummary}
                                </div>
                              );
                            })}
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                )) : (
                  <tr>
                    <td className="border border-slate-200 px-3 py-4 text-slate-500" colSpan={visibleDays.length + 1}>
                      {hasActiveFilters ? "No roster entries match the current filters." : "No roster entries available."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
      </section>

      {canViewAudit && week ? (
        <section className="rounded-lg border border-slate-200 bg-white p-4 space-y-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Audit Log</h2>
          {audits.length ? audits.map((row) => (
            <div key={row.id} className="rounded-md border border-slate-200 px-3 py-2 text-sm">
              <p className="font-medium text-slate-900">{row.action}</p>
              <p className="text-xs text-slate-600">{new Date(row.created_at).toLocaleString("en-US")}{row.actor_user_id ? ` - ${row.actor_user_id}` : ""}</p>
            </div>
          )) : <p className="text-sm text-slate-600">No audit events yet for this week.</p>}
        </section>
      ) : null}
    </div>
  );
}

