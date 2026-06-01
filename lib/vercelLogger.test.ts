import { afterEach, describe, expect, it, vi } from "vitest";

describe("vercelLogger", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("emits structured JSON and redacts sensitive fields", async () => {
    vi.stubEnv("LOG_LEVEL", "debug");
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("VERCEL_REGION", "lhr1");
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => undefined);

    const { logInfo } = await import("./vercelLogger");
    logInfo("test.event", {
      count: 2,
      token: "secret-token",
      nested: {
        password: "secret-password",
        safe: "visible",
      },
    });

    expect(infoSpy).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(String(infoSpy.mock.calls[0]?.[0]));
    expect(payload).toMatchObject({
      level: "info",
      event: "test.event",
      vercel_env: "preview",
      vercel_region: "lhr1",
      count: 2,
      token: "[redacted]",
      nested: {
        password: "[redacted]",
        safe: "visible",
      },
    });
    expect(typeof payload.ts).toBe("string");
  });

  it("respects the configured minimum log level", async () => {
    vi.stubEnv("LOG_LEVEL", "warn");
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const { logInfo, logWarn } = await import("./vercelLogger");
    logInfo("test.info");
    logWarn("test.warn");

    expect(infoSpy).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(warnSpy.mock.calls[0]?.[0]))).toMatchObject({
      level: "warn",
      event: "test.warn",
    });
  });

  it("serializes errors and bigint values safely", async () => {
    vi.stubEnv("LOG_LEVEL", "error");
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const { logError } = await import("./vercelLogger");
    logError("test.error", {
      error: new Error("failed"),
      amount: BigInt(25),
    });

    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(errorSpy.mock.calls[0]?.[0]))).toMatchObject({
      level: "error",
      event: "test.error",
      amount: "25",
      error: {
        name: "Error",
        message: "failed",
      },
    });
  });
});
