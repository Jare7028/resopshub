import Link from "next/link";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const isoDateRegex = /^\d{4}-\d{2}-\d{2}$/;

type TimeOffCodeRow = {
  id: string;
  code: string;
  label: string;
  is_active: boolean;
  default_paid_days_per_year: number | string | null;
  carryover_enabled: boolean;
  carryover_cap_days: number | string | null;
  carryover_expiry_month: number | null;
  carryover_expiry_day: number | null;
  sort_order: number | null;
};

type TimeOffSettingRow = {
  id: number;
  start_date_column_id: string | null;
};

type TimeOffOverrideRow = {
  id: string;
  user_id: string;
  code_id: string;
  annual_paid_days: number | string | null;
};

type TimeOffRequestRow = {
  id: string;
  target_user_id: string;
  code_id: string;
  start_date: string;
  end_date: string;
  status: "pending" | "approved" | "rejected";
  request_note: string | null;
  submitted_by_user_id: string | null;
  submitted_at: string;
  decided_by_user_id: string | null;
  decided_at: string | null;
  decision_note: string | null;
  approved_paid_days: number | string | null;
  approved_unpaid_days: number | string | null;
};

type DateColumnRow = {
  id: string;
  label: string;
  key: string;
  position: number;
};

type UserRow = {
  id: string;
  full_name: string | null;
  email: string | null;
  status: string | null;
};

type BalanceRow = {
  target_user_id: string;
  target_user_name: string;
  code_id: string;
  code: string;
  label: string;
  leave_year: number;
  annual_paid_days: number | string | null;
  entitlement_days: number | string | null;
  carryover_pool_days: number | string | null;
  carryover_expiry_date: string | null;
  used_entitlement_days: number | string | null;
  used_carryover_days: number | string | null;
  used_unpaid_days: number | string | null;
  used_paid_days: number | string | null;
  remaining_entitlement_days: number | string | null;
  remaining_carryover_days: number | string | null;
  remaining_paid_days: number | string | null;
};

type SearchParams = {
  year?: string;
  status?: string;
  tab?: string;
  error?: string;
  success?: string;
  edit_code_id?: string;
  preview_user_id?: string;
  preview_code_id?: string;
  preview_start?: string;
  preview_end?: string;
};

const timeOffTabs = [
  { key: "policies", label: "Policies" },
  { key: "codes", label: "Codes" },
  { key: "overrides", label: "Overrides" },
  { key: "requests", label: "Requests" },
  { key: "balances", label: "Balances" },
] as const;

type TimeOffTab = (typeof timeOffTabs)[number]["key"];

function normalizeTimeOffTab(value: string | null | undefined): TimeOffTab {
  const normalized = String(value || "").trim().toLowerCase();
  const matched = timeOffTabs.find((tab) => tab.key === normalized);
  return matched ? matched.key : "requests";
}

function isIsoDate(value: string) {
  return isoDateRegex.test(String(value || "").trim());
}

function parseYear(value: string | null | undefined) {
  const parsed = Number.parseInt(String(value || "").trim(), 10);
  const currentYear = new Date().getUTCFullYear();
  if (!Number.isFinite(parsed) || parsed < 2000 || parsed > 2200) return currentYear;
  return parsed;
}

function toNonNegative(value: number | string | null | undefined) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function parseIntInput(
  rawValue: FormDataEntryValue | null,
  label: string,
  options?: { min?: number; max?: number; allowBlank?: boolean }
) {
  const text = String(rawValue || "").trim();
  if (!text && options?.allowBlank) {
    return { ok: true as const, value: null as number | null };
  }
  if (!text) {
    return { ok: false as const, error: `${label} is required` };
  }
  const parsed = Number.parseInt(text, 10);
  if (!Number.isFinite(parsed)) {
    return { ok: false as const, error: `${label} must be a number` };
  }
  if (typeof options?.min === "number" && parsed < options.min) {
    return { ok: false as const, error: `${label} must be at least ${options.min}` };
  }
  if (typeof options?.max === "number" && parsed > options.max) {
    return { ok: false as const, error: `${label} must be at most ${options.max}` };
  }
  return { ok: true as const, value: parsed };
}

function displayName(user: UserRow | null | undefined) {
  if (!user) return "Unknown user";
  const fullName = String(user.full_name || "").trim();
  if (fullName) return fullName;
  const email = String(user.email || "").trim();
  if (email) return email;
  return user.id;
}

