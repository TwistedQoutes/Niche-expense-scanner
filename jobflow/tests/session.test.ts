import { describe, expect, it, vi } from 'vitest';

// `next/headers` only exists inside a request; these cases exercise the token
// itself, which is the part that carries the tenant.
vi.mock('next/headers', () => ({ cookies: () => Promise.reject(new Error('no request')) }));

const { createSessionToken, verifySessionToken } = await import('@/lib/auth/session');

const PAYLOAD = {
  userId: 'user_alpha',
  email: 'dana@greenthumb.example',
  organizationId: 'org_alpha',
  sessionVersion: 3,
};

describe('session tokens', () => {
  it('round-trips every claim, including the organization', async () => {
    const token = await createSessionToken(PAYLOAD);
    await expect(verifySessionToken(token)).resolves.toEqual(PAYLOAD);
  });

  it('rejects a tampered signature', async () => {
    const token = await createSessionToken(PAYLOAD);
    // Flip the last character of the signature.
    const forged = `${token.slice(0, -1)}${token.at(-1) === 'A' ? 'B' : 'A'}`;

    await expect(verifySessionToken(forged)).resolves.toBeNull();
  });

  it('rejects a token signed with a different secret', async () => {
    const token = await createSessionToken(PAYLOAD);

    const { resetEnvCache } = await import('@/lib/env');
    const original = process.env.AUTH_SECRET;

    try {
      process.env.AUTH_SECRET = 'a-completely-different-secret-long-enough-xx';
      resetEnvCache();

      // Secret rotation must invalidate outstanding sessions, not silently
      // accept them.
      await expect(verifySessionToken(token)).resolves.toBeNull();
    } finally {
      process.env.AUTH_SECRET = original;
      resetEnvCache();
    }
  });

  it.each(['', 'not-a-jwt', 'a.b.c'])('rejects malformed input %j', async (input) => {
    await expect(verifySessionToken(input)).resolves.toBeNull();
  });

  it('preserves the session version so revocation can be detected', async () => {
    const token = await createSessionToken({ ...PAYLOAD, sessionVersion: 42 });
    const verified = await verifySessionToken(token);

    // requireAuth compares this against the database; if it did not survive the
    // round trip, a password change would not end an attacker's session.
    expect(verified?.sessionVersion).toBe(42);
  });

  it('rejects a token with no organization claim', async () => {
    // Hand-built to simulate a token from before tenancy existed. Falling back
    // to "any organization" is precisely the bug the design prevents, so such a
    // token must be refused rather than accepted with a guess.
    const { SignJWT } = await import('jose');
    const secret = new TextEncoder().encode(process.env.AUTH_SECRET);

    const token = await new SignJWT({ email: PAYLOAD.email, sv: 0 })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setSubject(PAYLOAD.userId)
      .setIssuer('jobflow-ai')
      .setAudience('jobflow-ai:app')
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(secret);

    await expect(verifySessionToken(token)).resolves.toBeNull();
  });

  it('rejects a token minted for a different audience', async () => {
    const { SignJWT } = await import('jose');
    const secret = new TextEncoder().encode(process.env.AUTH_SECRET);

    const token = await new SignJWT({ email: PAYLOAD.email, org: 'org_alpha', sv: 0 })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setSubject(PAYLOAD.userId)
      .setIssuer('jobflow-ai')
      .setAudience('some-other-service')
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(secret);

    await expect(verifySessionToken(token)).resolves.toBeNull();
  });

  it('rejects an expired token', async () => {
    const { SignJWT } = await import('jose');
    const secret = new TextEncoder().encode(process.env.AUTH_SECRET);

    const token = await new SignJWT({ email: PAYLOAD.email, org: 'org_alpha', sv: 0 })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setSubject(PAYLOAD.userId)
      .setIssuer('jobflow-ai')
      .setAudience('jobflow-ai:app')
      .setIssuedAt(Math.floor(Date.now() / 1000) - 7200)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 3600)
      .sign(secret);

    await expect(verifySessionToken(token)).resolves.toBeNull();
  });
});
