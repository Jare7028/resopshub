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
import { adminApiAuthResponse, requireApiAdmin } from "./requireApiAdmin";

const mockedGetCurrentRequestUser = vi.mocked(getCurrentRequestUser);

function createAdminClient(profile: { id: string; role: string | null } | null) {
  const maybeSingle = vi.fn().mockResolvedValue({ data: profile });
  const eq = vi.fn(() => ({ maybeSingle }));
  const select = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ select }));

  return {
    auth: {
      getUser: vi.fn(),
    },
    from,
    mocks: {
      from,
      select,
      eq,
      maybeSingle,
    },
  };
}

describe("requireApiAdmin", () => {
  afterEach(() => {
    mockedGetCurrentRequestUser.mockReset();
  });

  it("returns the current auth user and admin profile when the requester is an admin", async () => {
    const user = {
      id: "5f1a2ef3-c1f2-4ee7-8a1d-6f150dcaa871",
      email: "admin@example.com",
      user_metadata: null,
    };
    const client = createAdminClient({ id: "admin-profile", role: "admin" });
    mockedGetCurrentRequestUser.mockResolvedValue(user);

    const result = await requireApiAdmin(client, "admin.users.auth");

    expect(result).toEqual({
      user,
      profile: { id: "admin-profile", role: "admin" },
      response: null,
    });
    expect(mockedGetCurrentRequestUser).toHaveBeenCalledWith(client, "admin.users.auth", {
      trustForwardedUserHeaders: false,
    });
    expect(client.mocks.from).toHaveBeenCalledWith("users");
    expect(client.mocks.select).toHaveBeenCalledWith("id,role");
    expect(client.mocks.eq).toHaveBeenCalledWith("email", "admin@example.com");
  });

  it("returns unauthorized when the requester is not authenticated", async () => {
    mockedGetCurrentRequestUser.mockResolvedValue(null);

    const result = await requireApiAdmin(createAdminClient(null));

    expect(result.user).toBeNull();
    expect(result.profile).toBeNull();
    if (!result.response) throw new Error("Expected auth response");
    expect(result.response.status).toBe(401);
    await expect(result.response.json()).resolves.toEqual({
      ok: false,
      error: "Unauthorized",
    });
  });

  it("returns forbidden when the requester is not an admin", async () => {
    mockedGetCurrentRequestUser.mockResolvedValue({
      id: "5f1a2ef3-c1f2-4ee7-8a1d-6f150dcaa871",
      email: "member@example.com",
      user_metadata: null,
    });

    const result = await requireApiAdmin(
      createAdminClient({ id: "member-profile", role: "member" })
    );

    expect(result.user).toBeNull();
    expect(result.profile).toBeNull();
    if (!result.response) throw new Error("Expected auth response");
    expect(result.response.status).toBe(403);
    await expect(result.response.json()).resolves.toEqual({
      ok: false,
      error: "Forbidden",
    });
  });
});

describe("adminApiAuthResponse", () => {
  it("keeps the admin API error response shape", async () => {
    const response = adminApiAuthResponse("Forbidden", 403);

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ ok: false, error: "Forbidden" });
  });
});
