const uuidRegex =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type AssignmentTargetKind = "user" | "group";

export type AssignmentTarget = {
  kind: AssignmentTargetKind;
  id: string;
  value: string;
};

function normalizeUuid(value: string) {
  const trimmed = value.trim().toLowerCase();
  return uuidRegex.test(trimmed) ? trimmed : "";
}

export function encodeAssignmentTarget(kind: AssignmentTargetKind, id: string) {
  const normalizedId = normalizeUuid(id);
  if (!normalizedId) return "";
  if (kind === "user") return normalizedId;
  return `group:${normalizedId}`;
}

export function parseAssignmentTarget(value: unknown): AssignmentTarget | null {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw || raw === "unassigned") return null;

  if (raw.startsWith("group:")) {
    const id = normalizeUuid(raw.slice("group:".length));
    if (!id) return null;
    return {
      kind: "group",
      id,
      value: `group:${id}`,
    };
  }

  if (raw.startsWith("user:")) {
    const id = normalizeUuid(raw.slice("user:".length));
    if (!id) return null;
    return {
      kind: "user",
      id,
      value: id,
    };
  }

  const userId = normalizeUuid(raw);
  if (!userId) return null;
  return {
    kind: "user",
    id: userId,
    value: userId,
  };
}

export function splitAssignmentTargets(values: Iterable<unknown>) {
  const users = new Set<string>();
  const groups = new Set<string>();

  for (const value of values) {
    const parsed = parseAssignmentTarget(value);
    if (!parsed) continue;
    if (parsed.kind === "group") {
      groups.add(parsed.id);
      continue;
    }
    users.add(parsed.id);
  }

  return {
    userIds: Array.from(users),
    groupIds: Array.from(groups),
  };
}
