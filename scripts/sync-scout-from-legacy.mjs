#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");

const DEFAULT_V2_DIR = "/Users/jared/.openclaw/workspace-cs-role-scout/v2";
const DEFAULT_SQLITE_DB = "/Users/jared/.openclaw/workspace-cs-role-scout/v2/data/cs-role-scout-v2.sqlite";
const DEFAULT_SEED_FILE = "/Users/jared/.openclaw/workspace/tmp/resopshub-scout-seed-from-zendesk-20260413.json";

function parseArgs(argv) {
  const args = {
    refreshV2: true,
    dryRun: false,
    v2Dir: DEFAULT_V2_DIR,
    sqliteDb: DEFAULT_SQLITE_DB,
    seedFile: DEFAULT_SEED_FILE,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--no-refresh-v2") {
      args.refreshV2 = false;
      continue;
    }
    if (arg === "--dry-run") {
      args.dryRun = true;
      continue;
    }
    if (arg === "--v2-dir" && argv[i + 1]) {
      args.v2Dir = path.resolve(argv[i + 1]);
      i += 1;
      continue;
    }
    if (arg === "--sqlite-db" && argv[i + 1]) {
      args.sqliteDb = path.resolve(argv[i + 1]);
      i += 1;
      continue;
    }
    if (arg === "--seed-file" && argv[i + 1]) {
      args.seedFile = path.resolve(argv[i + 1]);
      i += 1;
      continue;
    }
  }

  return args;
}

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    if (!key || process.env[key]) continue;
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

