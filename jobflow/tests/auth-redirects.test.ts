import { describe, expect, it } from 'vitest';

import { redirectForFailure, type AuthFailure } from '@/lib/auth/context';
import { safeReturnPath } from '@/lib/auth/return-path';

/**
 * Regression cover for a redirect loop.
 *
 * The bug: `src/proxy.ts` runs at the edge and can only see that a session
 * cookie *exists*, so it bounces anyone holding one away from /login. The app
 * layout reads the database, and when it rejected a suspended workspace it
 * redirected to /login — which the proxy sent straight back. Six hops and the
 * browser gives up with ERR_TOO_MANY_REDIRECTS, locking a customer out of a
 * product they are paying for with no way to sign in again.
 *
 * The fix is that any failure where the cookie is still cryptographically valid
 * must go through a route handler that clears it first. These cases hold that
 * line: the only reason allowed to redirect straight to /login is the one where
 * there is no cookie to clear.
 */
describe('redirectForFailure', () => {
  it('sends a visitor with no session to /login', () => {
    expect(redirectForFailure('signed_out')).toBe('/login');
  });

  it('preserves where they were headed', () => {
    expect(redirectForFailure('signed_out', '/quotes/abc')).toBe('/login?next=%2Fquotes%2Fabc');
  });

  it.each<AuthFailure>(['suspended', 'removed', 'expired'])(
    'clears the cookie first for %s',
    (reason) => {
      const target = redirectForFailure(reason);

      // Must NOT be a bare /login: that is the loop.
      expect(target).not.toMatch(/^\/login/);
      expect(target).toBe(`/api/auth/session-ended?reason=${reason}`);
    },
  );

  it('never sends a still-valid cookie to a page the proxy guards', () => {
    // The proxy bounces a cookie-holder away from /login and towards
    // /dashboard. A failure route landing on either one loops.
    const guarded = ['/login', '/dashboard'];

    for (const reason of ['suspended', 'removed', 'expired'] as AuthFailure[]) {
      const target = redirectForFailure(reason);
      expect(guarded).not.toContain(target.split('?')[0]);
    }
  });

  it('escapes a return path rather than concatenating it', () => {
    // An unescaped path would let a crafted `next` smuggle extra query
    // parameters into the login URL.
    expect(redirectForFailure('signed_out', '/a?b=c&d=e')).toBe('/login?next=%2Fa%3Fb%3Dc%26d%3De');
  });
});

describe('safeReturnPath', () => {
  it('keeps a path within the site, with its query', () => {
    expect(safeReturnPath('/leads')).toBe('/leads');
    expect(safeReturnPath('/quotes?status=SENT')).toBe('/quotes?status=SENT');
  });

  it('rejects a backslash host, which the old prefix check let through', () => {
    /*
     * The regression that matters. `/\evil.com` starts with '/' and does not
     * start with '//', so the previous guard accepted it — and a URL parser
     * reads the backslash as a slash, making it `https://evil.com/`. Confirmed
     * in a browser: after a real login the router navigated off-site.
     */
    expect(safeReturnPath('/\\evil.com')).toBeUndefined();
    expect(safeReturnPath('/\\/\\evil.com')).toBeUndefined();
    expect(safeReturnPath('/\\\tevil.com')).toBeUndefined();
  });

  it('rejects every other way of naming somewhere else', () => {
    for (const hostile of [
      '//evil.com',
      'https://evil.com',
      'http://evil.com',
      'javascript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      '\\\\evil.com',
      'evil.com',
      '/\r/evil.com',
    ]) {
      expect(safeReturnPath(hostile)).toBeUndefined();
    }
  });

  it('treats an absent or empty value as "no preference"', () => {
    expect(safeReturnPath(undefined)).toBeUndefined();
    expect(safeReturnPath(null)).toBeUndefined();
    expect(safeReturnPath('')).toBeUndefined();
  });

  it('round-trips what the proxy actually writes', () => {
    // The two halves have to agree, or signing in quietly stops returning
    // people to the page they asked for.
    const target = '/customers/abc123?tab=jobs';
    const login = redirectForFailure('signed_out', target);
    const next = new URL(login, 'https://app.example.test').searchParams.get('next');

    expect(safeReturnPath(next)).toBe(target);
  });
});
