"use client";

type ClientLogLevel = "debug" | "info" | "warn" | "error";
type ClientLogFields = Record<string, unknown>;

const redactedKeys = new Set([
  "authorization",
  "cookie",
  "password",
  "secret",
  "set-cookie",
  "supabase_service_role_key",
  "token",
]);

function sanitize(value: unknown, depth = 0, seen = new WeakSet<object>()): unknown {
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
    return value.slice(0, 50).map((entry) => sanitize(entry, depth + 1, seen));
  }

  if (typeof value === "object") {
    const objectValue = value as Record<string, unknown>;
    if (seen.has(objectValue)) {
      return "[circular]";
    }
    seen.add(objectValue);

    const result: Record<string, unknown> = {};
    Object.entries(objectValue)
      .slice(0, 80)
      .forEach(([key, entry]) => {
        if (redactedKeys.has(key.toLowerCase())) {
          result[key] = "[redacted]";
          return;
        }
        result[key] = sanitize(entry, depth + 1, seen);
      });
    return result;
  }

  return value;
}

function emitClientLog(level: ClientLogLevel, event: string, fields: ClientLogFields = {}) {
  try {
    const sanitizedFields = sanitize(fields);
    const payload = {
      ts: new Date().toISOString(),
      level,
      event,
      ...((typeof sanitizedFields === "object" && sanitizedFields) || {
        fields: sanitizedFields,
      }),
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
  } catch {
    // Avoid throwing from logging inside customer-facing client components.
  }
}

export function logClientDebug(event: string, fields: ClientLogFields = {}) {
  emitClientLog("debug", event, fields);
}

export function logClientInfo(event: string, fields: ClientLogFields = {}) {
  emitClientLog("info", event, fields);
}

export function logClientWarn(event: string, fields: ClientLogFields = {}) {
  emitClientLog("warn", event, fields);
}

export function logClientError(event: string, fields: ClientLogFields = {}) {
  emitClientLog("error", event, fields);
}
