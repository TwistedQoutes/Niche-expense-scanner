import { NextResponse, type NextRequest } from 'next/server';

import { SESSION_COOKIE } from '@/lib/auth/session';

/**
 * Optimistic route protection.
 *
 * (This is the file convention Next 14/15 called `middleware.ts`; Next 16
 * renamed it to `proxy.ts` with a matching `proxy` export.)
 *
 * It only checks that a session cookie is *present* — it deliberately does not
 * verify the signature. Proxy code runs on every matched request and may be
 * deployed to a CDN edge, so the real authorisation decision is made in the
 * page/route itself via `requireUser()`, which also confirms the user still
 * exists. A cheap presence check here keeps signed-out visitors from loading an
 * app shell they cannot use, without turning this file into a second,
 * divergent copy of the auth logic.
 */
const PROTECTED_PREFIXES = ['/dashboard', '/scan', '/settings'];
const AUTH_ROUTES = ['/login', '/signup'];

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const hasSessionCookie = Boolean(request.cookies.get(SESSION_COOKIE)?.value);

  if (PROTECTED_PREFIXES.some((prefix) => pathname.startsWith(prefix)) && !hasSessionCookie) {
    const login = new URL('/login', request.url);
    // Remember where they were headed so sign-in can complete the journey.
    login.searchParams.set('next', `${pathname}${search}`);
    return NextResponse.redirect(login);
  }

  if (AUTH_ROUTES.includes(pathname) && hasSessionCookie) {
    return NextResponse.redirect(new URL('/dashboard', request.url));
  }

  return NextResponse.next();
}

export const config = {
  // Everything except Next internals, the OCR assets and static files.
  matcher: ['/((?!api|_next/static|_next/image|ocr|favicon.ico|manifest.webmanifest).*)'],
};
