import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  buildFieldKey,
  formatFormLabel,
  normalizeFormFieldType,
  type FormFieldType,
} from "../../types";
import {
  formatSubmissionValue,
  type SubmissionTableField,
} from "../../formSubmissionTableUtils";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const EM_DASH = "\u2014";

type SubmissionScope = "completed" | "open" | "all";
type SubmissionSortKey = "created_at" | "status" | "submitted_by";
type SubmissionSortDir = "asc" | "desc";

type SubmissionRow = {
  id: string;
  status: string | null;
  submitted_by: string | null;
  created_at: string;
  values_json: Record<string, unknown> | null;
};

type UserRow = {
  id: string;
  full_name: string | null;
  email: string | null;
};

function normalizeSubmissionScope(value: string | null): SubmissionScope {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  if (normalized === "completed" || normalized === "open") return normalized;
  return "all";
}

function normalizeSubmissionSortKey(value: string | null): SubmissionSortKey {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  if (normalized === "status" || normalized === "submitted_by") return normalized;
  return "created_at";
}

function normalizeSubmissionSortDir(value: string | null): SubmissionSortDir {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  if (normalized === "asc") return "asc";
  return "desc";
}

function csvEscape(value: unknown) {
  const text = String(value ?? "");
  if (!/["\n,\r]/.test(text)) return text;
  return `"${text.replace(/"/g, "\"\"")}"`;
}

function buildUniqueKey(base: string, used: Set<string>) {
  let candidate = base || "field";
  let suffix = 2;
  while (used.has(candidate)) {
    candidate = `${base}_${suffix}`;
    suffix += 1;
  }
  used.add(candidate);
  return candidate;
}

function parseQuestionColumns(rawFields: unknown): SubmissionTableField[] {
  if (!Array.isArray(rawFields)) return [];

  const usedKeys = new Set<string>();
  const columns: SubmissionTableField[] = [];

  rawFields.forEach((item, index) => {
    if (!item || typeof item !== "object") return;
    const row = item as Record<string, unknown>;
    const baseKey = buildFieldKey(String(row.key || ""), `field_${index + 1}`);
    const key = buildUniqueKey(baseKey, usedKeys);
    const label = String(row.label || formatFormLabel(key)).trim() || formatFormLabel(key);
    const type = normalizeFormFieldType(String(row.type || "text")) as FormFieldType;
    columns.push({
      key,
      label,
      type,
    });
  });

  return columns;
}

function normalizeSubmissionValueForCsv(field: SubmissionTableField, valuesJson: unknown) {
  const formatted = formatSubmissionValue(field, valuesJson);
  return formatted === EM_DASH ? "" : formatted;
}

function buildCsvFilename(formTitle: string) {
  const slug =
    String(formTitle || "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "form";
  const dateStamp = new Date().toISOString().slice(0, 10);
  return `${slug}-submissions-${dateStamp}.csv`;
}

function normalizeCreatedAtForCsv(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toISOString();
}

export async function GET(
  request: Request,
  context: { params: Promise<{ formId: string }> }
) {
  const { formId } = await context.params;

  const requestUrl = new URL(request.url);
  const submissionScope = normalizeSubmissionScope(requestUrl.searchParams.get("scope"));
  const submissionSortKey = normalizeSubmissionSortKey(requestUrl.searchParams.get("sort"));
  const submissionSortDir = normalizeSubmissionSortDir(requestUrl.searchParams.get("dir"));

  const supabase = createSupabaseServerClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: currentUser } = await supabase
    .from("users")
    .select("id")
    .eq("email", authData.user.email)
    .maybeSingle();
  if (!currentUser?.id) {
    return NextResponse.json({ error: "Missing user profile" }, { status: 400 });
  }

  const { data: form, error: formError } = await supabase
    .from("forms")
    .select("id,title,fields")
    .eq("id", formId)
    .maybeSingle();
  if (formError) {
    return NextResponse.json({ error: formError.message }, { status: 500 });
  }
  if (!form) {
    return NextResponse.json({ error: "Form not found" }, { status: 404 });
  }

  const { data: submissionsRaw, error: submissionsError } = await supabase
    .from("form_submissions")
    .select("id,status,submitted_by,created_at,values_json")
    .eq("form_id", formId)
    .order("created_at", { ascending: false });
  if (submissionsError) {
    return NextResponse.json({ error: submissionsError.message }, { status: 500 });
  }

  const questionColumns = parseQuestionColumns(form.fields);
  const submissions = (submissionsRaw || []) as SubmissionRow[];

  const submissionUserIds = Array.from(
    new Set(submissions.map((submission) => submission.submitted_by).filter(Boolean))
  ) as string[];
  const { data: usersRaw } = submissionUserIds.length
    ? await supabase.from("users").select("id,full_name,email").in("id", submissionUserIds)
    : {
        data: [] as UserRow[],
      };
  const userMap = new Map<string, string>();
  (usersRaw || []).forEach((user) => {
    userMap.set(user.id, user.full_name || user.email || "Unknown user");
  });

  const filteredSubmissions = submissions.filter((submission) => {
    const status = String(submission.status || "open");
    if (submissionScope === "all") return true;
    if (submissionScope === "open") {
      return status !== "completed" && status !== "rejected";
    }
    return status === "completed";
  });

  const sortedSubmissions = [...filteredSubmissions].sort((a, b) => {
    if (submissionSortKey === "status") {
      const result = String(a.status || "open").localeCompare(String(b.status || "open"));
      return submissionSortDir === "asc" ? result : -result;
    }
    if (submissionSortKey === "submitted_by") {
      const aLabel = (userMap.get(a.submitted_by || "") || "").toLowerCase();
      const bLabel = (userMap.get(b.submitted_by || "") || "").toLowerCase();
      const result = aLabel.localeCompare(bLabel);
      return submissionSortDir === "asc" ? result : -result;
    }
    const result = a.created_at.localeCompare(b.created_at);
    return submissionSortDir === "asc" ? result : -result;
  });

  const headers = [
    "Submission",
    ...questionColumns.map((column) => column.label),
    "Status",
    "Submitted by",
    "Created",
  ];

  const rows = sortedSubmissions.map((submission) => [
    submission.id,
    ...questionColumns.map((column) =>
      normalizeSubmissionValueForCsv(column, submission.values_json)
    ),
    formatFormLabel(String(submission.status || "open")),
    userMap.get(submission.submitted_by || "") || "Unknown user",
    normalizeCreatedAtForCsv(submission.created_at),
  ]);

  const csvLines = [headers, ...rows].map((row) => row.map(csvEscape).join(",")).join("\r\n");
  const body = `\uFEFF${csvLines}`;
  const fileName = buildCsvFilename(String(form.title || ""));

  return new NextResponse(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename=\"${fileName}\"`,
      "Cache-Control": "no-store",
      Pragma: "no-cache",
      Expires: "0",
      Vary: "Cookie",
    },
  });
}
