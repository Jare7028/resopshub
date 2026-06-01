import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isAuthorizedCronRequest } from "./cron";

const originalCronSecret = process.env.CRON_SECRET;
const originalVercelEnv = process.env.VERCEL_ENV;

function makeRequest(url: string, headers: Record<string, string> = {}) {
  return new Request(url, { headers: new Headers(headers) });
}

describe("isAuthorizedCronRequest", () => {
  beforeEach(() => {
    delete process.env.CRON_SECRET;
    delete process.env.VERCEL_ENV;
  });

  afterEach(() => {
    if (originalCronSecret === undefined) {
      delete process.env.CRON_SECRET;
    } else {
      process.env.CRON_SECRET = originalCronSecret;
    }
    if (originalVercelEnv === undefined) {
      delete process.env.VERCEL_ENV;
    } else {
      process.env.VERCEL_ENV = originalVercelEnv;
    }
  });

  it("authorizes Vercel cron header in production even when CRON_SECRET is not set", () => {
    process.env.VERCEL_ENV = "production";
    const request = makeRequest("https://example.com/api/cron/task-reminders", {
      "x-vercel-cron": "1",
    });
    expect(isAuthorizedCronRequest(request)).toBe(true);
  });

  it("rejects Vercel cron header outside production when CRON_SECRET is not set", () => {
    process.env.VERCEL_ENV = "preview";
    const request = makeRequest("https://example.com/api/cron/task-reminders", {
      "x-vercel-cron": "1",
    });
    expect(isAuthorizedCronRequest(request)).toBe(false);
  });

  it("rejects non-vercel requests when CRON_SECRET is missing", () => {
    const request = makeRequest("https://example.com/api/cron/task-reminders");
    expect(isAuthorizedCronRequest(request)).toBe(false);
  });

  it("authorizes secret provided in query string", () => {
    process.env.CRON_SECRET = "top-secret";
    const request = makeRequest(
      "https://example.com/api/cron/task-reminders?secret=top-secret"
    );
    expect(isAuthorizedCronRequest(request)).toBe(true);
  });

  it("authorizes secret provided in x-cron-secret header", () => {
    process.env.CRON_SECRET = "top-secret";
    const request = makeRequest("https://example.com/api/cron/task-reminders", {
      "x-cron-secret": "top-secret",
    });
    expect(isAuthorizedCronRequest(request)).toBe(true);
  });

  it("authorizes secret provided in x-resopshub-cron-secret header", () => {
    process.env.CRON_SECRET = "top-secret";
    const request = makeRequest("https://example.com/api/cron/task-reminders", {
      "x-resopshub-cron-secret": "top-secret",
    });
    expect(isAuthorizedCronRequest(request)).toBe(true);
  });

  it("authorizes secret provided as bearer token", () => {
    process.env.CRON_SECRET = "top-secret";
    const request = makeRequest("https://example.com/api/cron/task-reminders", {
      authorization: "Bearer top-secret",
    });
    expect(isAuthorizedCronRequest(request)).toBe(true);
  });

  it("rejects mismatched secret values", () => {
    process.env.CRON_SECRET = "top-secret";
    const queryRequest = makeRequest(
      "https://example.com/api/cron/task-reminders?secret=wrong-secret"
    );
    const headerRequest = makeRequest("https://example.com/api/cron/task-reminders", {
      "x-cron-secret": "wrong-secret",
    });
    const bearerRequest = makeRequest("https://example.com/api/cron/task-reminders", {
      authorization: "Bearer wrong-secret",
    });

    expect(isAuthorizedCronRequest(queryRequest)).toBe(false);
    expect(isAuthorizedCronRequest(headerRequest)).toBe(false);
    expect(isAuthorizedCronRequest(bearerRequest)).toBe(false);
  });
});

