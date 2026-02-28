import { isSupabaseMissingTableError } from "@/lib/supabaseErrors";
import { splitAssignmentTargets } from "@/lib/assignmentTargets";

type SupabaseLike = {
  from: (table: string) => {
    select: (columns?: string) => {
      order: (
        column: string,
        options?: {
          ascending?: boolean;
        }
      ) => PromiseLike<{
        data: Array<Record<string, unknown>> | null;
        error: { message?: string; code?: string } | null;
      }>;
      in: (
        column: string,
        values: string[]
      ) => PromiseLike<{
        data: Array<Record<string, unknown>> | null;
        error: { message?: string; code?: string } | null;
      }>;
    };
  };
};

export type AssignmentGroupOption = {
  id: string;
  name: string;
  description: string;
  memberCount: number;
  memberUserIds: string[];
};

function toUniqueSorted(values: Iterable<string>) {
  return Array.from(new Set(values)).sort((a, b) => a.localeCompare(b));
}

export async function loadAssignmentGroups(
  supabase: unknown
): Promise<{
  groups: AssignmentGroupOption[];
  schemaMissing: boolean;
  error: string | null;
}> {
  const db = supabase as SupabaseLike;
  const groupsResult = await db
    .from("assignment_groups")
    .select("id,name,description")
    .order("name", { ascending: true });

  if (groupsResult.error) {
    if (isSupabaseMissingTableError(groupsResult.error)) {
      return {
        groups: [],
        schemaMissing: true,
        error: null,
      };
    }
    return {
      groups: [],
      schemaMissing: false,
      error: String(groupsResult.error.message || "Failed to load assignment groups."),
    };
  }

  const groups = ((groupsResult.data || []) as Array<{
    id: string | null;
    name: string | null;
    description: string | null;
  }>)
    .map((group) => ({
      id: String(group.id || "").trim(),
      name: String(group.name || "").trim(),
      description: String(group.description || "").trim(),
    }))
    .filter((group) => group.id && group.name);

  if (!groups.length) {
    return {
      groups: [],
      schemaMissing: false,
      error: null,
    };
  }

  const groupIds = groups.map((group) => group.id);
  const membersResult = await db
    .from("assignment_group_members")
    .select("group_id,user_id")
    .in("group_id", groupIds);

  if (membersResult.error) {
    if (isSupabaseMissingTableError(membersResult.error)) {
      return {
        groups: [],
        schemaMissing: true,
        error: null,
      };
    }
    return {
      groups: [],
      schemaMissing: false,
      error: String(membersResult.error.message || "Failed to load assignment group members."),
    };
  }

  const membersByGroupId = new Map<string, string[]>();
  ((membersResult.data || []) as Array<{
    group_id: string | null;
    user_id: string | null;
  }>).forEach((member) => {
    const groupId = String(member.group_id || "").trim();
    const userId = String(member.user_id || "").trim();
    if (!groupId || !userId) return;
    const bucket = membersByGroupId.get(groupId) || [];
    bucket.push(userId);
    membersByGroupId.set(groupId, bucket);
  });

  return {
    groups: groups.map((group) => {
      const memberUserIds = toUniqueSorted(membersByGroupId.get(group.id) || []);
      return {
        id: group.id,
        name: group.name,
        description: group.description,
        memberCount: memberUserIds.length,
        memberUserIds,
      };
    }),
    schemaMissing: false,
    error: null,
  };
}

export async function resolveAssignmentTargetsToUserIds(
  supabase: unknown,
  values: Iterable<unknown>
): Promise<{
  userIds: string[];
  error: string | null;
}> {
  const db = supabase as SupabaseLike;
  const { userIds, groupIds } = splitAssignmentTargets(values);
  if (!groupIds.length) {
    return {
      userIds: toUniqueSorted(userIds),
      error: null,
    };
  }

  const membersResult = await db
    .from("assignment_group_members")
    .select("group_id,user_id")
    .in("group_id", groupIds);

  if (membersResult.error) {
    if (isSupabaseMissingTableError(membersResult.error)) {
      return {
        userIds: toUniqueSorted(userIds),
        error:
          "Group assignments are not set up yet. Run sql/20260301150000_assignment_groups.sql first.",
      };
    }

    return {
      userIds: toUniqueSorted(userIds),
      error: String(membersResult.error.message || "Failed to resolve assignment groups."),
    };
  }

  const expandedUserIds = ((membersResult.data || []) as Array<{
    user_id: string | null;
  }>)
    .map((member) => String(member.user_id || "").trim())
    .filter(Boolean);

  return {
    userIds: toUniqueSorted([...userIds, ...expandedUserIds]),
    error: null,
  };
}
