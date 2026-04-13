import "server-only";

import { createSupabaseServerClient } from "@/lib/supabase/server";

export const SCOUT_STATUSES = ["active", "watchlist", "contacted", "ignore"] as const;

export type ScoutStatus = (typeof SCOUT_STATUSES)[number];

export type ScoutJob = {
  id: string;
  external_job_key: string | null;
  company_name: string;
  role_title: string;
  location_text: string | null;
  employment_type: string | null;
  compensation_text: string | null;
  source_name: string | null;
  source_url: string | null;
  role_summary: string | null;
  status: ScoutStatus;
  ignore_reason: string | null;
  ignored_at: string | null;
  contacted_at: string | null;
  first_seen_at: string;
  status_updated_at: string;
  created_at: string;
  updated_at: string;
};

export function normalizeScoutStatus(value?: string | null): ScoutStatus | null {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return null;
  return SCOUT_STATUSES.includes(normalized as ScoutStatus)
    ? (normalized as ScoutStatus)
    : null;
}

export async function listScoutJobs(filters?: { query?: string; status?: string | null }) {
  const supabase = createSupabaseServerClient();
  const query = String(filters?.query || "").trim();
  const status = normalizeScoutStatus(filters?.status);

  let request = supabase
    .from("role_scout_jobs")
    .select(
      "id,external_job_key,company_name,role_title,location_text,employment_type,compensation_text,source_name,source_url,role_summary,status,ignore_reason,ignored_at,contacted_at,first_seen_at,status_updated_at,created_at,updated_at"
    )
    .order("status_updated_at", { ascending: false });

  if (query) {
    request = request.or(
      [
        `company_name.ilike.%${query}%`,
        `role_title.ilike.%${query}%`,
        `location_text.ilike.%${query}%`,
        `source_name.ilike.%${query}%`,
      ].join(",")
    );
  }

  if (status) {
    request = request.eq("status", status);
  }

  const { data, error } = await request;

  if (error) {
    throw error;
  }

  return (data || []) as ScoutJob[];
}
