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
import { requireApiUser, unauthorizedApiResponse } from "./requireApiUser";

const mockedGetCurrentRequestUser = vi.mocked(getCurrentRequestUser);

function createAuthClient() {
  return {
    auth: {
      getUser: vi.fn(),
    },
  };
}

describe("requireApiUser", () => {
  afterEach(() => {
    mockedGetCurrentRequestUser.mockReset();
  });

  it("returns the current user when the request is authenticated", async () => {
    const client = createAuthClient();
    const user = {
      id: "5f1a2ef3-c1f2-4ee7-8a1d-6f150dcaa871",
      email: "user@example.com",
      user_metadata: null,
    };
    mockedGetCurrentRequestUser.mockResolvedValue(user);

    const result = await requireApiUser(client, "api.auth");

    expect(result).toEqual({ user, response: null });
    expect(mockedGetCurrentRequestUser).toHaveBeenCalledWith(client, "api.auth", {
      trustForwardedUserHeaders: false,
    });
  });

  it("returns a consistent unauthorized JSON response when no user is present", async () => {
    mockedGetCurrentRequestUser.mockResolvedValue(null);

    const result = await requireApiUser(createAuthClient());

    expect(result.user).toBeNull();
    if (!result.response) throw new Error("Expected unauthorized response");
    expect(result.response.status).toBe(401);
    await expect(result.response.json()).resolves.toEqual({ error: "Unauthorized" });
  });
});

describe("unauthorizedApiResponse", () => {
  it("supports custom unauthorized messages", async () => {
    const response = unauthorizedApiResponse("Missing session");

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "Missing session" });
  });
});
