import {
  createServerClient,
  type CookieOptions,
  type SetAllCookies,
} from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import {
  isSupabaseMissingFunctionError,
  isSupabaseMissingTableError,
} from "@/lib/supabaseErrors";
import { isMutationMethod, pagePermissionKeyForPathname } from "@/lib/pagePermissions";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL as string;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string;

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({
    request,
  });

  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll().map(({ name, value }) => ({ name, value }));
      },
      setAll(cookiesToSet: Parameters<SetAllCookies>[0]) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }

        response = NextResponse.next({
          request,
        });

        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
    cookieOptions: {
      path: "/",
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
    } as CookieOptions,
  });

  const { data: authData } = await supabase.auth.getUser();
  const user = authData.user;

  const pageKey = pagePermissionKeyForPathname(request.nextUrl.pathname);
  if (!user || !pageKey) {
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
    console.error("[middleware.can_view_page]", canViewResult.error.message);
    return NextResponse.json({ error: "Permission check failed." }, { status: 500 });
  }

  if (!canViewResult.error && canViewResult.data === false) {
    if (pageKey !== "dashboard") {
      const redirectUrl = request.nextUrl.clone();
      redirectUrl.pathname = "/dashboard";
      redirectUrl.searchParams.set("error", "No access to that page");
      return NextResponse.redirect(redirectUrl);
    }
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
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
      console.error("[middleware.can_edit_page]", canEditResult.error.message);
      return NextResponse.json({ error: "Permission check failed." }, { status: 500 });
    }

    if (!canEditResult.error && canEditResult.data === false) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  return response;
}
