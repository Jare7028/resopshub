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
import { getPageEditAccess } from "./pageEditAccess";

const mockedGetCurrentRequestUser = vi.mocked(getCurrentRequestUser);

function createPageAccessClient(result: { data: boolean | null; error: { message?: string } | null }) {
  return {
    auth: {
      getUser: vi.fn(),
    },
    rpc: vi.fn().mockResolvedValue(result),
  };
}

describe("getPageEditAccess", () => {
  afterEach(() => {
    mockedGetCurrentRequestUser.mockReset();
  });

  it("returns the current user when the requester can edit the page", async () => {
    const user = {
      id: "5f1a2ef3-c1f2-4ee7-8a1d-6f150dcaa871",
      email: "admin@example.com",
      user_metadata: null,
    };
    mockedGetCurrentRequestUser.mockResolvedValue(user);
    const client = createPageAccessClient({ data: true, error: null });

    const result = await getPageEditAccess(client, "settings", "settings.action.auth");

    expect(result).toEqual({ ok: true, user });
    expect(mockedGetCurrentRequestUser).toHaveBeenCalledWith(
      client,
      "settings.action.auth"
    );
    expect(client.rpc).toHaveBeenCalledWith("can_edit_page", { p_page_key: "settings" });
  });

  it("returns unauthenticated when there is no current user", async () => {
    mockedGetCurrentRequestUser.mockResolvedValue(null);

    const result = await getPageEditAccess(
      createPageAccessClient({ data: true, error: null }),
      "settings"
    );

    expect(result).toEqual({ ok: false, reason: "unauthenticated", user: null });
  });

  it("returns forbidden when the page edit check fails", async () => {
    mockedGetCurrentRequestUser.mockResolvedValue({
      id: "5f1a2ef3-c1f2-4ee7-8a1d-6f150dcaa871",
      email: "member@example.com",
      user_metadata: null,
    });

    const result = await getPageEditAccess(
      createPageAccessClient({ data: false, error: null }),
      "settings"
    );

    expect(result).toEqual({ ok: false, reason: "forbidden", user: null });
  });
});
