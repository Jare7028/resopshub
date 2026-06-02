import { afterEach, describe, expect, it, vi } from "vitest";

describe("clientLogger", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("emits structured browser logs and redacts sensitive fields", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const { logClientError } = await import("./clientLogger");
    logClientError("client.test", {
      token: "secret-token",
      nested: {
        password: "secret-password",
        safe: "visible",
      },
      error: new Error("failed"),
      amount: BigInt(12),
    });

    expect(errorSpy).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(String(errorSpy.mock.calls[0]?.[0]));
    expect(payload).toMatchObject({
      level: "error",
      event: "client.test",
      token: "[redacted]",
      nested: {
        password: "[redacted]",
        safe: "visible",
      },
      error: {
        name: "Error",
        message: "failed",
      },
      amount: "12",
    });
    expect(typeof payload.ts).toBe("string");
  });
});
