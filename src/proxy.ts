import { NextResponse, type NextRequest } from 'next/server';

import { SESSION_COOKIE } from '@/lib/auth/session';

/**
 * Optimistic route protection.
 *
 * (This is the file convention Next 14/15 called `middleware.ts`; Next 16
 * renamed it to `proxy.ts` with a matching `proxy` export.)
 *
 * It only checks that a session cookie is *present* — it deliberately does not
 * verify the signature or read the database. Proxy code runs on every matched
 * request and may execute at a CDN edge, so the real authorisation decision is
 * made in the page or route itself via `requireAuth()`, which also confirms the
 * membership still exists and the workspace is not suspended.
 *
 * A cheap presence check here keeps signed-out visitors from loading an app
 * shell they cannot use, without turning this file into a second, divergent
 * copy of the auth logic. Anything that reads tenant data still authorises
 * itself; nothing trusts this.
 */
const PROTECTED_PREFIXES = [
  '/dashboard',
  '/leads',
  '/customers',
  '/quotes',
  '/jobs',
  '/calendar',
  '/messages',
  '/automations',
  '/reviews',
  '/analytics',
  '/pricing-settings',
  '/settings',
  '/team',
  '/billing',
  '/onboarding',
  '/admin',
];

const AUTH_ROUTES = ['/login', '/signup', '/forgot-password'];

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const hasSessionCookie = Boolean(request.cookies.get(SESSION_COOKIE)?.value);

  if (PROTECTED_PREFIXES.some((prefix) => pathname.startsWith(prefix)) && !hasSessionCookie) {
    const login = new URL('/login', request.url);
    // Remember where they were headed so signing in completes the journey.
    login.searchParams.set('next', `${pathname}${search}`);
    return NextResponse.redirect(login);
  }

  if (AUTH_ROUTES.includes(pathname) && hasSessionCookie) {
    return NextResponse.redirect(new URL('/dashboard', request.url));
  }

  return NextResponse.next();
}

export const config = {
  /**
   * Everything except Next internals and static files.
   *
   * `/quote/…`, `/invite/…` and `/intake/…` are matched but never protected: a
   * customer must be able to open a quote without an account, an invited teammate
   * has no account yet by definition, and the public intake form is
   * the point of lead capture.
   */
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico|manifest.webmanifest).*)'],
};
