import {
  createServerClient,
  type CookieOptions,
  type SetAllCookies,
} from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseCookieOptions } from "@/lib/supabase/cookieOptions";
import { logError, logWarn } from "@/lib/vercelLogger";
import {
  isSupabaseMissingFunctionError,
  isSupabaseMissingTableError,
} from "@/lib/supabaseErrors";
import { isMutationMethod, pagePermissionKeyForPathname } from "@/lib/pagePermissions";
import type { PagePermissionKey } from "@/lib/pagePermissions";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL as string;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string;
const MIDDLEWARE_USER_ID_HEADER = "x-resopshub-user-id";
const MIDDLEWARE_USER_EMAIL_HEADER = "x-resopshub-user-email";
const VIEW_PERMISSION_CACHE_TTL_MS = 5_000;
const VIEW_PERMISSION_CACHE_MAX_ENTRIES = 1000;

type ViewPermissionCacheEntry = {
  allowed: boolean;
  expiresAt: number;
};

const viewPermissionCache = new Map<string, ViewPermissionCacheEntry>();

function buildViewPermissionCacheKey(userId: string, pageKey: PagePermissionKey) {
  return `${userId}:${pageKey}`;
}

function getCachedViewPermission(userId: string, pageKey: PagePermissionKey): boolean | null {
  const key = buildViewPermissionCacheKey(userId, pageKey);
  const entry = viewPermissionCache.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    viewPermissionCache.delete(key);
    return null;
  }
  return entry.allowed;
}

function trimViewPermissionCacheIfNeeded(now: number) {
  if (viewPermissionCache.size <= VIEW_PERMISSION_CACHE_MAX_ENTRIES) return;

  for (const [key, entry] of viewPermissionCache) {
    if (entry.expiresAt <= now) {
      viewPermissionCache.delete(key);
    }
  }

  while (viewPermissionCache.size > VIEW_PERMISSION_CACHE_MAX_ENTRIES) {
    const oldestKey = viewPermissionCache.keys().next().value;
    if (!oldestKey) break;
    viewPermissionCache.delete(oldestKey);
  }
}

function setCachedViewPermission(userId: string, pageKey: PagePermissionKey, allowed: boolean) {
  const now = Date.now();
  const key = buildViewPermissionCacheKey(userId, pageKey);
  viewPermissionCache.set(key, {
    allowed,
    expiresAt: now + VIEW_PERMISSION_CACHE_TTL_MS,
  });
  trimViewPermissionCacheIfNeeded(now);
}

export async function updateSession(request: NextRequest) {
  const requestHeaders = new Headers(request.headers);
  // Never trust client-supplied internal headers.
  requestHeaders.delete(MIDDLEWARE_USER_ID_HEADER);
  requestHeaders.delete(MIDDLEWARE_USER_EMAIL_HEADER);

  let latestCookiesToSet: Parameters<SetAllCookies>[0] = [];
  let response = NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  });

  const rebuildResponse = () => {
    response = NextResponse.next({
      request: {
        headers: requestHeaders,
      },
    });
    for (const { name, value, options } of latestCookiesToSet) {
      response.cookies.set(name, value, options);
    }
  };
  const isPrefetchRequest =
    request.headers.get("purpose") === "prefetch" ||
    request.headers.get("next-router-prefetch") === "1";
  if (isPrefetchRequest) {
    return response;
  }

  const pageKey = pagePermissionKeyForPathname(request.nextUrl.pathname);
  if (!pageKey) {
    return response;
  }

  const requestContext = {
    method: request.method,
    pathname: request.nextUrl.pathname,
    page_key: pageKey,
    request_id: request.headers.get("x-vercel-id"),
  };

  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll().map(({ name, value }) => ({ name, value }));
      },
      setAll(cookiesToSet: Parameters<SetAllCookies>[0]) {
        latestCookiesToSet = cookiesToSet;
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }

        rebuildResponse();

        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
    cookieOptions: getSupabaseCookieOptions() as CookieOptions,
  });

  const { data: authData } = await supabase.auth.getUser();
  const user = authData.user;

  if (user) {
    requestHeaders.set(MIDDLEWARE_USER_ID_HEADER, user.id);
    if (user.email) {
      requestHeaders.set(MIDDLEWARE_USER_EMAIL_HEADER, user.email);
    } else {
      requestHeaders.delete(MIDDLEWARE_USER_EMAIL_HEADER);
    }
    rebuildResponse();
  }

  if (!user) {
    return response;
  }

  if (isMutationMethod(request.method)) {
    const canEditResult = await supabase.rpc("can_edit_page", {
      p_page_key: pageKey,
    });
    if (
      canEditResult.error &&
      !isSupabaseMissingFunctionError(canEditResult.error) &&
      !isSupabaseMissingTableError(canEditResult.error)
    ) {
      logError("middleware.permission_check.edit.error", {
        ...requestContext,
        error: canEditResult.error,
      });
      return NextResponse.json({ error: "Permission check failed." }, { status: 500 });
    }

    if (!canEditResult.error && canEditResult.data === false) {
      logWarn("middleware.permission_check.edit.denied", requestContext);
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    return response;
  }

  const cachedViewPermission = getCachedViewPermission(user.id, pageKey);
  if (cachedViewPermission !== null) {
    if (!cachedViewPermission) {
      logWarn("middleware.permission_check.view.denied.cache", requestContext);
      if (pageKey !== "dashboard") {
        const redirectUrl = request.nextUrl.clone();
        redirectUrl.pathname = "/dashboard";
        redirectUrl.searchParams.set("error", "No access to that page");
        return NextResponse.redirect(redirectUrl);
      }
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    return response;
  }

  const canViewResult = await supabase.rpc("can_view_page", {
    p_page_key: pageKey,
  });
  if (
    canViewResult.error &&
    !isSupabaseMissingFunctionError(canViewResult.error) &&
    !isSupabaseMissingTableError(canViewResult.error)
  ) {
    logError("middleware.permission_check.view.error", {
      ...requestContext,
      error: canViewResult.error,
    });
    return NextResponse.json({ error: "Permission check failed." }, { status: 500 });
  }

  if (!canViewResult.error && canViewResult.data === false) {
    setCachedViewPermission(user.id, pageKey, false);
    logWarn("middleware.permission_check.view.denied", requestContext);
    if (pageKey !== "dashboard") {
      const redirectUrl = request.nextUrl.clone();
      redirectUrl.pathname = "/dashboard";
      redirectUrl.searchParams.set("error", "No access to that page");
      return NextResponse.redirect(redirectUrl);
    }
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (!canViewResult.error && canViewResult.data === true) {
    setCachedViewPermission(user.id, pageKey, true);
  }

  return response;
}
