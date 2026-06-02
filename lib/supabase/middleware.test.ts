import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@supabase/ssr", () => ({
  createServerClient: vi.fn(),
}));

vi.mock("@/lib/vercelLogger", () => ({
  logError: vi.fn(),
  logWarn: vi.fn(),
}));

import { createServerClient } from "@supabase/ssr";
import { logError, logWarn } from "@/lib/vercelLogger";
import { updateSession } from "./middleware";

const mockedCreateServerClient = vi.mocked(createServerClient);
const mockedLogError = vi.mocked(logError);
const mockedLogWarn = vi.mocked(logWarn);

function createRequest(path: string, init: ConstructorParameters<typeof NextRequest>[1] = {}) {
  return new NextRequest(`https://example.test${path}`, init);
}

function mockSupabase({
  user = { id: "auth-user-1", email: "user@example.com" },
  canEdit = true,
  permissionError = null,
}: {
  user?: { id: string; email?: string | null } | null;
  canEdit?: boolean;
  permissionError?: { message: string; code?: string } | null;
}) {
  const authGetUser = vi.fn().mockResolvedValue({ data: { user } });
  const rpc = vi.fn().mockResolvedValue({
    data: canEdit,
    error: permissionError,
  });
  const client = {
    auth: {
      getUser: authGetUser,
    },
    rpc,
  };
  mockedCreateServerClient.mockReturnValue(client as never);
  return { authGetUser, rpc };
}

describe("updateSession permission middleware", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("skips Supabase work for public share routes", async () => {
    const response = await updateSession(createRequest("/forms/share/token"));

    expect(response.status).toBe(200);
    expect(mockedCreateServerClient).not.toHaveBeenCalled();
  });

  it("skips Supabase work for router prefetch requests", async () => {
    const response = await updateSession(
      createRequest("/tasks", {
        headers: {
          "next-router-prefetch": "1",
        },
      })
    );

    expect(response.status).toBe(200);
    expect(mockedCreateServerClient).not.toHaveBeenCalled();
  });

  it("does not check edit permissions for page reads", async () => {
    const { authGetUser, rpc } = mockSupabase({});

    const response = await updateSession(createRequest("/tasks"));

    expect(response.status).toBe(200);
    expect(authGetUser).toHaveBeenCalledTimes(1);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("checks page edit permission for mutations and allows permitted users", async () => {
    const { rpc } = mockSupabase({ canEdit: true });

    const response = await updateSession(
      createRequest("/tasks", {
        method: "POST",
      })
    );

    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("can_edit_page", { p_page_key: "tasks" });
    expect(mockedLogWarn).not.toHaveBeenCalled();
  });

  it("blocks denied page mutations", async () => {
    const { rpc } = mockSupabase({ canEdit: false });

    const response = await updateSession(
      createRequest("/projects/123", {
        method: "PATCH",
        headers: {
          "x-resopshub-user-id": "client-spoof",
          "x-resopshub-user-email": "spoof@example.com",
        },
      })
    );
    const payload = await response.json();

    expect(response.status).toBe(403);
    expect(payload).toEqual({ error: "Forbidden" });
    expect(rpc).toHaveBeenCalledWith("can_edit_page", { p_page_key: "projects" });
    expect(mockedLogWarn).toHaveBeenCalledWith(
      "middleware.permission_check.edit.denied",
      expect.objectContaining({
        method: "PATCH",
        pathname: "/projects/123",
        page_key: "projects",
      })
    );
  });

  it("fails closed when the permission RPC errors unexpectedly", async () => {
    mockSupabase({
      permissionError: {
        message: "permission function failed",
        code: "50000",
      },
    });

    const response = await updateSession(
      createRequest("/settings", {
        method: "POST",
      })
    );
    const payload = await response.json();

    expect(response.status).toBe(500);
    expect(payload).toEqual({ error: "Permission check failed." });
    expect(mockedLogError).toHaveBeenCalledWith(
      "middleware.permission_check.edit.error",
      expect.objectContaining({
        method: "POST",
        pathname: "/settings",
        page_key: "settings",
      })
    );
  });
});
