import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const dateRegex = /^\d{4}-\d{2}-\d{2}$/;

type RepositionMode = "move" | "copy";

type RepositionRequestBody = {
  shift_id?: unknown;
  target_local_date?: unknown;
  mode?: unknown;
  target_roster_entry_id?: unknown;
  target_is_open?: unknown;
};

type ShiftRow = {
  id: string;
  week_id: string;
  client_id: string;
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

function normalizeMode(value: unknown): RepositionMode | null {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  if (normalized === "copy") return "copy";
  if (normalized === "move") return "move";
  return null;
}

export async function POST(request: Request) {
  try {
    const supabase = createSupabaseServerClient();
    const { data: authData } = await supabase.auth.getUser();
    if (!authData.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await request.json().catch(() => null)) as RepositionRequestBody | null;
    if (!body) {
      return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
    }

    const shiftId = String(body.shift_id || "").trim();
    const targetLocalDate = String(body.target_local_date || "").trim();
    const mode = normalizeMode(body.mode);
    const targetIsOpen = Boolean(body.target_is_open);
    const targetRosterEntryIdRaw = String(body.target_roster_entry_id || "").trim();
    const targetRosterEntryId = targetIsOpen ? "" : targetRosterEntryIdRaw;

    if (!uuidRegex.test(shiftId)) {
      return NextResponse.json({ error: "Invalid shift_id" }, { status: 400 });
    }
    if (!dateRegex.test(targetLocalDate)) {
      return NextResponse.json({ error: "Invalid target_local_date" }, { status: 400 });
    }
    if (!mode) {
      return NextResponse.json({ error: "Invalid mode" }, { status: 400 });
    }
    if (!targetIsOpen && !uuidRegex.test(targetRosterEntryId)) {
      return NextResponse.json(
        { error: "target_roster_entry_id is required for assigned shifts" },
        { status: 400 }
      );
    }

    const { data: sourceShiftData, error: sourceShiftError } = await supabase
      .from("schedule_shifts")
      .select(
        "id,week_id,client_id,roster_entry_id,is_open,local_date,start_local_time,end_local_time,ends_next_day,break_minutes,job_code_id,notes"
      )
      .eq("id", shiftId)
      .maybeSingle();

    if (sourceShiftError) {
      return NextResponse.json({ error: sourceShiftError.message }, { status: 400 });
    }

    if (!sourceShiftData) {
      return NextResponse.json({ error: "Shift not found" }, { status: 404 });
    }
    const sourceShift = sourceShiftData as ShiftRow;

    const { data: canEditData, error: canEditError } = await supabase.rpc("schedule_can_edit_client", {
      client_uuid: sourceShift.client_id,
    });
    if (canEditError) {
      return NextResponse.json({ error: canEditError.message }, { status: 400 });
    }
    if (!canEditData) {
      return NextResponse.json({ error: "Not authorized to edit this schedule" }, { status: 403 });
    }

    if (!targetIsOpen) {
      const { data: rosterEntryData, error: rosterEntryError } = await supabase
        .from("schedule_roster_entries")
        .select("id,client_id")
        .eq("id", targetRosterEntryId)
        .maybeSingle();

      if (rosterEntryError) {
        return NextResponse.json({ error: rosterEntryError.message }, { status: 400 });
      }

      if (!rosterEntryData || rosterEntryData.client_id !== sourceShift.client_id) {
        return NextResponse.json({ error: "Invalid destination roster row" }, { status: 400 });
      }
    }

    const { data: shiftedId, error: upsertError } = await supabase.rpc("schedule_upsert_shift", {
      p_week_id: sourceShift.week_id,
      p_shift_id: mode === "move" ? sourceShift.id : null,
      p_roster_entry_id: targetIsOpen ? null : targetRosterEntryId,
      p_is_open: targetIsOpen,
      p_local_date: targetLocalDate,
      p_start_local_time: sourceShift.start_local_time,
      p_end_local_time: sourceShift.end_local_time,
      p_ends_next_day: sourceShift.ends_next_day,
      p_break_minutes: Number(sourceShift.break_minutes || 0),
      p_job_code_id: sourceShift.job_code_id,
      p_notes: sourceShift.notes,
    });

    if (upsertError) {
      return NextResponse.json({ error: upsertError.message }, { status: 400 });
    }

    return NextResponse.json({
      ok: true,
      action: mode,
      shift_id: shiftedId || sourceShift.id,
    });
  } catch {
    return NextResponse.json({ error: "Unable to update shift" }, { status: 500 });
  }
}

