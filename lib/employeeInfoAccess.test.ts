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
  getEmployeeInfoColumnManagementAccess,
  getEmployeeInfoAccess,
  resolveOptionalAccessRpcBoolean,
} from "./employeeInfoAccess";

const mockedGetCurrentRequestUser = vi.mocked(getCurrentRequestUser);

function createEmployeeInfoAccessClient({
  profile = { id: "app-user-1", role: "member" },
  rpcResults = {},
}: {
  profile?: { id: string | null; role: string | null } | null;
  rpcResults?: Record<
    string,
    { data: boolean | null; error?: { message?: string; code?: string } | null }
  >;
} = {}) {
  const calls: Array<{ table?: string; rpc?: string; filters?: Record<string, string> }> = [];

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
              return { data: profile, error: null };
            },
          })),
        };
      },
      async rpc(functionName: string) {
        calls.push({ rpc: functionName });
        return rpcResults[functionName] || { data: null, error: null };
      },
    },
  };
}

describe("employee info access helpers", () => {
  afterEach(() => {
    mockedGetCurrentRequestUser.mockReset();
  });

  it("rejects unauthenticated users before profile or RPC lookups", async () => {
    mockedGetCurrentRequestUser.mockResolvedValue(null);
    const { client, calls } = createEmployeeInfoAccessClient();

    await expect(
      getEmployeeInfoAccess(client, {
        authTimingLabel: "inventory.auth",
        accessRpcName: "can_access_inventory",
        manageColumnsRpcName: "can_manage_inventory_columns",
      })
    ).resolves.toEqual({
      ok: false,
      reason: "unauthenticated",
      user: null,
      currentAppUserId: null,
      isAdmin: false,
      canAccess: false,
      canManageColumns: false,
    });
    expect(calls).toEqual([]);
  });

  it("loads profiles by email and resolves access/manage RPCs", async () => {
    mockedGetCurrentRequestUser.mockResolvedValue({
      id: "auth-user-1",
      email: "person@example.com",
      user_metadata: null,
    });
    const { client, calls } = createEmployeeInfoAccessClient({
      rpcResults: {
        can_access_inventory: { data: true, error: null },
        can_manage_inventory_columns: { data: false, error: null },
      },
    });

    await expect(
      getEmployeeInfoAccess(client, {
        authTimingLabel: "inventory.auth",
        profileTimingLabel: "inventory.profile",
        accessRpcName: "can_access_inventory",
        manageColumnsRpcName: "can_manage_inventory_columns",
      })
    ).resolves.toMatchObject({
      ok: true,
      currentAppUserId: "app-user-1",
      isAdmin: false,
      canAccess: true,
      canManageColumns: false,
    });
    expect(calls[0]).toEqual({
      table: "users",
      filters: { email: "person@example.com" },
    });
    expect(calls.slice(1)).toEqual([
      { rpc: "can_access_inventory" },
      { rpc: "can_manage_inventory_columns" },
    ]);
  });

  it("falls back to auth id when email is missing", async () => {
    mockedGetCurrentRequestUser.mockResolvedValue({
      id: "auth-user-1",
      email: "",
      user_metadata: null,
    });
    const { client, calls } = createEmployeeInfoAccessClient({ profile: null });

    await expect(
      getEmployeeInfoAccess(client, {
        authTimingLabel: "employee_info.auth",
        accessRpcName: "can_access_employee_info",
      })
    ).resolves.toMatchObject({
      ok: true,
      currentAppUserId: "auth-user-1",
      isAdmin: false,
      canAccess: false,
      canManageColumns: false,
    });
    expect(calls[0]).toEqual({
      table: "users",
      filters: { id: "auth-user-1" },
    });
  });

  it("uses admin fallback when optional access RPCs are missing or failing", async () => {
    expect(
      resolveOptionalAccessRpcBoolean(
        { data: null, error: { code: "PGRST202", message: "Missing function" } },
        true
      )
    ).toBe(true);
    expect(
      resolveOptionalAccessRpcBoolean(
        { data: null, error: { message: "Network failed" } },
        false
      )
    ).toBe(false);

    mockedGetCurrentRequestUser.mockResolvedValue({
      id: "auth-user-1",
      email: "admin@example.com",
      user_metadata: null,
    });
    const { client } = createEmployeeInfoAccessClient({
      profile: { id: "admin-1", role: "admin" },
      rpcResults: {
        can_access_employee_info: {
          data: null,
          error: { code: "PGRST202", message: "Missing function" },
        },
        can_manage_employee_info_columns: {
          data: null,
          error: { message: "RPC failed" },
        },
      },
    });

    await expect(
      getEmployeeInfoAccess(client, {
        authTimingLabel: "employee_info.auth",
        accessRpcName: "can_access_employee_info",
        manageColumnsRpcName: "can_manage_employee_info_columns",
      })
    ).resolves.toMatchObject({
      ok: true,
      currentAppUserId: "admin-1",
      isAdmin: true,
      canAccess: true,
      canManageColumns: true,
    });
  });

  it("rejects unauthenticated column-management checks before profile or RPC lookups", async () => {
    mockedGetCurrentRequestUser.mockResolvedValue(null);
    const { client, calls } = createEmployeeInfoAccessClient();

    await expect(
      getEmployeeInfoColumnManagementAccess(client, {
        authTimingLabel: "employee_info.columns.create.auth",
        manageColumnsRpcName: "can_manage_employee_info_columns",
      })
    ).resolves.toMatchObject({
      ok: false,
      reason: "unauthenticated",
      error: "Unauthorized",
      canManageColumns: false,
    });
    expect(calls).toEqual([]);
  });

  it("returns real column-management RPC errors to server actions", async () => {
    mockedGetCurrentRequestUser.mockResolvedValue({
      id: "auth-user-1",
      email: "person@example.com",
      user_metadata: null,
    });
    const { client, calls } = createEmployeeInfoAccessClient({
      rpcResults: {
        can_manage_inventory_columns: {
          data: null,
          error: { message: "Permission RPC failed" },
        },
      },
    });

    await expect(
      getEmployeeInfoColumnManagementAccess(client, {
        authTimingLabel: "inventory.columns.update.auth",
        manageColumnsRpcName: "can_manage_inventory_columns",
      })
    ).resolves.toMatchObject({
      ok: false,
      reason: "permission_error",
      error: "Permission RPC failed",
      currentAppUserId: "app-user-1",
      isAdmin: false,
      canManageColumns: false,
    });
    expect(calls).toEqual([
      { table: "users", filters: { email: "person@example.com" } },
      { rpc: "can_manage_inventory_columns" },
    ]);
  });

  it("uses admin fallback for missing column-management RPCs", async () => {
    mockedGetCurrentRequestUser.mockResolvedValue({
      id: "auth-user-1",
      email: "admin@example.com",
      user_metadata: null,
    });
    const { client } = createEmployeeInfoAccessClient({
      profile: { id: "admin-1", role: "admin" },
      rpcResults: {
        can_manage_employee_info_columns: {
          data: null,
          error: { code: "PGRST202", message: "Missing function" },
        },
      },
    });

    await expect(
      getEmployeeInfoColumnManagementAccess(client, {
        authTimingLabel: "employee_info.columns.move.auth",
        manageColumnsRpcName: "can_manage_employee_info_columns",
      })
    ).resolves.toMatchObject({
      ok: true,
      currentAppUserId: "admin-1",
      isAdmin: true,
      canManageColumns: true,
    });
  });
});
