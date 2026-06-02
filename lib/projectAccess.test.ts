import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/currentUser", async () => {
  const actual = await vi.importActual<typeof import("@/lib/supabase/currentUser")>(
    "@/lib/supabase/currentUser"
  );
  return {
    ...actual,
    getCurrentRequestUser: vi.fn(),
  };
});

import { getCurrentRequestUser } from "@/lib/supabase/currentUser";
import {
  getProjectReadAccess,
  getProjectRequesterProfile,
  projectAccessRedirectError,
} from "./projectAccess";

const mockedGetCurrentRequestUser = vi.mocked(getCurrentRequestUser);

type ProfileRow = {
  id: string | null;
  role: string | null;
};

function createProjectAccessClient({
  profile = { id: "user-1", role: "member" },
  assignment = null,
  watcher = null,
  profileError = null,
  assignmentError = null,
  watcherError = null,
}: {
  profile?: ProfileRow | null;
  assignment?: { user_id: string | null } | null;
  watcher?: { user_id: string | null } | null;
  profileError?: { message?: string } | null;
  assignmentError?: { message?: string } | null;
  watcherError?: { message?: string } | null;
} = {}) {
  const calls: Array<{ table: string; filters: Record<string, string> }> = [];
  return {
    calls,
    client: {
      auth: {
        getUser: vi.fn(),
      },
      from(table: string) {
        const filters: Record<string, string> = {};
        return {
          select: vi.fn(() => ({
            eq(column: string, value: string) {
              filters[column] = value;
              return this;
            },
            async maybeSingle() {
              calls.push({ table, filters: { ...filters } });
              if (table === "users") {
                return { data: profile, error: profileError };
              }
              if (table === "project_users") {
                return { data: assignment, error: assignmentError };
              }
              if (table === "project_watchers") {
                return { data: watcher, error: watcherError };
              }
              return { data: null, error: null };
            },
          })),
        };
      },
    },
  };
}

describe("project access helpers", () => {
  afterEach(() => {
    mockedGetCurrentRequestUser.mockReset();
  });

  it("loads the current project requester profile", async () => {
    mockedGetCurrentRequestUser.mockResolvedValue({
      id: "auth-user",
      email: "member@example.com",
      user_metadata: null,
    });
    const { client, calls } = createProjectAccessClient();

    const result = await getProjectRequesterProfile(client, "projects.test.auth");

    expect(result).toEqual({
      ok: true,
      user: {
        id: "auth-user",
        email: "member@example.com",
        user_metadata: null,
      },
      profile: { id: "user-1", role: "member" },
    });
    expect(mockedGetCurrentRequestUser).toHaveBeenCalledWith(
      client,
      "projects.test.auth"
    );
    expect(calls[0]).toEqual({
      table: "users",
      filters: { email: "member@example.com" },
    });
  });

  it("rejects unauthenticated and missing-profile requesters", async () => {
    mockedGetCurrentRequestUser.mockResolvedValue(null);
    expect(await getProjectRequesterProfile(createProjectAccessClient().client)).toEqual({
      ok: false,
      reason: "unauthenticated",
      user: null,
      profile: null,
    });

    mockedGetCurrentRequestUser.mockResolvedValue({
      id: "auth-user",
      email: "missing@example.com",
      user_metadata: null,
    });
    expect(
      await getProjectRequesterProfile(createProjectAccessClient({ profile: null }).client)
    ).toEqual({
      ok: false,
      reason: "profile_missing",
      user: null,
      profile: null,
      error: undefined,
    });
  });

  it("surfaces project requester profile lookup errors", async () => {
    mockedGetCurrentRequestUser.mockResolvedValue({
      id: "auth-user",
      email: "member@example.com",
      user_metadata: null,
    });

    const result = await getProjectRequesterProfile(
      createProjectAccessClient({
        profile: null,
        profileError: { message: "Profile lookup failed" },
      }).client
    );

    expect(result).toEqual({
      ok: false,
      reason: "profile_missing",
      user: null,
      profile: null,
      error: "Profile lookup failed",
    });
    expect(projectAccessRedirectError(result)).toBe("Profile lookup failed");
  });

  it("allows admins without membership lookups", async () => {
    const { client, calls } = createProjectAccessClient();

    const result = await getProjectReadAccess(client, {
      projectId: "project-1",
      profile: { id: "admin-1", role: "admin" },
    });

    expect(result).toEqual({ ok: true });
    expect(calls).toEqual([]);
  });

  it("allows assigned users and watchers", async () => {
    const assignedClient = createProjectAccessClient({
      assignment: { user_id: "user-1" },
    });
    await expect(
      getProjectReadAccess(assignedClient.client, {
        projectId: "project-1",
        profile: { id: "user-1", role: "member" },
      })
    ).resolves.toEqual({ ok: true });
    expect(assignedClient.calls.map((call) => call.table)).toEqual(["project_users"]);

    await expect(
      getProjectReadAccess(
        createProjectAccessClient({ watcher: { user_id: "user-1" } }).client,
        {
          projectId: "project-1",
          profile: { id: "user-1", role: "member" },
        }
      )
    ).resolves.toEqual({ ok: true });
  });

  it("still allows watchers when the assignment lookup fails", async () => {
    const { client, calls } = createProjectAccessClient({
      assignmentError: { message: "Assignment lookup failed" },
      watcher: { user_id: "user-1" },
    });

    await expect(
      getProjectReadAccess(client, {
        projectId: "project-1",
        profile: { id: "user-1", role: "member" },
      })
    ).resolves.toEqual({ ok: true });
    expect(calls.map((call) => call.table)).toEqual([
      "project_users",
      "project_watchers",
    ]);
  });

  it("rejects unrelated project users with redirect-friendly messages", async () => {
    const result = await getProjectReadAccess(createProjectAccessClient().client, {
      projectId: "project-1",
      profile: { id: "user-1", role: "member" },
    });

    expect(result).toEqual({ ok: false, reason: "forbidden", error: undefined });
    expect(projectAccessRedirectError(result)).toBe("Not assigned to that project");
  });

  it("reports project membership lookup errors when read access is denied", async () => {
    const result = await getProjectReadAccess(
      createProjectAccessClient({
        assignmentError: { message: "Assignment lookup failed" },
        watcherError: { message: "Watcher lookup failed" },
      }).client,
      {
        projectId: "project-1",
        profile: { id: "user-1", role: "member" },
      }
    );

    expect(result).toEqual({
      ok: false,
      reason: "forbidden",
      error: "Assignment lookup failed",
    });
    expect(projectAccessRedirectError(result)).toBe("Assignment lookup failed");
  });
});
