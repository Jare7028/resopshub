import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type WeekRow = {
  id: string;
  client_id: string;
  week_start_date: string;
  status: "draft" | "published";
};

type ShiftRow = {
  id: string;
  roster_entry_id: string | null;
  is_open: boolean;
  local_date: string;
  start_local_time: string;
  end_local_time: string;
  ends_next_day: boolean;
  break_minutes: number;
  job_code_id: string | null;
  notes: string | null;
  updated_at: string;
};

type RosterRow = {
  id: string;
  display_name: string;
  email: string | null;
  role_label: string;
};

type JobCodeRow = {
  id: string;
  code: string;
  label: string;
};

function csvEscape(value: unknown) {
  const text = String(value ?? "");
  if (!/["\n,\r]/.test(text)) return text;
  return `"${text.replace(/"/g, "\"\"")}"`;
}

function workedMinutes(shift: ShiftRow) {
  const parseMinutes = (text: string) => {
    const match = String(text || "").match(/^(\d{2}):(\d{2})/);
    if (!match) return 0;
    return Number(match[1]) * 60 + Number(match[2]);
  };
  const start = parseMinutes(shift.start_local_time);
  let end = parseMinutes(shift.end_local_time);
  if (shift.ends_next_day || end <= start) end += 24 * 60;
  return Math.max(0, end - start - Math.max(0, Number(shift.break_minutes || 0)));
}

function mondayForDateText(value: string | null | undefined) {
  const text = String(value || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return "";
  const date = new Date(`${text}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return "";
  const weekday = date.getUTCDay();
  const offset = weekday === 0 ? 6 : weekday - 1;
  date.setUTCDate(date.getUTCDate() - offset);
  return date.toISOString().slice(0, 10);
}

export async function GET(
  request: Request,
  context: { params: Promise<{ clientId: string }> }
) {
  const { clientId } = await context.params;
  if (!uuidRegex.test(String(clientId || "").trim())) {
    return NextResponse.json({ error: "Invalid client id" }, { status: 400 });
  }

  const requestUrl = new URL(request.url);
  const weekStart = mondayForDateText(requestUrl.searchParams.get("week"));
  if (!weekStart) {
    return NextResponse.json({ error: "Invalid week date" }, { status: 400 });
  }

  const supabase = createSupabaseServerClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: clientData } = await supabase
    .from("clients")
    .select("id,name")
    .eq("id", clientId)
    .maybeSingle();
  if (!clientData) {
    return NextResponse.json({ error: "Client not found" }, { status: 404 });
  }

  const { data: weekData } = await supabase
    .from("schedule_weeks")
    .select("id,client_id,week_start_date,status")
    .eq("client_id", clientId)
    .eq("week_start_date", weekStart)
    .maybeSingle();
  if (!weekData) {
    return NextResponse.json({ error: "Week not found or not accessible" }, { status: 404 });
  }
  const week = weekData as WeekRow;

  const [{ data: shiftsData }, { data: rosterData }, { data: codesData }] = await Promise.all([
    supabase
      .from("schedule_shifts")
      .select(
        "id,roster_entry_id,is_open,local_date,start_local_time,end_local_time,ends_next_day,break_minutes,job_code_id,notes,updated_at"
      )
      .eq("week_id", week.id)
      .order("local_date", { ascending: true })
      .order("start_local_time", { ascending: true }),
    supabase
      .from("schedule_roster_entries")
      .select("id,display_name,email,role_label")
      .eq("client_id", clientId),
    supabase.from("schedule_job_codes").select("id,code,label"),
  ]);

  const shifts = (shiftsData || []) as ShiftRow[];
  const rosterRows = (rosterData || []) as RosterRow[];
  const codeRows = (codesData || []) as JobCodeRow[];
  const rosterById = new Map(rosterRows.map((row) => [row.id, row]));
  const codeById = new Map(codeRows.map((row) => [row.id, row]));

  const headers = [
    "client",
    "week_start",
    "status",
    "date",
    "assignee_name",
    "assignee_email",
    "role",
    "open_shift",
    "start_time",
    "end_time",
    "ends_next_day",
    "break_minutes",
    "payable_minutes",
    "job_code",
    "job_label",
    "notes",
    "updated_at",
  ];

  const rows = shifts.map((shift) => {
    const roster = shift.roster_entry_id ? rosterById.get(shift.roster_entry_id) : null;
    const code = shift.job_code_id ? codeById.get(shift.job_code_id) : null;
    return [
      clientData.name,
      week.week_start_date,
      week.status,
      shift.local_date,
      roster?.display_name || "",
      roster?.email || "",
      roster?.role_label || "",
      shift.is_open ? "yes" : "no",
      shift.start_local_time,
      shift.end_local_time,
      shift.ends_next_day ? "yes" : "no",
      String(shift.break_minutes || 0),
      String(workedMinutes(shift)),
      code?.code || "",
      code?.label || "",
      shift.notes || "",
      shift.updated_at,
    ];
  });

  const csvLines = [headers, ...rows].map((row) => row.map(csvEscape).join(",")).join("\r\n");
  const body = `\uFEFF${csvLines}`;
  const filename = `schedule-${clientId}-${weekStart}.csv`;

  return new NextResponse(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename=\"${filename}\"`,
      "Cache-Control": "no-store",
      Pragma: "no-cache",
      Expires: "0",
      Vary: "Cookie",
    },
  });
}
