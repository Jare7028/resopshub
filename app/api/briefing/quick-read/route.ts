import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/api/requireApiUser";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  isSupabaseMissingColumnError,
  isSupabaseMissingTableError,
} from "@/lib/supabaseErrors";
import {
  buildHiddenStatusValues,
  buildStatusOptionsWithMetadata,
  normalizeStatusValue,
  type StatusOptionRow,
} from "@/lib/statusOptions";
import { LOGIN_QUICK_READ_COOKIE } from "@/lib/loginQuickRead";
import { fetchLoginQuickReadTaskRows } from "@/lib/loginQuickReadTaskRows";
import {
  getLoginQuickReadTaskDueDateCutoff,
  summarizeLoginQuickReadTasks,
} from "@/lib/loginQuickReadSummary";

type MentionSummaryRow = {
  id: string;
  title: string | null;
  body: string | null;
  created_at: string;
  metadata: Record<string, unknown> | null;
};

function clearLoginQuickReadCookie(response: NextResponse) {
  response.cookies.set({
    name: LOGIN_QUICK_READ_COOKIE,
    value: "",
    path: "/",
    maxAge: 0,
    httpOnly: true,
    sameSite: "lax",
  });
}

function extractSourceUrl(metadata: Record<string, unknown> | null | undefined) {
  if (!metadata || typeof metadata !== "object") return null;
  const value = metadata.source_url;
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.startsWith("/") ? normalized : null;
}

export async function GET() {
  const supabase = createSupabaseServerClient();
  const auth = await requireApiUser(supabase, "quick-read.auth");
  if (!auth.user) {
    clearLoginQuickReadCookie(auth.response);
    return auth.response;
  }
  const user = auth.user;

  const now = new Date();
  const taskDueDateCutoff = getLoginQuickReadTaskDueDateCutoff(now);

  let taskStatusRows: StatusOptionRow[] = [];
  const taskStatusResult = await supabase
    .from("status_options")
    .select("entity_type,value,position,is_visible,counts_as_completed,color_hex")
    .eq("entity_type", "task")
    .order("position", { ascending: true })
    .order("value", { ascending: true });

  if (!taskStatusResult.error) {
    taskStatusRows = (taskStatusResult.data || []) as StatusOptionRow[];
  } else if (isSupabaseMissingColumnError(taskStatusResult.error)) {
    const legacyStatusResult = await supabase
      .from("status_options")
      .select("entity_type,value,position")
      .eq("entity_type", "task")
      .order("position", { ascending: true })
      .order("value", { ascending: true });
    if (!legacyStatusResult.error) {
      taskStatusRows = (legacyStatusResult.data || []) as StatusOptionRow[];
    }
  } else if (!isSupabaseMissingTableError(taskStatusResult.error)) {
    console.error("[quickRead.status_options]", taskStatusResult.error.message);
  }

  const hiddenTaskStatusSet = new Set(
    buildHiddenStatusValues(
      "task",
      buildStatusOptionsWithMetadata("task", taskStatusRows, [])
    ).map((status) => normalizeStatusValue(status))
  );

  const { taskRows } = await fetchLoginQuickReadTaskRows({
    supabase,
    userId: user.id,
    dueDateCutoff: taskDueDateCutoff,
    logError: (label, message) => console.error(label, message),
  });

  const { overdueItems, dueSoonItems } = summarizeLoginQuickReadTasks({
    taskRows,
    hiddenTaskStatusSet,
    now,
  });

  const mentionsResult = await supabase
    .from("notifications")
    .select("id,title,body,created_at,metadata", { count: "exact" })
    .eq("user_id", user.id)
    .eq("type", "user_mentioned")
    .is("read_at", null)
    .order("created_at", { ascending: false })
    .limit(8);

  let mentionRows: MentionSummaryRow[] = [];
  let mentionCount = 0;
  if (!mentionsResult.error) {
    mentionRows = (mentionsResult.data || []) as MentionSummaryRow[];
    mentionCount = Number(mentionsResult.count || 0);
  } else if (!isSupabaseMissingTableError(mentionsResult.error)) {
    console.error("[quickRead.mentions]", mentionsResult.error.message);
  }

  const payload = {
    generatedAt: new Date().toISOString(),
    overdue: {
      count: overdueItems.length,
      items: overdueItems.slice(0, 5).map((item) => ({
        id: item.id,
        title: item.title,
        dueDate: item.dueDate,
        dueTime: item.dueTime,
        dueAt: item.dueAt,
        url: item.url,
      })),
    },
    dueSoon: {
      count: dueSoonItems.length,
      items: dueSoonItems.slice(0, 5).map((item) => ({
        id: item.id,
        title: item.title,
        dueDate: item.dueDate,
        dueTime: item.dueTime,
        dueAt: item.dueAt,
        url: item.url,
      })),
    },
    mentions: {
      count: mentionCount,
      items: mentionRows.slice(0, 5).map((row) => ({
        id: row.id,
        title: String(row.title || "Mentioned").trim() || "Mentioned",
        body: row.body,
        createdAt: row.created_at,
        url: extractSourceUrl(row.metadata),
      })),
    },
  };

  const response = NextResponse.json(payload, { status: 200 });
  clearLoginQuickReadCookie(response);
  return response;
}
