"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentRequestUser } from "@/lib/supabase/currentUser";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { SCOUT_STATUSES, type ScoutStatus } from "@/lib/scout";

function buildScoutUrl(args?: { code?: string; detail?: string }) {
  const sp = new URLSearchParams();
  if (args?.code) sp.set("scout", args.code);
  if (args?.detail) sp.set("detail", args.detail);
  const qs = sp.toString();
  return qs ? `/scout?${qs}` : "/scout";
}

function normalizeStatus(value: FormDataEntryValue | null): ScoutStatus {
  const normalized = String(value || "").trim().toLowerCase();
  if (!SCOUT_STATUSES.includes(normalized as ScoutStatus)) {
    redirect(buildScoutUrl({ code: "invalid-status" }));
  }
  return normalized as ScoutStatus;
}

async function requireUserId() {
  const supabase = createSupabaseServerClient();
  const user = await getCurrentRequestUser(supabase, "scout.action.auth");

  if (!user) {
    redirect("/login");
  }

  return { supabase, userId: user.id };
}

export async function createScoutJobAction(formData: FormData) {
  const { supabase, userId } = await requireUserId();
  const companyName = String(formData.get("companyName") || "").trim();
  const roleTitle = String(formData.get("roleTitle") || "").trim();
  const locationText = String(formData.get("locationText") || "").trim() || null;
  const employmentType = String(formData.get("employmentType") || "").trim() || null;
  const compensationText = String(formData.get("compensationText") || "").trim() || null;
  const sourceName = String(formData.get("sourceName") || "").trim() || null;
  const sourceUrl = String(formData.get("sourceUrl") || "").trim() || null;
  const roleSummary = String(formData.get("roleSummary") || "").trim() || null;
  const externalJobKey = String(formData.get("externalJobKey") || "").trim() || null;

  if (!companyName || !roleTitle) {
    redirect(buildScoutUrl({ code: "missing-fields" }));
  }

  const { error } = await supabase.from("role_scout_jobs").insert({
    external_job_key: externalJobKey,
    company_name: companyName,
    role_title: roleTitle,
    location_text: locationText,
    employment_type: employmentType,
    compensation_text: compensationText,
    source_name: sourceName,
    source_url: sourceUrl,
    role_summary: roleSummary,
    created_by_user_id: userId,
    updated_by_user_id: userId,
  });

  if (error) {
    redirect(buildScoutUrl({ code: "create-failed", detail: error.message }));
  }

  revalidatePath("/scout");
  redirect(buildScoutUrl({ code: "created" }));
}

export async function updateScoutJobStatusAction(formData: FormData) {
  const { supabase, userId } = await requireUserId();
  const jobId = String(formData.get("jobId") || "").trim();
  const nextStatus = normalizeStatus(formData.get("status"));
  const ignoreReason = String(formData.get("ignoreReason") || "").trim() || null;

  if (!jobId) {
    redirect(buildScoutUrl({ code: "missing-job" }));
  }

  if (nextStatus === "ignore" && !ignoreReason) {
    redirect(buildScoutUrl({ code: "ignore-reason-required" }));
  }

  const { data: existing, error: existingError } = await supabase
    .from("role_scout_jobs")
    .select("id,status,ignore_reason")
    .eq("id", jobId)
    .maybeSingle();

  if (existingError || !existing) {
    redirect(
      buildScoutUrl({
        code: "missing-job",
        detail: existingError?.message || "Job not found.",
      })
    );
  }

  const timestamp = new Date().toISOString();
  const updates = {
    status: nextStatus,
    ignore_reason: nextStatus === "ignore" ? ignoreReason : null,
    ignored_at: nextStatus === "ignore" ? timestamp : null,
    contacted_at: nextStatus === "contacted" ? timestamp : null,
    status_updated_at: timestamp,
    updated_by_user_id: userId,
  };

  const { error: updateError } = await supabase
    .from("role_scout_jobs")
    .update(updates)
    .eq("id", jobId);

  if (updateError) {
    redirect(buildScoutUrl({ code: "update-failed", detail: updateError.message }));
  }

  if (
    existing.status !== nextStatus ||
    String(existing.ignore_reason || "") !== String(updates.ignore_reason || "")
  ) {
    const { error: historyError } = await supabase
      .from("role_scout_job_status_history")
      .insert({
        job_id: jobId,
        previous_status: existing.status,
        next_status: nextStatus,
        ignore_reason: updates.ignore_reason,
        changed_by_user_id: userId,
      });

    if (historyError) {
      redirect(buildScoutUrl({ code: "history-failed", detail: historyError.message }));
    }
  }

  revalidatePath("/scout");
  redirect(buildScoutUrl({ code: "updated" }));
}