function compact(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function nullable(value) {
  const text = compact(value);
  return text ? text : null;
}

function extractLinkedInJobId(url) {
  const text = compact(url);
  const match = text.match(/linkedin\.com\/jobs\/view\/(\d+)/i);
  return match?.[1] ?? null;
}

function deriveExternalJobKey(sourceUrl, fallbackKey) {
  const linkedinId = extractLinkedInJobId(sourceUrl || "");
  if (linkedinId) return `linkedin:${linkedinId}`;
  const fallback = compact(fallbackKey);
  return fallback ? fallback : null;
}

function safeJsonParse(value, fallback) {
  if (value == null || value === "") return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function uniqueContacts(contacts) {
  const seen = new Set();
  const output = [];
  for (const contact of Array.isArray(contacts) ? contacts : []) {
    if (!contact || typeof contact !== "object") continue;
    const normalized = {
      name: nullable(contact.name ?? contact.full_name),
      title: nullable(contact.title),
      profile: nullable(contact.profile ?? contact.linkedin_url),
      email: nullable(contact.email),
      phone: nullable(contact.phone),
      contact_page: nullable(contact.contact_page),
    };
    if (!normalized.name) continue;
    const key = [normalized.name.toLowerCase(), normalized.profile?.toLowerCase() || "", normalized.title?.toLowerCase() || ""].join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(normalized);
  }
  return output;
}

function buildMetadata(base = {}, extra = {}) {
  const contacts = uniqueContacts([...(Array.isArray(base.contacts) ? base.contacts : []), ...(Array.isArray(extra.contacts) ? extra.contacts : [])]);
  return {
    ...base,
    ...extra,
    contacts,
  };
}

function mergeCandidate(current, incoming) {
  if (!current) return incoming;
  return {
    external_job_key: current.external_job_key || incoming.external_job_key,
    company_name: current.company_name || incoming.company_name,
    role_title: current.role_title || incoming.role_title,
    location_text: current.location_text || incoming.location_text,
    employment_type: current.employment_type || incoming.employment_type,
    compensation_text: current.compensation_text || incoming.compensation_text,
    source_name: current.source_name || incoming.source_name,
    source_url: current.source_url || incoming.source_url,
    role_summary: current.role_summary || incoming.role_summary,
    status: current.status || incoming.status,
    first_seen_at: current.first_seen_at || incoming.first_seen_at,
    status_updated_at: current.status_updated_at || incoming.status_updated_at,
    metadata_json: buildMetadata(current.metadata_json, incoming.metadata_json),
  };
}

function normalizeSeedRows(filePath) {
  if (!fs.existsSync(filePath)) return [];
  const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
  if (!Array.isArray(parsed)) {
    throw new Error(`Expected an array in ${filePath}`);
  }

  return parsed
    .map((row) => {
      const companyName = nullable(row.company_name);
      const roleTitle = nullable(row.role_title);
      const sourceUrl = nullable(row.source_url);
      if (!companyName || !roleTitle) return null;
      return {
        external_job_key: deriveExternalJobKey(sourceUrl, row.external_job_key),
        company_name: companyName,
        role_title: roleTitle,
        location_text: nullable(row.location_text),
        employment_type: nullable(row.employment_type),
        compensation_text: nullable(row.compensation_text),
        source_name: nullable(row.source_name) || "linkedin",
        source_url: sourceUrl,
        role_summary: nullable(row.role_summary),
        status: nullable(row.status) || "active",
        first_seen_at: nullable(row.created_at) || nullable(row.first_seen_at),
        status_updated_at: nullable(row.status_updated_at) || nullable(row.updated_at),
        metadata_json: buildMetadata({}, {
          imported_from: "legacy-scout-seed",
          legacy_record_id: nullable(row.id),
        }),
      };
    })
    .filter(Boolean);
}

function querySqliteJson(dbPath, sql) {
  const raw = execFileSync("/usr/bin/sqlite3", ["-json", dbPath, sql], {
    encoding: "utf8",
  }).trim();
  return raw ? JSON.parse(raw) : [];
}

function normalizeSqliteRows(dbPath) {
  if (!fs.existsSync(dbPath)) return [];
  const sql = `
    SELECT
      j.external_key,
      j.title AS role_title,
      j.location AS location_text,
      j.employment_type,
      j.salary_text AS compensation_text,
      j.source AS source_name,
      j.job_url AS source_url,
      j.posted_text,
      j.first_seen_at,
      j.last_seen_at,
      c.name AS company_name,
      c.summary AS company_summary,
      c.size_band AS company_size,
      c.revenue_estimate,
      j.remote_type,
      j.search_url,
      j.raw_payload,
      COALESCE((
        SELECT json_group_array(
          json_object(
            'name', ct.full_name,
            'title', ct.title,
            'profile', ct.linkedin_url,
            'email', ct.email,
            'phone', ct.phone,
            'contact_page', ct.contact_page
          )
        )
        FROM contacts ct
        WHERE ct.company_id = c.id
      ), '[]') AS contacts_json
    FROM jobs j
    INNER JOIN companies c ON c.id = j.company_id
    ORDER BY j.last_seen_at DESC, j.first_seen_at DESC
  `;

  const rows = querySqliteJson(dbPath, sql);
  return rows
    .map((row) => {
      const companyName = nullable(row.company_name);
      const roleTitle = nullable(row.role_title);
      const sourceUrl = nullable(row.source_url);
      if (!companyName || !roleTitle || !sourceUrl) return null;
      const rawPayload = safeJsonParse(row.raw_payload, null);
      const payloadPostedText = rawPayload && typeof rawPayload === "object" ? rawPayload.postedText ?? rawPayload.time : null;
      const payloadCompanySize = rawPayload && typeof rawPayload === "object" ? rawPayload.sizeBand ?? rawPayload.size : null;
      const payloadRevenueEstimate = rawPayload && typeof rawPayload === "object" ? rawPayload.revenueEstimate ?? rawPayload.revenue : null;
      const payloadSummary = rawPayload && typeof rawPayload === "object" ? rawPayload.summary : null;
      return {
        external_job_key: deriveExternalJobKey(sourceUrl, row.external_key),
        company_name: companyName,
        role_title: roleTitle,
        location_text: nullable(row.location_text),
        employment_type: nullable(row.employment_type),
        compensation_text: nullable(row.compensation_text),
        source_name: nullable(row.source_name) || "linkedin",
        source_url: sourceUrl,
        role_summary: nullable(row.company_summary) || nullable(payloadSummary),
        status: "active",
        first_seen_at: nullable(row.first_seen_at),
        status_updated_at: nullable(row.last_seen_at),
        metadata_json: buildMetadata({}, {
          imported_from: "legacy-scout-v2-sqlite",
          posted_text: nullable(row.posted_text) || nullable(payloadPostedText),
          company_size: nullable(row.company_size) || nullable(payloadCompanySize),
          revenue_estimate: nullable(row.revenue_estimate) || nullable(payloadRevenueEstimate),
          company_summary: nullable(row.company_summary) || nullable(payloadSummary),
          remote_type: nullable(row.remote_type),
          search_url: nullable(row.search_url),
          raw_payload: rawPayload,
          contacts: uniqueContacts(safeJsonParse(row.contacts_json, [])),
        }),
      };
    })
    .filter(Boolean);
}

function combineCandidates(rows) {
  const combined = new Map();
  for (const row of rows) {
    const key = row.external_job_key || row.source_url || `${row.company_name}::${row.role_title}`;
    combined.set(key, mergeCandidate(combined.get(key), row));
  }
  return [...combined.values()];
}

function chunk(items, size) {
  const output = [];
  for (let i = 0; i < items.length; i += size) {
    output.push(items.slice(i, i + size));
  }
  return output;
}

function parseExistingMetadata(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value;
}

async function fetchExistingRows(supabase, candidates) {
  const byId = new Map();
  const externalKeys = [...new Set(candidates.map((row) => row.external_job_key).filter(Boolean))];
  const sourceUrls = [...new Set(candidates.map((row) => row.source_url).filter(Boolean))];

  for (const batch of chunk(externalKeys, 100)) {
    const { data, error } = await supabase
      .from("role_scout_jobs")
      .select("id,external_job_key,source_url,role_summary,first_seen_at,status,status_updated_at,ignored_at,contacted_at,ignore_reason,metadata_json")
      .in("external_job_key", batch);
    if (error) throw error;
    for (const row of data || []) {
      byId.set(row.id, row);
    }
  }

  for (const batch of chunk(sourceUrls, 100)) {
    const { data, error } = await supabase
      .from("role_scout_jobs")
      .select("id,external_job_key,source_url,role_summary,first_seen_at,status,status_updated_at,ignored_at,contacted_at,ignore_reason,metadata_json")
      .in("source_url", batch);
    if (error) throw error;
    for (const row of data || []) {
      byId.set(row.id, row);
    }
  }

  const byExternalKey = new Map();
  const bySourceUrl = new Map();
  for (const row of byId.values()) {
    if (row.external_job_key) byExternalKey.set(row.external_job_key, row);
    if (row.source_url) bySourceUrl.set(row.source_url, row);
  }

  return { byExternalKey, bySourceUrl };
}

async function syncCandidates(supabase, candidates, dryRun = false) {
  const { byExternalKey, bySourceUrl } = await fetchExistingRows(supabase, candidates);
  let inserted = 0;
  let updated = 0;

  for (const candidate of candidates) {
    const existing =
      (candidate.external_job_key && byExternalKey.get(candidate.external_job_key)) ||
      (candidate.source_url && bySourceUrl.get(candidate.source_url)) ||
      null;

    if (!existing) {
      inserted += 1;
      if (dryRun) continue;
      const payload = {
        external_job_key: candidate.external_job_key,
        company_name: candidate.company_name,
        role_title: candidate.role_title,
        location_text: candidate.location_text,
        employment_type: candidate.employment_type,
        compensation_text: candidate.compensation_text,
        source_name: candidate.source_name,
        source_url: candidate.source_url,
        role_summary: candidate.role_summary,
        metadata_json: candidate.metadata_json,
        status: candidate.status || "active",
        first_seen_at: candidate.first_seen_at || new Date().toISOString(),
        status_updated_at: candidate.status_updated_at || new Date().toISOString(),
        created_by_user_id: null,
        updated_by_user_id: null,
      };
      const { error } = await supabase.from("role_scout_jobs").insert(payload);
      if (error) throw error;
      continue;
    }

    updated += 1;
    if (dryRun) continue;
    const payload = {
      external_job_key: candidate.external_job_key || existing.external_job_key,
      company_name: candidate.company_name,
      role_title: candidate.role_title,
      location_text: candidate.location_text,
      employment_type: candidate.employment_type,
      compensation_text: candidate.compensation_text,
      source_name: candidate.source_name,
      source_url: candidate.source_url || existing.source_url,
      role_summary: candidate.role_summary || existing.role_summary,
      metadata_json: buildMetadata(parseExistingMetadata(existing.metadata_json), candidate.metadata_json),
      first_seen_at: existing.first_seen_at || candidate.first_seen_at || new Date().toISOString(),
      updated_by_user_id: null,
    };
      const { error } = await supabase.from("role_scout_jobs").update(payload).eq("id", existing.id);
      if (error) throw error;
  }

  return { inserted, updated };
}

function runRefresh(v2Dir) {
  execFileSync("npm", ["run", "db:import"], {
    cwd: v2Dir,
    stdio: "inherit",
    env: process.env,
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  loadEnvFile(path.join(repoRoot, ".env.local"));
  loadEnvFile(path.join(repoRoot, ".env"));

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in repo env.");
  }

  if (args.refreshV2) {
    runRefresh(args.v2Dir);
  }

  const seedRows = normalizeSeedRows(args.seedFile);
  const sqliteRows = normalizeSqliteRows(args.sqliteDb);
  const candidates = combineCandidates([...seedRows, ...sqliteRows]);

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const result = await syncCandidates(supabase, candidates, args.dryRun);
  const summary = {
    ok: true,
    dryRun: args.dryRun,
    refreshV2: args.refreshV2,
    seedRows: seedRows.length,
    sqliteRows: sqliteRows.length,
    mergedRows: candidates.length,
    inserted: result.inserted,
    updated: result.updated,
  };

  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
