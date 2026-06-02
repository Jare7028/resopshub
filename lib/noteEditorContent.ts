import type { JSONContent } from "@tiptap/core";
import { createEmptyDoc } from "@/lib/editorContent";

export function normalizeContent(content: unknown): JSONContent {
  if (content && typeof content === "object") {
    const value = content as { type?: string };
    if (value.type === "doc") {
      return content as JSONContent;
    }
  }
  return createEmptyDoc() as JSONContent;
}

export function isTiptapDocContent(value: unknown): value is { type: "doc" } {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const node = value as { type?: unknown };
  return node.type === "doc";
}

export function normalizeSaveWarnings(value: unknown) {
  if (!Array.isArray(value)) {
    return [] as string[];
  }
  return value
    .map((item) => String(item || "").trim())
    .filter(Boolean)
    .slice(0, 6);
}

export function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function cloneJsonValue<T>(value: T): T {
  try {
    return JSON.parse(JSON.stringify(value)) as T;
  } catch {
    return value;
  }
}

export function mergeSaveWarnings(...values: unknown[]) {
  const warnings = new Set<string>();
  values.forEach((value) => {
    normalizeSaveWarnings(value).forEach((warning) => warnings.add(warning));
  });
  return Array.from(warnings).slice(0, 6);
}

export function isEphemeralImageSource(value: string) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  return normalized.startsWith("blob:") || normalized.startsWith("file:");
}

export function containsEphemeralImageSource(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.some((item) => containsEphemeralImageSource(item));
  }
  if (!isObjectRecord(value)) {
    return false;
  }
  const nodeType = String(value.type || "")
    .trim()
    .toLowerCase();
  if (nodeType.includes("image") && isObjectRecord(value.attrs)) {
    const source = String((value.attrs as Record<string, unknown>).src || "").trim();
    if (isEphemeralImageSource(source)) {
      return true;
    }
  }
  return Object.values(value).some((entry) => containsEphemeralImageSource(entry));
}
