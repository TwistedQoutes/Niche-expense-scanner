import { cookies } from 'next/headers';
import { SignJWT, jwtVerify } from 'jose';

import { getEnv } from '@/lib/env';

export const SESSION_COOKIE = 'nes_session';

const ISSUER = 'niche-expense-scanner';
const AUDIENCE = 'niche-expense-scanner:app';

export type SessionPayload = {
  userId: string;
  email: string;
};

function secretKey(): Uint8Array {
  return new TextEncoder().encode(getEnv().AUTH_SECRET);
}

export async function createSessionToken(payload: SessionPayload): Promise<string> {
  const { SESSION_MAX_AGE } = getEnv();

  return new SignJWT({ email: payload.email })
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

    if (typeof payload.sub !== 'string' || typeof payload.email !== 'string') {
      return null;
    }

    return { userId: payload.sub, email: payload.email };
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
