import { NextResponse, type NextRequest } from "next/server";
import { getAuthSession } from "@db/services/auth/session";

const publicExact = new Set([
  "/sign-in",
  "/sign-in/device",
  "/get-started",
  "/welcome",
  "/pricing",
  "/docs",
  "/api/channels/telegram",
  "/api/channels/kapso",
  "/eve/v1/health",
  "/eve/v1/dev/schedules/dynamic",
]);

function isPublicPath(pathname: string) {
  if (publicExact.has(pathname)) return true;
  if (pathname.startsWith("/api/auth/")) return true;
  if (pathname.startsWith("/internal/scheduled-run/")) return true;
  return false;
}

export async function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;

  if (isPublicPath(pathname)) {
    return NextResponse.next();
  }

  if (await getAuthSession(request.headers)) {
    return NextResponse.next();
  }

  // Unauthenticated visitors hitting home see the marketing landing.
  if (pathname === "/") {
    return NextResponse.redirect(new URL("/welcome", request.url));
  }

  const signInUrl = new URL("/sign-in", request.url);
  signInUrl.searchParams.set(
    "callbackUrl",
    `${request.nextUrl.pathname}${request.nextUrl.search}`
  );
  return NextResponse.redirect(signInUrl);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|fonts|favicon.ico).*)"],
};
