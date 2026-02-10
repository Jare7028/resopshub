export type DueUrgency = "none" | "overdue" | "soon" | "ok";

function normalizeTime(value: string | null | undefined) {
  if (!value) return "";
  const trimmed = value.trim();
  if (!trimmed) return "";
  // Supabase `time` may arrive as `HH:MM:SS` - keep `HH:MM`.
  if (/^\d{2}:\d{2}:\d{2}$/.test(trimmed)) return trimmed.slice(0, 5);
  if (/^\d{2}:\d{2}$/.test(trimmed)) return trimmed;
  return "";
}

export function toLocalDueDateTime(
  dueDate: string | null | undefined,
  dueTime: string | null | undefined
) {
  const date = String(dueDate || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const time = normalizeTime(dueTime) || "23:59";
  const parsed = new Date(`${date}T${time}:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function getDueUrgency(
  dueDate: string | null | undefined,
  dueTime?: string | null | undefined
): DueUrgency {
  const dueAt = toLocalDueDateTime(dueDate, dueTime);
  if (!dueAt) return "none";

  const now = new Date();
  const diffMs = dueAt.getTime() - now.getTime();
  if (diffMs < 0) return "overdue";
  if (diffMs <= 24 * 60 * 60 * 1000) return "soon";
  return "ok";
}

export function duePillClasses(urgency: DueUrgency) {
  if (urgency === "overdue") {
    return "border-rose-200 bg-rose-50 text-rose-800";
  }
  if (urgency === "soon") {
    return "border-amber-200 bg-amber-50 text-amber-800";
  }
  if (urgency === "ok") {
    return "border-emerald-200 bg-emerald-50 text-emerald-800";
  }
  return "border-slate-200 bg-slate-50 text-slate-600";
}

export function dueInputClasses(urgency: DueUrgency) {
  if (urgency === "overdue") {
    return "border-rose-300 bg-rose-50 text-rose-900";
  }
  if (urgency === "soon") {
    return "border-amber-300 bg-amber-50 text-amber-900";
  }
  if (urgency === "ok") {
    return "border-emerald-300 bg-emerald-50 text-emerald-900";
  }
  return "border-slate-300 bg-white text-slate-700";
}

export function priorityPillClasses(priority: string | null | undefined) {
  const value = String(priority || "").trim().toLowerCase();
  if (value === "low") return "border-emerald-200 bg-emerald-50 text-emerald-800";
  if (value === "medium") return "border-lime-200 bg-lime-50 text-lime-800";
  if (value === "high") return "border-amber-200 bg-amber-50 text-amber-800";
  if (value === "critical") return "border-rose-200 bg-rose-50 text-rose-800";
  return "border-slate-200 bg-slate-50 text-slate-600";
}

export function prioritySelectClasses(priority: string | null | undefined) {
  const value = String(priority || "").trim().toLowerCase();
  if (value === "low") return "border-emerald-300 bg-emerald-50 text-emerald-900";
  if (value === "medium") return "border-lime-300 bg-lime-50 text-lime-900";
  if (value === "high") return "border-amber-300 bg-amber-50 text-amber-900";
  if (value === "critical") return "border-rose-300 bg-rose-50 text-rose-900";
  return "border-slate-300 bg-white text-slate-700";
}

export function statusPillClasses(status: string | null | undefined) {
  const value = String(status || "").trim().toLowerCase();
  if (value === "to_do" || value === "backlog") return "border-slate-200 bg-slate-50 text-slate-700";
  if (value === "in_progress") return "border-blue-200 bg-blue-50 text-blue-800";
  if (value === "blocked") return "border-amber-200 bg-amber-50 text-amber-900";
  if (value === "completed") return "border-emerald-200 bg-emerald-50 text-emerald-800";
  if (value === "cancelled") return "border-rose-200 bg-rose-50 text-rose-800";
  return "border-slate-200 bg-slate-50 text-slate-600";
}

export function statusSelectClasses(status: string | null | undefined) {
  const value = String(status || "").trim().toLowerCase();
  if (value === "to_do" || value === "backlog") return "border-slate-300 bg-slate-50 text-slate-900";
  if (value === "in_progress") return "border-blue-300 bg-blue-50 text-blue-900";
  if (value === "blocked") return "border-amber-300 bg-amber-50 text-amber-900";
  if (value === "completed") return "border-emerald-300 bg-emerald-50 text-emerald-900";
  if (value === "cancelled") return "border-rose-300 bg-rose-50 text-rose-900";
  return "border-slate-300 bg-white text-slate-700";
}
