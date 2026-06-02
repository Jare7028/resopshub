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
import { getAdminAccess } from "./adminAccess";

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

describe("getAdminAccess", () => {
  afterEach(() => {
    mockedGetCurrentRequestUser.mockReset();
  });

  it("returns the current user and admin profile for admins", async () => {
    const user = {
      id: "5f1a2ef3-c1f2-4ee7-8a1d-6f150dcaa871",
      email: "admin@example.com",
      user_metadata: null,
    };
    const client = createAdminClient({ id: "admin-profile", role: "admin" });
    mockedGetCurrentRequestUser.mockResolvedValue(user);

    const result = await getAdminAccess(client, "admin.users.auth");

    expect(result).toEqual({
      ok: true,
      user,
      profile: { id: "admin-profile", role: "admin" },
    });
    expect(mockedGetCurrentRequestUser).toHaveBeenCalledWith(client, "admin.users.auth");
    expect(client.mocks.from).toHaveBeenCalledWith("users");
    expect(client.mocks.select).toHaveBeenCalledWith("id,role");
    expect(client.mocks.eq).toHaveBeenCalledWith("email", "admin@example.com");
  });

  it("returns unauthenticated when no current request user is available", async () => {
    mockedGetCurrentRequestUser.mockResolvedValue(null);

    const result = await getAdminAccess(createAdminClient(null));

    expect(result).toEqual({
      ok: false,
      reason: "unauthenticated",
      user: null,
      profile: null,
    });
  });

  it("returns forbidden when the requester is not an admin", async () => {
    mockedGetCurrentRequestUser.mockResolvedValue({
      id: "5f1a2ef3-c1f2-4ee7-8a1d-6f150dcaa871",
      email: "member@example.com",
      user_metadata: null,
    });

    const result = await getAdminAccess(
      createAdminClient({ id: "member-profile", role: "member" })
    );

    expect(result).toEqual({
      ok: false,
      reason: "forbidden",
      user: null,
      profile: null,
    });
  });
});
