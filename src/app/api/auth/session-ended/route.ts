import { NextResponse } from 'next/server';

import { withRoute } from '@/lib/api/handler';
import { clearSessionCookie } from '@/lib/auth/session';
import { getEnv } from '@/lib/env';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Reasons a session can stop working while its cookie is still valid. */
const REASONS: Record<string, string> = {
  suspended: 'This workspace is suspended. Please contact support.',
  removed: 'Your access to this workspace has ended.',
  expired: 'Your session has ended. Please sign in again.',
};

/**
 * Ends a session that is cryptographically valid but no longer usable, then
 * sends the user to sign in.
 *
 * This route exists to break a redirect loop, and the loop is worth describing
 * because it is not obvious. `src/proxy.ts` runs at the edge and can only see
 * that a session cookie *exists*, so it bounces anyone holding one away from
 * /login. The real check happens in the app layout, which reads the database —
 * and when it rejects a suspended workspace or a removed teammate it redirects
 * to /login. The proxy then sends them straight back. Neither side is wrong on
 * its own; together they spin forever.
 *
 * A page cannot break the cycle itself: cookies can only be written from a
 * route handler or a server action, never during a render. So the layout sends
 * the browser here, the cookie is cleared, and the next hop to /login finds no
 * cookie and stops.
 */
export const GET = withRoute(async (request) => {
  const reason = new URL(request.url).searchParams.get('reason') ?? 'expired';
  // Looked up in a fixed table rather than echoed: a message taken straight
  // from the query string is a reflected-content hole and an open invitation to
  // phrase a phishing prompt in our own voice.
  const message = REASONS[reason] ?? REASONS.expired!;

  await clearSessionCookie();

  const login = new URL('/login', getEnv().APP_URL);
  login.searchParams.set('ended', message);

  return NextResponse.redirect(login, {
    // 303: the browser must follow with GET regardless of how it got here.
    status: 303,
    headers: { 'Cache-Control': 'no-store' },
  });
});
