import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({
  headers: vi.fn(),
}));

import { headers } from "next/headers";
import { getCurrentRequestUser } from "./currentUser";

const mockedHeaders = vi.mocked(headers);

function mockRequestHeaders(values: Record<string, string>) {
  mockedHeaders.mockResolvedValue(
    new Headers(values) as Awaited<ReturnType<typeof headers>>
  );
}

function createAuthClient(user: {
  id: string;
  email?: string | null;
  user_metadata?: Record<string, unknown> | null;
} | null) {
  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user } }),
    },
  };
}

describe("getCurrentRequestUser", () => {
  afterEach(() => {
    mockedHeaders.mockReset();
  });

  it("uses verified middleware user headers without another Supabase auth call", async () => {
    const client = createAuthClient({
      id: "7b36d72b-979c-4bd3-930e-d3bfc809ffb9",
      email: "fallback@example.com",
    });
    mockRequestHeaders({
      "x-resopshub-user-id": "67baf56a-5f60-4f4d-9c20-4874b9cf7d7b",
      "x-resopshub-user-email": "header@example.com",
    });

    await expect(getCurrentRequestUser(client)).resolves.toEqual({
      id: "67baf56a-5f60-4f4d-9c20-4874b9cf7d7b",
      email: "header@example.com",
      user_metadata: null,
    });
    expect(client.auth.getUser).not.toHaveBeenCalled();
  });

  it("falls back to Supabase auth when the forwarded user id is missing or invalid", async () => {
    const client = createAuthClient({
      id: "91b0bb1d-4443-4a88-8651-8f9d52df3274",
      email: "verified@example.com",
      user_metadata: { role: "admin" },
    });
    mockRequestHeaders({
      "x-resopshub-user-id": "not-a-user-id",
      "x-resopshub-user-email": "spoofed@example.com",
    });

    await expect(getCurrentRequestUser(client, "test.auth")).resolves.toEqual({
      id: "91b0bb1d-4443-4a88-8651-8f9d52df3274",
      email: "verified@example.com",
      user_metadata: { role: "admin" },
    });
    expect(client.auth.getUser).toHaveBeenCalledTimes(1);
  });

  it("returns null when neither middleware headers nor Supabase auth identify a user", async () => {
    const client = createAuthClient(null);
    mockRequestHeaders({});

    await expect(getCurrentRequestUser(client)).resolves.toBeNull();
  });
});