function formatDateOnly(value: string | null | undefined) {
  if (!value || !isoDateRegex.test(value)) return value || "";
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("en-US", {
    timeZone: "UTC",
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

type PathArgs = {
  year?: number | string;
  status?: string;
  tab?: TimeOffTab;
  error?: string;
  success?: string;
  editCodeId?: string;
  previewUserId?: string;
  previewCodeId?: string;
  previewStart?: string;
  previewEnd?: string;
};

function buildTimeOffPath(args: PathArgs = {}) {
  const sp = new URLSearchParams();
  if (args.year !== undefined && String(args.year).trim()) sp.set("year", String(args.year).trim());
  if (args.status) sp.set("status", args.status);
  if (args.tab) sp.set("tab", args.tab);
  if (args.error) sp.set("error", args.error);
  if (args.success) sp.set("success", args.success);
  if (args.editCodeId) sp.set("edit_code_id", args.editCodeId);
  if (args.previewUserId) sp.set("preview_user_id", args.previewUserId);
  if (args.previewCodeId) sp.set("preview_code_id", args.previewCodeId);
  if (args.previewStart) sp.set("preview_start", args.previewStart);
  if (args.previewEnd) sp.set("preview_end", args.previewEnd);
  const query = sp.toString();
  return query ? `/schedules/time-off?${query}` : "/schedules/time-off";
}

export default async function ScheduleTimeOffPage({
  searchParams,
}: {
  searchParams?: Promise<SearchParams>;
}) {
  const resolvedSearch = await searchParams;
  const selectedYear = parseYear(resolvedSearch?.year);
  const selectedStatusRaw = String(resolvedSearch?.status || "").trim().toLowerCase();
  const selectedTab = normalizeTimeOffTab(resolvedSearch?.tab);
  const selectedStatus =
    selectedStatusRaw === "pending" || selectedStatusRaw === "approved" || selectedStatusRaw === "rejected"
      ? selectedStatusRaw
      : "";
  const selectedEditCodeId = uuidRegex.test(String(resolvedSearch?.edit_code_id || "").trim())
    ? String(resolvedSearch?.edit_code_id || "").trim()
    : "";
  const previewUserId = uuidRegex.test(String(resolvedSearch?.preview_user_id || "").trim())
    ? String(resolvedSearch?.preview_user_id || "").trim()
    : "";
  const previewCodeId = uuidRegex.test(String(resolvedSearch?.preview_code_id || "").trim())
    ? String(resolvedSearch?.preview_code_id || "").trim()
    : "";
  const previewStart = isIsoDate(String(resolvedSearch?.preview_start || ""))
    ? String(resolvedSearch?.preview_start)
    : "";
  const previewEnd = isIsoDate(String(resolvedSearch?.preview_end || ""))
    ? String(resolvedSearch?.preview_end)
    : "";

  async function finish(path: string) {
    "use server";
    revalidatePath("/schedules");
    revalidatePath("/schedules/time-off");
    redirect(path);
  }

  async function saveSettingsAction(formData: FormData) {
    "use server";
    const year = parseYear(String(formData.get("year") || ""));
    const status = String(formData.get("status") || "").trim().toLowerCase();
    const tab = normalizeTimeOffTab(String(formData.get("tab") || ""));
    const selectedColumnRaw = String(formData.get("start_date_column_id") || "").trim();
    const selectedColumn = uuidRegex.test(selectedColumnRaw) ? selectedColumnRaw : null;

    const supabase = createSupabaseServerClient();
    const { error } = await supabase.rpc("schedule_time_off_upsert_settings", {
      p_start_date_column_id: selectedColumn,
    });

    await finish(
      buildTimeOffPath({
        year,
        status,
        tab,
        ...(error ? { error: error.message } : { success: "Time off settings saved" }),
      })
    );
  }

  async function saveCodeAction(formData: FormData) {
    "use server";
    const year = parseYear(String(formData.get("year") || ""));
    const status = String(formData.get("status") || "").trim().toLowerCase();
    const tab = normalizeTimeOffTab(String(formData.get("tab") || ""));
    const codeIdRaw = String(formData.get("code_id") || "").trim();
    const codeId = uuidRegex.test(codeIdRaw) ? codeIdRaw : null;
    const code = String(formData.get("code") || "").trim();
    const label = String(formData.get("label") || "").trim();
    const defaultPaid = parseIntInput(formData.get("default_paid_days_per_year"), "Default paid days", { min: 0 });
    if (!defaultPaid.ok) {
      await finish(buildTimeOffPath({ year, status, tab, error: defaultPaid.error, ...(codeId ? { editCodeId: codeId } : {}) }));
      return;
    }

    const carryoverCap = parseIntInput(formData.get("carryover_cap_days"), "Carryover cap days", {
      min: 0,
      allowBlank: true,
    });
    if (!carryoverCap.ok) {
      await finish(buildTimeOffPath({ year, status, tab, error: carryoverCap.error, ...(codeId ? { editCodeId: codeId } : {}) }));
      return;
    }

    const sortOrder = parseIntInput(formData.get("sort_order"), "Sort order", {
      min: -999999,
      max: 999999,
      allowBlank: true,
    });
    if (!sortOrder.ok) {
      await finish(buildTimeOffPath({ year, status, tab, error: sortOrder.error, ...(codeId ? { editCodeId: codeId } : {}) }));
      return;
    }

    const carryoverEnabled = String(formData.get("carryover_enabled") || "").trim() === "on";
    const expiryMonth = parseIntInput(formData.get("carryover_expiry_month"), "Carryover expiry month", {
      min: 1,
      max: 12,
      allowBlank: true,
    });
    if (!expiryMonth.ok) {
      await finish(buildTimeOffPath({ year, status, tab, error: expiryMonth.error, ...(codeId ? { editCodeId: codeId } : {}) }));
      return;
    }

    const expiryDay = parseIntInput(formData.get("carryover_expiry_day"), "Carryover expiry day", {
      min: 1,
      max: 31,
      allowBlank: true,
    });
    if (!expiryDay.ok) {
      await finish(buildTimeOffPath({ year, status, tab, error: expiryDay.error, ...(codeId ? { editCodeId: codeId } : {}) }));
      return;
    }

    const isActive = String(formData.get("is_active") || "").trim() === "on";

    const supabase = createSupabaseServerClient();
    const { error } = await supabase.rpc("schedule_time_off_upsert_code", {
      p_code_id: codeId,
      p_code: code,
      p_label: label,
      p_default_paid_days_per_year: defaultPaid.value,
      p_carryover_enabled: carryoverEnabled,
      p_carryover_cap_days: carryoverCap.value ?? 0,
      p_carryover_expiry_month: carryoverEnabled ? expiryMonth.value : null,
      p_carryover_expiry_day: carryoverEnabled ? expiryDay.value : null,
      p_sort_order: sortOrder.value ?? 0,
      p_is_active: isActive,
    });

    await finish(
      buildTimeOffPath({
        year,
        status,
        tab,
        ...(error ? { error: error.message } : { success: "Time off code saved" }),
      })
    );
  }

  async function setCodeActiveAction(formData: FormData) {
    "use server";
    const year = parseYear(String(formData.get("year") || ""));
    const status = String(formData.get("status") || "").trim().toLowerCase();
    const tab = normalizeTimeOffTab(String(formData.get("tab") || ""));
    const codeId = String(formData.get("code_id") || "").trim();
    const isActive = String(formData.get("is_active") || "").trim() === "true";
    if (!uuidRegex.test(codeId)) {
      await finish(buildTimeOffPath({ year, status, tab, error: "Invalid code id" }));
      return;
    }

    const supabase = createSupabaseServerClient();
    const { error } = await supabase.rpc("schedule_time_off_set_code_active", {
      p_code_id: codeId,
      p_is_active: isActive,
    });

    await finish(
      buildTimeOffPath({
        year,
        status,
        tab,
        ...(error ? { error: error.message } : { success: "Code status updated" }),
      })
    );
  }

  async function saveOverrideAction(formData: FormData) {
    "use server";
    const year = parseYear(String(formData.get("year") || ""));
    const status = String(formData.get("status") || "").trim().toLowerCase();
    const tab = normalizeTimeOffTab(String(formData.get("tab") || ""));
    const userId = String(formData.get("user_id") || "").trim();
    const codeId = String(formData.get("code_id") || "").trim();
    if (!uuidRegex.test(userId) || !uuidRegex.test(codeId)) {
      await finish(buildTimeOffPath({ year, status, tab, error: "User and code are required" }));
      return;
    }
    const annualPaid = parseIntInput(formData.get("annual_paid_days"), "Annual paid days", { min: 0 });
    if (!annualPaid.ok) {
      await finish(buildTimeOffPath({ year, status, tab, error: annualPaid.error }));
      return;
    }

    const supabase = createSupabaseServerClient();
    const { error } = await supabase.rpc("schedule_time_off_upsert_user_override", {
      p_user_id: userId,
      p_code_id: codeId,
      p_annual_paid_days: annualPaid.value,
    });

    await finish(
      buildTimeOffPath({
        year,
        status,
        tab,
        ...(error ? { error: error.message } : { success: "Override saved" }),
      })
    );
  }

  async function deleteOverrideAction(formData: FormData) {
    "use server";
    const year = parseYear(String(formData.get("year") || ""));
    const status = String(formData.get("status") || "").trim().toLowerCase();
    const tab = normalizeTimeOffTab(String(formData.get("tab") || ""));
    const userId = String(formData.get("user_id") || "").trim();
    const codeId = String(formData.get("code_id") || "").trim();
    if (!uuidRegex.test(userId) || !uuidRegex.test(codeId)) {
      await finish(buildTimeOffPath({ year, status, tab, error: "Invalid override target" }));
      return;
    }

    const supabase = createSupabaseServerClient();
    const { error } = await supabase.rpc("schedule_time_off_delete_user_override", {
      p_user_id: userId,
      p_code_id: codeId,
    });

    await finish(
      buildTimeOffPath({
        year,
        status,
        tab,
        ...(error ? { error: error.message } : { success: "Override removed" }),
      })
    );
  }

  async function createRequestAction(formData: FormData) {
    "use server";
    const year = parseYear(String(formData.get("year") || ""));
    const status = String(formData.get("status") || "").trim().toLowerCase();
    const tab = normalizeTimeOffTab(String(formData.get("tab") || ""));
    const targetUserId = String(formData.get("target_user_id") || "").trim();
    const codeId = String(formData.get("code_id") || "").trim();
    const startDate = String(formData.get("start_date") || "").trim();
    const endDate = String(formData.get("end_date") || "").trim();
    const requestNote = String(formData.get("request_note") || "").trim();
    if (!uuidRegex.test(targetUserId) || !uuidRegex.test(codeId)) {
      await finish(buildTimeOffPath({ year, status, tab, error: "User and code are required" }));
      return;
    }
    if (!isIsoDate(startDate) || !isIsoDate(endDate)) {
      await finish(buildTimeOffPath({ year, status, tab, error: "Start and end date are required" }));
      return;
    }

    const supabase = createSupabaseServerClient();
    const { error } = await supabase.rpc("schedule_time_off_create_request", {
      p_target_user_id: targetUserId,
      p_code_id: codeId,
      p_start_date: startDate,
      p_end_date: endDate,
      p_request_note: requestNote || null,
    });

    await finish(
      buildTimeOffPath({
        year,
        status,
        tab,
        ...(error ? { error: error.message } : { success: "Time off request created" }),
      })
    );
  }

  async function decideRequestAction(formData: FormData) {
    "use server";
    const year = parseYear(String(formData.get("year") || ""));
    const status = String(formData.get("status") || "").trim().toLowerCase();
    const tab = normalizeTimeOffTab(String(formData.get("tab") || ""));
    const requestId = String(formData.get("request_id") || "").trim();
    const decision = String(formData.get("decision") || "").trim().toLowerCase();
    if (!uuidRegex.test(requestId)) {
      await finish(buildTimeOffPath({ year, status, tab, error: "Invalid request id" }));
      return;
    }
    if (decision !== "approved" && decision !== "rejected") {
      await finish(buildTimeOffPath({ year, status, tab, error: "Invalid decision" }));
      return;
    }

    const supabase = createSupabaseServerClient();
    const { error } = await supabase.rpc("schedule_time_off_decide_request", {
      p_request_id: requestId,
      p_decision: decision,
      p_decision_note: null,
    });

    await finish(
      buildTimeOffPath({
        year,
        status,
        tab,
        ...(error
          ? { error: error.message }
          : { success: decision === "approved" ? "Request approved" : "Request rejected" }),
      })
    );
  }

  const supabase = createSupabaseServerClient();
  const [
    { data: canManageData },
    { data: settingData },
    { data: dateColumnsData },
    { data: codesData },
    { data: overridesData },
    { data: usersData },
    { data: requestsData },
    balancesResult,
  ] = await Promise.all([
    supabase.rpc("schedule_can_manage_time_off"),
    supabase.from("schedule_time_off_settings").select("id,start_date_column_id").maybeSingle(),
    supabase
      .from("employee_info_columns")
      .select("id,label,key,position")
      .eq("column_kind", "date")
      .order("position", { ascending: true }),
    supabase
      .from("schedule_time_off_codes")
      .select(
        "id,code,label,is_active,default_paid_days_per_year,carryover_enabled,carryover_cap_days,carryover_expiry_month,carryover_expiry_day,sort_order"
      )
      .order("sort_order", { ascending: true })
      .order("label", { ascending: true }),
    supabase
      .from("schedule_time_off_user_overrides")
      .select("id,user_id,code_id,annual_paid_days")
      .order("created_at", { ascending: false }),
    supabase.from("users").select("id,full_name,email,status").order("full_name", { ascending: true }),
    supabase
      .from("schedule_time_off_requests")
      .select(
        "id,target_user_id,code_id,start_date,end_date,status,request_note,submitted_by_user_id,submitted_at,decided_by_user_id,decided_at,decision_note,approved_paid_days,approved_unpaid_days"
      )
      .order("submitted_at", { ascending: false })
      .limit(200),
    supabase.rpc("schedule_time_off_get_balances", {
      p_year: selectedYear,
      p_user_id: null,
      p_code_id: null,
    }),
  ]);

  const canManage = Boolean(canManageData);
  const setting = (settingData || null) as TimeOffSettingRow | null;
  const dateColumns = (dateColumnsData || []) as DateColumnRow[];
  const codes = (codesData || []) as TimeOffCodeRow[];
  const overrides = (overridesData || []) as TimeOffOverrideRow[];
  const users = ((usersData || []) as UserRow[]).filter((row) => row.status !== "disabled");
  const requests = (requestsData || []) as TimeOffRequestRow[];
  const balances = (balancesResult.data || []) as BalanceRow[];

  const userById = new Map(users.map((row) => [row.id, row]));
  const codeById = new Map(codes.map((row) => [row.id, row]));
  const editingCode = selectedEditCodeId ? codes.find((row) => row.id === selectedEditCodeId) || null : null;

  const activeCodeCount = codes.filter((row) => row.is_active).length;
  const pendingRequestCount = requests.filter((row) => row.status === "pending").length;
  const approvedRequestCount = requests.filter((row) => row.status === "approved").length;

  const filteredRequests = selectedStatus ? requests.filter((row) => row.status === selectedStatus) : requests;

  let previewResult: Record<string, unknown> | null = null;
  let previewError = "";
  if (previewUserId && previewCodeId && previewStart && previewEnd && canManage) {
    const { data, error } = await supabase.rpc("schedule_time_off_preview_request", {
      p_target_user_id: previewUserId,
      p_code_id: previewCodeId,
      p_start_date: previewStart,
      p_end_date: previewEnd,
    });
    if (error) {
      previewError = error.message;
    } else {
      previewResult = (data || null) as Record<string, unknown> | null;
    }
  }

  const selectedStartDateColumn = setting?.start_date_column_id
    ? dateColumns.find((row) => row.id === setting.start_date_column_id) || null
    : null;

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold text-slate-900">Schedule Time Off Suite</h1>
            <p className="text-sm text-slate-600">
              Configure leave policies, request approvals, and entitlement balances.
            </p>
          </div>
          <Link
            href="/schedules"
            className="inline-flex items-center rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
          >
            Back to schedules
          </Link>
        </div>
        <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-lg border border-slate-200 bg-slate-50/70 px-3 py-2">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Active codes</p>
            <p className="mt-1 text-lg font-semibold text-slate-900">{activeCodeCount}</p>
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50/70 px-3 py-2">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Pending requests</p>
            <p className="mt-1 text-lg font-semibold text-slate-900">{pendingRequestCount}</p>
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50/70 px-3 py-2">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Approved requests</p>
            <p className="mt-1 text-lg font-semibold text-slate-900">{approvedRequestCount}</p>
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50/70 px-3 py-2">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Year in view</p>
            <p className="mt-1 text-lg font-semibold text-slate-900">{selectedYear}</p>
          </div>
        </div>
      </section>

      {resolvedSearch?.error ? (
        <section className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {resolvedSearch.error}
        </section>
      ) : null}
      {resolvedSearch?.success ? (
        <section className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          {resolvedSearch.success}
        </section>
      ) : null}
      {!canManage ? (
        <section className="rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600">
          You have view-only access for time off configuration and approvals.
        </section>
      ) : null}

      <nav className="flex flex-wrap gap-2 border-b border-slate-200 pb-4 text-sm">
        {timeOffTabs.map((tab) => (
          <Link
            key={tab.key}
            href={buildTimeOffPath({
              year: selectedYear,
              status: selectedStatus,
              tab: tab.key,
              ...(tab.key === "codes" && selectedEditCodeId ? { editCodeId: selectedEditCodeId } : {}),
              ...(tab.key === "requests"
                ? {
                    previewUserId,
                    previewCodeId,
                    previewStart,
                    previewEnd,
                  }
                : {}),
            })}
            className={`rounded-md px-3 py-1.5 font-medium ${
              selectedTab === tab.key
                ? "tab-active"
                : "border border-slate-200 text-slate-700 hover:bg-slate-100 hover:text-slate-900"
            }`}
          >
            {tab.label}
          </Link>
        ))}
      </nav>

      {selectedTab === "policies" ? (
        <section className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="space-y-2">
              <h2 className="text-base font-semibold text-slate-900">Start Date Policy</h2>
              <p className="text-sm text-slate-600">
                Choose which Employee Info date column is used for first-year entitlement proration.
              </p>
              <p className="text-sm text-slate-700">
                Current column:{" "}
                <span className="font-semibold text-slate-900">
                  {selectedStartDateColumn
                    ? `${selectedStartDateColumn.label} (${selectedStartDateColumn.key})`
                    : "Not configured"}
                </span>
              </p>
            </div>
            <form
              action={saveSettingsAction}
              className="w-full max-w-xl space-y-3 rounded-lg border border-slate-200 bg-slate-50/70 p-3"
            >
              <input type="hidden" name="year" value={selectedYear} />
              <input type="hidden" name="status" value={selectedStatus} />
              <input type="hidden" name="tab" value={selectedTab} />
              <label className="block text-sm text-slate-700">
                Start date column
                <select
                  name="start_date_column_id"
                  defaultValue={setting?.start_date_column_id || ""}
                  disabled={!canManage}
                  className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm disabled:bg-slate-100"
                >
                  <option value="">Not set</option>
                  {dateColumns.map((column) => (
                    <option key={column.id} value={column.id}>
                      {column.label} ({column.key})
                    </option>
                  ))}
                </select>
              </label>
              {canManage ? (
                <button
                  type="submit"
                  className="rounded-md border border-slate-900 bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-800"
                >
                  Save policy
                </button>
              ) : null}
            </form>
          </div>
        </section>
      ) : null}

      {selectedTab === "codes" ? (
        <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-4 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-base font-semibold text-slate-900">Time-Off Codes</h2>
              <p className="text-sm text-slate-600">Manage code defaults and carryover behavior.</p>
            </div>
            {canManage ? (
              <Link
                href={buildTimeOffPath({ year: selectedYear, status: selectedStatus, tab: "codes" })}
                className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100"
              >
                Clear edit mode
              </Link>
            ) : null}
          </div>
          <div className="overflow-x-auto rounded-md border border-slate-200">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-3 py-2">Code</th>
                  <th className="px-3 py-2">Label</th>
                  <th className="px-3 py-2">Paid/year</th>
                  <th className="px-3 py-2">Carryover</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {codes.length ? (
                  codes.map((code) => (
                    <tr
                      key={code.id}
                      className={`border-t border-slate-200 ${editingCode?.id === code.id ? "bg-sky-50/50" : "bg-white"}`}
                    >
                      <td className="px-3 py-2 font-semibold text-slate-900">{code.code}</td>
                      <td className="px-3 py-2">{code.label}</td>
                      <td className="px-3 py-2">{toNonNegative(code.default_paid_days_per_year)}</td>
                      <td className="px-3 py-2">
                        {code.carryover_enabled ? `Cap ${toNonNegative(code.carryover_cap_days)}` : "Disabled"}
                        {code.carryover_enabled && code.carryover_expiry_month && code.carryover_expiry_day
                          ? `, exp ${code.carryover_expiry_month}/${code.carryover_expiry_day}`
                          : ""}
                      </td>
                      <td className="px-3 py-2">
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                            code.is_active ? "bg-emerald-100 text-emerald-800" : "bg-slate-200 text-slate-700"
                          }`}
                        >
                          {code.is_active ? "Active" : "Inactive"}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        {canManage ? (
                          <div className="flex flex-wrap items-center gap-3 text-xs">
                            <Link
                              href={buildTimeOffPath({
                                year: selectedYear,
                                status: selectedStatus,
                                tab: "codes",
                                editCodeId: code.id,
                              })}
                              className="font-semibold text-slate-700 hover:underline"
                            >
                              Edit
                            </Link>
                            <form action={setCodeActiveAction}>
                              <input type="hidden" name="year" value={selectedYear} />
                              <input type="hidden" name="status" value={selectedStatus} />
                              <input type="hidden" name="tab" value={selectedTab} />
                              <input type="hidden" name="code_id" value={code.id} />
                              <input type="hidden" name="is_active" value={String(!code.is_active)} />
                              <button type="submit" className="font-semibold text-slate-700 hover:underline">
                                Mark {code.is_active ? "inactive" : "active"}
                              </button>
                            </form>
                          </div>
                        ) : null}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td className="px-3 py-3 text-slate-500" colSpan={6}>
                      No codes found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {canManage ? (
            <details className="rounded-lg border border-slate-200 bg-slate-50/70 p-3" open={Boolean(editingCode)}>
              <summary className="cursor-pointer text-sm font-semibold text-slate-700">
                {editingCode ? `Edit ${editingCode.label}` : "Add a code"}
              </summary>
              <form action={saveCodeAction} className="mt-3 grid gap-3 md:grid-cols-2">
                <input type="hidden" name="year" value={selectedYear} />
                <input type="hidden" name="status" value={selectedStatus} />
                <input type="hidden" name="tab" value={selectedTab} />
                <input type="hidden" name="code_id" value={editingCode?.id || ""} />
                <label className="text-sm text-slate-700">
                  Code
                  <input
                    name="code"
                    defaultValue={editingCode?.code || ""}
                    className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
                    required
                  />
                </label>
                <label className="text-sm text-slate-700">
                  Label
                  <input
                    name="label"
                    defaultValue={editingCode?.label || ""}
                    className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
                    required
                  />
                </label>
                <label className="text-sm text-slate-700">
                  Paid days per year
                  <input
                    type="number"
                    name="default_paid_days_per_year"
                    min={0}
                    defaultValue={toNonNegative(editingCode?.default_paid_days_per_year)}
                    className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
                    required
                  />
                </label>
                <label className="text-sm text-slate-700">
                  Sort order
                  <input
                    type="number"
                    name="sort_order"
                    defaultValue={editingCode?.sort_order ?? 0}
                    className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
                  />
                </label>
                <label className="text-sm text-slate-700">
                  Carryover cap days
                  <input
                    type="number"
                    name="carryover_cap_days"
                    min={0}
                    defaultValue={toNonNegative(editingCode?.carryover_cap_days)}
                    className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
                  />
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <label className="text-sm text-slate-700">
                    Expiry month
                    <input
                      type="number"
                      name="carryover_expiry_month"
                      min={1}
                      max={12}
                      defaultValue={editingCode?.carryover_expiry_month ?? ""}
                      placeholder="1-12"
                      className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
                    />
                  </label>
                  <label className="text-sm text-slate-700">
                    Expiry day
                    <input
                      type="number"
                      name="carryover_expiry_day"
                      min={1}
                      max={31}
                      defaultValue={editingCode?.carryover_expiry_day ?? ""}
                      placeholder="1-31"
                      className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
                    />
                  </label>
                </div>
                <div className="space-y-2 md:col-span-2">
                  <label className="inline-flex items-center gap-2 text-sm text-slate-700">
                    <input
                      type="checkbox"
                      name="carryover_enabled"
                      defaultChecked={Boolean(editingCode?.carryover_enabled)}
                    />
                    Carryover enabled
                  </label>
                  <label className="ml-4 inline-flex items-center gap-2 text-sm text-slate-700">
                    <input
                      type="checkbox"
                      name="is_active"
                      defaultChecked={editingCode ? editingCode.is_active : true}
                    />
                    Active
                  </label>
                </div>
                <div className="md:col-span-2">
                  <button
                    type="submit"
                    className="rounded-md border border-slate-900 bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-800"
                  >
                    {editingCode ? "Save code changes" : "Add code"}
                  </button>
                </div>
              </form>
            </details>
          ) : null}
        </section>
      ) : null}

      {selectedTab === "overrides" ? (
        <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-4 sm:p-5">
          <div>
            <h2 className="text-base font-semibold text-slate-900">Entitlement Overrides</h2>
            <p className="text-sm text-slate-600">Apply per-person paid-day overrides for a specific code.</p>
          </div>
          {canManage ? (
            <details className="rounded-lg border border-slate-200 bg-slate-50/70 p-3">
              <summary className="cursor-pointer text-sm font-semibold text-slate-700">Add override</summary>
              <form action={saveOverrideAction} className="mt-3 grid gap-3 md:grid-cols-4">
                <input type="hidden" name="year" value={selectedYear} />
                <input type="hidden" name="status" value={selectedStatus} />
                <input type="hidden" name="tab" value={selectedTab} />
                <label className="text-sm text-slate-700 md:col-span-2">
                  User
                  <select
                    name="user_id"
                    className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
                    required
                  >
                    <option value="">Select user</option>
                    {users.map((user) => (
                      <option key={user.id} value={user.id}>
                        {displayName(user)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-sm text-slate-700">
                  Code
                  <select
                    name="code_id"
                    className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
                    required
                  >
                    <option value="">Select code</option>
                    {codes.map((code) => (
                      <option key={code.id} value={code.id}>
                        {code.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-sm text-slate-700">
                  Annual paid days
                  <input
                    type="number"
                    min={0}
                    name="annual_paid_days"
                    defaultValue={0}
                    className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
                    required
                  />
                </label>
                <div className="md:col-span-4">
                  <button
                    type="submit"
                    className="rounded-md border border-slate-900 bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-800"
                  >
                    Save override
                  </button>
                </div>
              </form>
            </details>
          ) : null}

          <div className="overflow-x-auto rounded-md border border-slate-200">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-3 py-2">User</th>
                  <th className="px-3 py-2">Code</th>
                  <th className="px-3 py-2">Annual paid days</th>
                  <th className="px-3 py-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {overrides.length ? (
                  overrides.map((override) => (
                    <tr key={override.id} className="border-t border-slate-200">
                      <td className="px-3 py-2">{displayName(userById.get(override.user_id))}</td>
                      <td className="px-3 py-2">{codeById.get(override.code_id)?.label || "Unknown code"}</td>
                      <td className="px-3 py-2">{toNonNegative(override.annual_paid_days)}</td>
                      <td className="px-3 py-2">
                        {canManage ? (
                          <form action={deleteOverrideAction}>
                            <input type="hidden" name="year" value={selectedYear} />
                            <input type="hidden" name="status" value={selectedStatus} />
                            <input type="hidden" name="tab" value={selectedTab} />
                            <input type="hidden" name="user_id" value={override.user_id} />
                            <input type="hidden" name="code_id" value={override.code_id} />
                            <button type="submit" className="text-xs font-semibold text-red-700 hover:underline">
                              Remove
                            </button>
                          </form>
                        ) : (
                          <span className="text-xs text-slate-500">No actions</span>
                        )}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td className="px-3 py-3 text-slate-500" colSpan={4}>
                      No overrides yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {selectedTab === "requests" ? (
        <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-4 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-base font-semibold text-slate-900">Requests</h2>
              <p className="text-sm text-slate-600">Preview paid/unpaid split and approve pending requests.</p>
            </div>
          </div>

          {canManage ? (
            <details className="rounded-lg border border-slate-200 bg-slate-50/70 p-3">
              <summary className="cursor-pointer text-sm font-semibold text-slate-700">Create request</summary>
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                <form method="get" className="space-y-2">
                  <input type="hidden" name="year" value={selectedYear} />
                  <input type="hidden" name="status" value={selectedStatus} />
                  <input type="hidden" name="tab" value={selectedTab} />
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Preview request</p>
                  <label className="block text-xs text-slate-600">
                    User
                    <select
                      name="preview_user_id"
                      defaultValue={previewUserId}
                      className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm"
                      required
                    >
                      <option value="">Select user</option>
                      {users.map((user) => (
                        <option key={user.id} value={user.id}>
                          {displayName(user)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block text-xs text-slate-600">
                    Code
                    <select
                      name="preview_code_id"
                      defaultValue={previewCodeId}
                      className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm"
                      required
                    >
                      <option value="">Select code</option>
                      {codes.map((code) => (
                        <option key={code.id} value={code.id}>
                          {code.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    <label className="text-xs text-slate-600">
                      Start date
                      <input
                        type="date"
                        name="preview_start"
                        defaultValue={previewStart}
                        className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm"
                        required
                      />
                    </label>
                    <label className="text-xs text-slate-600">
                      End date
                      <input
                        type="date"
                        name="preview_end"
                        defaultValue={previewEnd}
                        className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm"
                        required
                      />
                    </label>
                  </div>
                  <button
                    type="submit"
                    className="rounded-md border border-slate-900 bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800"
                  >
                    Preview
                  </button>
                </form>

                <form action={createRequestAction} className="space-y-2">
                  <input type="hidden" name="year" value={selectedYear} />
                  <input type="hidden" name="status" value={selectedStatus} />
                  <input type="hidden" name="tab" value={selectedTab} />
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Create request</p>
                  <label className="block text-xs text-slate-600">
                    User
                    <select
                      name="target_user_id"
                      defaultValue={previewUserId}
                      className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm"
                      required
                    >
                      <option value="">Select user</option>
                      {users.map((user) => (
                        <option key={user.id} value={user.id}>
                          {displayName(user)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block text-xs text-slate-600">
                    Code
                    <select
                      name="code_id"
                      defaultValue={previewCodeId}
                      className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm"
                      required
                    >
                      <option value="">Select code</option>
                      {codes.map((code) => (
                        <option key={code.id} value={code.id}>
                          {code.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    <label className="text-xs text-slate-600">
                      Start date
                      <input
                        type="date"
                        name="start_date"
                        defaultValue={previewStart}
                        className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm"
                        required
                      />
                    </label>
                    <label className="text-xs text-slate-600">
                      End date
                      <input
                        type="date"
                        name="end_date"
                        defaultValue={previewEnd}
                        className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm"
                        required
                      />
                    </label>
                  </div>
                  <label className="block text-xs text-slate-600">
                    Note
                    <textarea
                      name="request_note"
                      rows={2}
                      className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm"
                      placeholder="Optional context"
                    />
                  </label>
                  <button
                    type="submit"
                    className="rounded-md border border-slate-900 bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800"
                  >
                    Submit request
                  </button>
                </form>
              </div>
            </details>
          ) : null}

          {previewError ? (
            <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{previewError}</p>
          ) : null}
          {previewResult ? (
            <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
              <p>
                Preview totals: {String(previewResult.total_days || 0)} day(s), {String(previewResult.paid_days || 0)}{" "}
                paid, {String(previewResult.unpaid_days || 0)} unpaid.
              </p>
            </div>
          ) : null}

          <div className="flex flex-wrap items-center gap-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Status filter</p>
            {[
              { value: "", label: "All" },
              { value: "pending", label: "Pending" },
              { value: "approved", label: "Approved" },
              { value: "rejected", label: "Rejected" },
            ].map((option) => (
              <Link
                key={option.value || "all"}
                href={buildTimeOffPath({
                  year: selectedYear,
                  status: option.value,
                  tab: selectedTab,
                  previewUserId,
                  previewCodeId,
                  previewStart,
                  previewEnd,
                })}
                className={`rounded-full px-3 py-1 text-xs font-semibold ${
                  selectedStatus === option.value
                    ? "bg-slate-900 text-white"
                    : "border border-slate-300 text-slate-700 hover:bg-slate-100"
                }`}
              >
                {option.label}
              </Link>
            ))}
          </div>

          <div className="overflow-x-auto rounded-md border border-slate-200">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-3 py-2">User</th>
                  <th className="px-3 py-2">Code</th>
                  <th className="px-3 py-2">Range</th>
                  <th className="px-3 py-2">Submitted</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Paid/Unpaid</th>
                  <th className="px-3 py-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredRequests.length ? (
                  filteredRequests.map((request) => (
                    <tr key={request.id} className="border-t border-slate-200">
                      <td className="px-3 py-2">{displayName(userById.get(request.target_user_id))}</td>
                      <td className="px-3 py-2">{codeById.get(request.code_id)?.label || "Unknown code"}</td>
                      <td className="px-3 py-2">
                        {formatDateOnly(request.start_date)} to {formatDateOnly(request.end_date)}
                      </td>
                      <td className="px-3 py-2 text-xs text-slate-600">{formatDateTime(request.submitted_at)}</td>
                      <td className="px-3 py-2">
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs font-semibold capitalize ${
                            request.status === "approved"
                              ? "bg-emerald-100 text-emerald-800"
                              : request.status === "rejected"
                              ? "bg-red-100 text-red-800"
                              : "bg-amber-100 text-amber-800"
                          }`}
                        >
                          {request.status}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        {toNonNegative(request.approved_paid_days)} / {toNonNegative(request.approved_unpaid_days)}
                      </td>
                      <td className="px-3 py-2">
                        {canManage && request.status === "pending" ? (
                          <div className="flex flex-wrap items-center gap-3">
                            <form action={decideRequestAction}>
                              <input type="hidden" name="year" value={selectedYear} />
                              <input type="hidden" name="status" value={selectedStatus} />
                              <input type="hidden" name="tab" value={selectedTab} />
                              <input type="hidden" name="request_id" value={request.id} />
                              <input type="hidden" name="decision" value="approved" />
                              <button type="submit" className="text-xs font-semibold text-emerald-700 hover:underline">
                                Approve
                              </button>
                            </form>
                            <form action={decideRequestAction}>
                              <input type="hidden" name="year" value={selectedYear} />
                              <input type="hidden" name="status" value={selectedStatus} />
                              <input type="hidden" name="tab" value={selectedTab} />
                              <input type="hidden" name="request_id" value={request.id} />
                              <input type="hidden" name="decision" value="rejected" />
                              <button type="submit" className="text-xs font-semibold text-red-700 hover:underline">
                                Reject
                              </button>
                            </form>
                          </div>
                        ) : (
                          <span className="text-xs text-slate-500">No actions</span>
                        )}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td className="px-3 py-3 text-slate-500" colSpan={7}>
                      No requests for this filter.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {selectedTab === "balances" ? (
        <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-4 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-base font-semibold text-slate-900">Balances</h2>
              <p className="text-sm text-slate-600">Track entitlement, carryover, and paid/unpaid usage by year.</p>
            </div>
            <form method="get" className="inline-flex items-center gap-2 rounded-md border border-slate-200 bg-slate-50/70 p-2">
              <input type="hidden" name="status" value={selectedStatus} />
              <input type="hidden" name="tab" value={selectedTab} />
              <input type="hidden" name="preview_user_id" value={previewUserId} />
              <input type="hidden" name="preview_code_id" value={previewCodeId} />
              <input type="hidden" name="preview_start" value={previewStart} />
              <input type="hidden" name="preview_end" value={previewEnd} />
              <label className="text-xs text-slate-600">
                Year
                <input
                  type="number"
                  name="year"
                  min={2000}
                  max={2200}
                  defaultValue={selectedYear}
                  className="ml-1 w-24 rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm"
                />
              </label>
              <button
                type="submit"
                className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100"
              >
                Apply
              </button>
            </form>
          </div>
          <div className="overflow-x-auto rounded-md border border-slate-200">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-3 py-2">User</th>
                  <th className="px-3 py-2">Code</th>
                  <th className="px-3 py-2">Entitlement</th>
                  <th className="px-3 py-2">Carryover</th>
                  <th className="px-3 py-2">Used paid</th>
                  <th className="px-3 py-2">Used unpaid</th>
                  <th className="px-3 py-2">Remaining paid</th>
                </tr>
              </thead>
              <tbody>
                {balances.length ? (
                  balances.map((balance) => (
                    <tr key={`${balance.target_user_id}-${balance.code_id}-${balance.leave_year}`} className="border-t border-slate-200">
                      <td className="px-3 py-2">{balance.target_user_name}</td>
                      <td className="px-3 py-2">{balance.label}</td>
                      <td className="px-3 py-2">{toNonNegative(balance.entitlement_days)}</td>
                      <td className="px-3 py-2">{toNonNegative(balance.carryover_pool_days)}</td>
                      <td className="px-3 py-2">{toNonNegative(balance.used_paid_days)}</td>
                      <td className="px-3 py-2">{toNonNegative(balance.used_unpaid_days)}</td>
                      <td className="px-3 py-2 font-semibold text-slate-900">{toNonNegative(balance.remaining_paid_days)}</td>
                    </tr>
                  ))
                ) : (
                  <tr><td className="px-3 py-3 text-slate-500" colSpan={7}>No balance rows found for {selectedYear}.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </div>
  );
}
