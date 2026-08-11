import createMiddleware from "next-intl/middleware";
import { NextResponse, type NextRequest } from "next/server";
import { routing } from "./i18n/routing";
import {
  isGuestOnlyPath,
  isWorkspacePath,
  isAdminPath,
  safeAdminReturnPath,
  safeWorkspaceReturnPath,
} from "./lib/routing/route-policy";

const intlMiddleware = createMiddleware(routing);

const API_BASE_URL = (
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001/api/v1"
).replace(/\/$/, "");

const SESSION_PATH = "/auth/session";
const LOCALES = routing.locales as readonly string[];
const REFRESH_COOKIE = "refreshToken";
const LOCALE_COOKIE = "NEXT_LOCALE";

function localeFor(request: NextRequest, pathname: string): string {
  const segments = pathname.split("/").filter(Boolean);
  const first = segments[0];
  if (LOCALES.includes(first)) return first;
  const cookieLocale = request.cookies.get(LOCALE_COOKIE)?.value;
  if (cookieLocale && LOCALES.includes(cookieLocale)) return cookieLocale;
  return routing.defaultLocale;
}

type SessionInfo = {
  roles: string[];
};

/**
 * Real server-side session check. Forwards the HttpOnly refresh cookie to the
 * non-rotating `/auth/session` endpoint, which validates it against the stored
 * hash via `JwtRefreshGuard` without issuing or rotating any token. Returning
 * the current roles lets the proxy enforce the admin route boundary before a
 * protected page is rendered.
 */
async function getSession(request: NextRequest): Promise<SessionInfo | null> {
  const refreshToken = request.cookies.get(REFRESH_COOKIE)?.value;
  if (!refreshToken) return null;
  try {
    const response = await fetch(`${API_BASE_URL}${SESSION_PATH}`, {
      method: "GET",
      headers: { cookie: `${REFRESH_COOKIE}=${refreshToken}` },
      cache: "no-store",
    });
    if (!response.ok) return null;

    const body = (await response.json()) as { roles?: unknown };
    if (
      !Array.isArray(body.roles) ||
      !body.roles.every((role) => typeof role === "string")
    ) {
      return null;
    }

    return { roles: body.roles };
  } catch {
    return null;
  }
}

export default async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  if (isWorkspacePath(pathname) || isAdminPath(pathname)) {
    const session = await getSession(request);
    if (!session) {
      const locale = localeFor(request, pathname);
      const from = encodeURIComponent(pathname + (search || ""));
      const loginUrl = request.nextUrl.clone();
      loginUrl.pathname = `/${locale}/login`;
      loginUrl.search = `?from=${from}`;
      return NextResponse.redirect(loginUrl, 302);
    }

    if (isAdminPath(pathname) && !session.roles.includes("ADMIN")) {
      const locale = localeFor(request, pathname);
      return NextResponse.redirect(
        new URL(`/${locale}/dashboard`, request.url),
        302,
      );
    }

    return intlMiddleware(request);
  }

  if (isGuestOnlyPath(pathname) && (await getSession(request))) {
    const locale = localeFor(request, pathname);
    const returnPath =
      safeWorkspaceReturnPath(request.nextUrl.searchParams.get("from")) ??
      safeAdminReturnPath(request.nextUrl.searchParams.get("from")) ??
      "/dashboard";
    return NextResponse.redirect(
      new URL(`/${locale}${returnPath}`, request.url),
      302,
    );
  }

  return intlMiddleware(request);
}

export const config = {
  matcher: [
    "/((?!api|_next/static|_next/image|_vercel|favicon.ico|sitemap.xml|robots.txt|.*\\..*).*)",
  ],
};
