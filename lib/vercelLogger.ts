import "server-only";

type LogLevel = "debug" | "info" | "warn" | "error";
type LogFields = Record<string, unknown>;

const LOG_LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const configuredLevel = (process.env.LOG_LEVEL || "info").toLowerCase();
const minimumLevel: LogLevel =
  configuredLevel === "debug" ||
  configuredLevel === "info" ||
  configuredLevel === "warn" ||
  configuredLevel === "error"
    ? configuredLevel
    : "info";

const redactedKeys = new Set([
  "authorization",
  "cookie",
  "password",
  "secret",
  "set-cookie",
  "supabase_service_role_key",
  "token",
]);

function shouldLog(level: LogLevel) {
  return LOG_LEVEL_ORDER[level] >= LOG_LEVEL_ORDER[minimumLevel];
}

function sanitize(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) {
    return value;
  }

  if (depth > 4) {
    return "[truncated]";
  }

  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack,
    };
  }

  if (typeof value === "bigint") {
    return value.toString();
  }

  if (typeof value === "function") {
    return "[function]";
  }

  if (Array.isArray(value)) {
    return value.slice(0, 50).map((entry) => sanitize(entry, depth + 1));
  }

  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).slice(0, 80);
    const result: Record<string, unknown> = {};

    for (const [key, entry] of entries) {
      const normalizedKey = key.toLowerCase();
      if (redactedKeys.has(normalizedKey)) {
        result[key] = "[redacted]";
        continue;
      }
      result[key] = sanitize(entry, depth + 1);
    }

    return result;
  }

  return value;
}

function emitLog(level: LogLevel, event: string, fields: LogFields = {}) {
  if (!shouldLog(level)) {
    return;
  }

  const sanitizedFields = sanitize(fields);
  const safeFields =
    typeof sanitizedFields === "object" && sanitizedFields
      ? (sanitizedFields as Record<string, unknown>)
      : { fields: sanitizedFields };

  const payload = {
    ts: new Date().toISOString(),
    level,
    event,
    vercel_env: process.env.VERCEL_ENV || "local",
    vercel_region: process.env.VERCEL_REGION || null,
    runtime: process.env.NEXT_RUNTIME || "nodejs",
    ...safeFields,
  };

  const line = JSON.stringify(payload);
  if (level === "error") {
    console.error(line);
    return;
  }
  if (level === "warn") {
    console.warn(line);
    return;
  }
  if (level === "debug") {
    console.debug(line);
    return;
  }
  console.info(line);
}

export function logDebug(event: string, fields: LogFields = {}) {
  emitLog("debug", event, fields);
}

export function logInfo(event: string, fields: LogFields = {}) {
  emitLog("info", event, fields);
}

export function logWarn(event: string, fields: LogFields = {}) {
  emitLog("warn", event, fields);
}

export function logError(event: string, fields: LogFields = {}) {
  emitLog("error", event, fields);
}
