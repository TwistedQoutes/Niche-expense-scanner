import { cookies } from 'next/headers';
import { SignJWT, jwtVerify } from 'jose';

import { getEnv } from '@/lib/env';

export const SESSION_COOKIE = 'jobflow_session';

const ISSUER = 'jobflow-ai';
const AUDIENCE = 'jobflow-ai:app';

/**
 * What a signed-in request carries.
 *
 * `organizationId` is in the token rather than resolved per request from a URL
 * or a header, and that is the whole tenancy story in one decision: the tenant
 * a request acts in is decided at sign-in, by the server, and a client has no
 * input into it. Every tenant-scoped query is built from this value (see
 * `forOrganization` in src/lib/db/tenant.ts), so there is no code path where a
 * user-supplied id could select the tenant.
 */
export type SessionPayload = {
  userId: string;
  email: string;
  organizationId: string;
  /**
   * The user's `sessionVersion` when this token was issued.
   *
   * A JWT is self-contained, which normally means it cannot be revoked before
   * it expires — so a password change would leave a stolen session valid for up
   * to a week. Carrying the version here and comparing it against the database
   * on each request makes revocation possible without a session table.
   */
  sessionVersion: number;
};

function secretKey(): Uint8Array {
  return new TextEncoder().encode(getEnv().AUTH_SECRET);
}

export async function createSessionToken(payload: SessionPayload): Promise<string> {
  const { SESSION_MAX_AGE } = getEnv();

  return new SignJWT({
    email: payload.email,
    org: payload.organizationId,
    sv: payload.sessionVersion,
  })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(payload.userId)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_MAX_AGE}s`)
    .sign(secretKey());
}

/** Verifies signature, issuer, audience and expiry. Returns null on any failure. */
export async function verifySessionToken(token: string): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, secretKey(), {
      issuer: ISSUER,
      audience: AUDIENCE,
      algorithms: ['HS256'],
    });

    if (
      typeof payload.sub !== 'string' ||
      typeof payload.email !== 'string' ||
      typeof payload.org !== 'string'
    ) {
      // A token without an organization cannot be scoped to one, and falling
      // back to "any organization" is precisely the bug this design exists to
      // prevent. Reject it and make them sign in again.
      return null;
    }

    const sessionVersion = typeof payload.sv === 'number' ? payload.sv : 0;

    return {
      userId: payload.sub,
      email: payload.email,
      organizationId: payload.org,
      sessionVersion,
    };
  } catch {
    // Expired, tampered with, or signed by a rotated secret — all the same to us.
    return null;
  }
}

export async function setSessionCookie(token: string): Promise<void> {
  const env = getEnv();
  const cookieStore = await cookies();

  cookieStore.set(SESSION_COOKIE, token, {
    httpOnly: true, // not readable from JavaScript → XSS cannot exfiltrate it
    sameSite: 'lax', // blocks cross-site POSTs while keeping normal navigation
    secure: env.NODE_ENV === 'production',
    path: '/',
    maxAge: env.SESSION_MAX_AGE,
  });
}

export async function clearSessionCookie(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, '', {
    httpOnly: true,
    sameSite: 'lax',
    secure: getEnv().NODE_ENV === 'production',
    path: '/',
    maxAge: 0,
  });
}

/** Reads and verifies the session from the incoming request's cookies. */
export async function getSession(): Promise<SessionPayload | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return verifySessionToken(token);
}
