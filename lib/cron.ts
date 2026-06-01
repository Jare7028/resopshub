export function isAuthorizedCronRequest(request: Request) {
  // Vercel Cron sends this header; only trust it on production Vercel deployments.
  if (process.env.VERCEL_ENV === "production" && request.headers.get("x-vercel-cron")) {
    return true;
  }

  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return false;
  }

  const url = new URL(request.url);
  const querySecret = url.searchParams.get("secret");
  if (querySecret && querySecret === cronSecret) {
    return true;
  }

  const headerSecret =
    request.headers.get("x-cron-secret") ||
    request.headers.get("x-resopshub-cron-secret");
  if (headerSecret && headerSecret === cronSecret) {
    return true;
  }

  const authHeader = request.headers.get("authorization") || "";
  if (authHeader.toLowerCase().startsWith("bearer ")) {
    const bearerSecret = authHeader.slice(7).trim();
    if (bearerSecret === cronSecret) {
      return true;
    }
  }

  return false;
}

