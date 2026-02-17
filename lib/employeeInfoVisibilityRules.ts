export type EmployeeInfoVisibilityRuleRow = {
  user_id: string;
  enabled: boolean | null;
  allowed_client_ids: string[] | null;
  role_column_id: string | null;
  allowed_role_values: string[] | null;
};

export type EmployeeInfoVisibilityRule = {
  enabled: boolean;
  allowedClientIds: string[];
  roleColumnId: string | null;
  allowedRoleTokens: string[];
};

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values));
}

function normalizeStringArray(raw: unknown) {
  if (!Array.isArray(raw)) return [] as string[];
  return uniqueStrings(
    raw
      .map((value) => String(value || "").trim())
      .filter(Boolean)
  );
}

export function normalizeEmployeeInfoRoleToken(value: unknown) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

export function parseEmployeeInfoRoleValuesInput(raw: string) {
  return uniqueStrings(
    String(raw || "")
      .split(",")
      .map((value) => String(value || "").trim())
      .filter(Boolean)
  );
}

export function toEmployeeInfoVisibilityRule(
  row: EmployeeInfoVisibilityRuleRow | null | undefined
): EmployeeInfoVisibilityRule {
  const roleColumnId = String(row?.role_column_id || "").trim() || null;
  const allowedRoleTokens = uniqueStrings(
    normalizeStringArray(row?.allowed_role_values).map((value) =>
      normalizeEmployeeInfoRoleToken(value)
    )
  ).filter(Boolean);

  return {
    enabled: Boolean(row?.enabled),
    allowedClientIds: normalizeStringArray(row?.allowed_client_ids),
    roleColumnId,
    allowedRoleTokens,
  };
}

export function isEmployeeInfoRecordVisible(args: {
  rule: EmployeeInfoVisibilityRule;
  clientId: string | null;
  roleValue?: string | null;
}) {
  const { rule, clientId, roleValue } = args;
  if (!rule.enabled) return true;

  if (rule.allowedClientIds.length) {
    const normalizedClientId = String(clientId || "").trim();
    if (!normalizedClientId || !rule.allowedClientIds.includes(normalizedClientId)) {
      return false;
    }
  }

  if (rule.roleColumnId && rule.allowedRoleTokens.length) {
    const roleToken = normalizeEmployeeInfoRoleToken(roleValue);
    if (!roleToken || !rule.allowedRoleTokens.includes(roleToken)) {
      return false;
    }
  }

  return true;
}
