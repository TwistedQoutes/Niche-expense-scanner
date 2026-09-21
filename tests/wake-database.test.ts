import { describe, expect, it } from 'vitest';

// A deploy script, so it is plain JavaScript rather than TypeScript, and these
// three functions are the parts of it that can be tested without a database.
import { classify, describe as describeUrl, passwordShape, siblingHosts } from '../scripts/wake-database.mjs';

/**
 * Telling a sleeping database apart from a broken secret.
 *
 * This is the whole job of the preflight, and it is worth testing because
 * getting it wrong is expensive in both directions. Treat a wrong password as a
 * cold start and the deploy spends ninety seconds knocking before reporting the
 * least useful version of the truth. Treat a cold start as a wrong password and
 * an operator goes off to regenerate credentials that were never the problem —
 * which is exactly what happened on the run that prompted writing this: a
 * suspended Neon compute answered the first knock with "can't reach database
 * server", the same sentence it would use for a typo in the hostname.
 */

const failure = (code: string, message = '') => Object.assign(new Error(message), { code });

describe('what kind of failure this is', () => {
  it('keeps knocking when the connection was refused', () => {
    // The recoverable case: a compute that is starting refuses, resets, or simply
    // never answers, and the only way to tell that from a dead endpoint is to ask
    // again in a second.
    for (const code of ['ECONNREFUSED', 'ETIMEDOUT', 'ECONNRESET']) {
      expect(classify(failure(code)).kind).toBe('asleep');
    }

    // node-postgres reports the pool's own patience running out as a message
    // rather than a code.
    expect(classify(new Error('Connection terminated unexpectedly')).kind).toBe('asleep');
    expect(classify(new Error('timeout expired')).kind).toBe('asleep');
  });

  it.each([
    ['a rejected password', failure('28P01', 'password authentication failed for user "x"'), 'credentials'],
    ['a database that is not there', failure('3D000', 'database "nope" does not exist'), 'database'],
    ['a refused TLS setting', failure('28000', 'no pg_hba.conf entry for host'), 'tls'],
    ['a hostname that does not resolve', failure('ENOTFOUND', 'getaddrinfo ENOTFOUND db.example'), 'hostname'],
  ])('stops immediately on %s', (_label, error, kind) => {
    const verdict = classify(error);

    expect(verdict.kind).toBe(kind);
    // Waiting cannot fix any of these, so each one has to arrive with the thing
    // to go and change.
    expect(verdict.advice).toBeTruthy();
  });

  it('offers no advice for the case where waiting is the advice', () => {
    expect(classify(failure('ECONNREFUSED')).advice).toBeNull();
  });
});

describe('the hostnames worth trying instead', () => {
  const pooled = 'postgresql://u:p@ep-snowy-heart-b5jfxdgu-pooler.c-7.us-east-2.aws.neon.tech/neondb';
  const direct = 'postgresql://u:p@ep-snowy-heart-b5jfxdgu.c-7.us-east-2.aws.neon.tech/neondb';

  it('drops the pooler, which is the usual mix-up', () => {
    expect(siblingHosts(pooled)).toContain('ep-snowy-heart-b5jfxdgu.c-7.us-east-2.aws.neon.tech');
  });

  it('tries the bare regional host, and the pooled one, for a direct URL that will not connect', () => {
    // The second is not somewhere we would migrate, but it answers the question
    // that matters: is the database asleep, or is this hostname wrong?
    expect(siblingHosts(direct)).toEqual([
      'ep-snowy-heart-b5jfxdgu.us-east-2.aws.neon.tech',
      'ep-snowy-heart-b5jfxdgu-pooler.c-7.us-east-2.aws.neon.tech',
    ]);
  });

  it('never suggests the host it was given', () => {
    for (const url of [pooled, direct]) {
      expect(siblingHosts(url)).not.toContain(new URL(url).hostname);
    }
  });

  it('guesses nothing for a Postgres that is not Neon', () => {
    // Inventing hostnames for somebody's own server would be noise at best and
    // misleading at worst.
    expect(siblingHosts('postgresql://u:p@db.internal.example.com:5432/app')).toEqual([]);
    expect(siblingHosts('postgresql://u:p@localhost:5432/app')).toEqual([]);
  });

  it('does not throw on a connection string that is not a URL', () => {
    expect(siblingHosts('host=db port=5432')).toEqual([]);
  });
});

describe('what gets printed', () => {
  it('names the host and the database, and never the password', () => {
    const shown = describeUrl('postgresql://neondb_owner:npg_secret_password@db.example.com:5432/neondb?sslmode=require');

    expect(shown).toBe('db.example.com:5432/neondb');
    /*
     * This runs in CI, where stdout is a build log that outlives the run. A
     * password printed there is a password to rotate, so the redaction is the
     * assertion — not the formatting.
     */
    expect(shown).not.toContain('npg_secret_password');
    expect(shown).not.toContain('neondb_owner');
  });

  it('assumes the default port when the URL leaves it out', () => {
    expect(describeUrl('postgresql://u:p@db.example.com/app')).toBe('db.example.com:5432/app');
  });

  it('says so rather than throwing when the string is not a URL at all', () => {
    // A secret pasted with a line break lands here, and the deploy should say
    // which of its inputs is malformed rather than dying in a stack trace.
    expect(describeUrl('not a url')).toBe('(unparseable connection string)');
  });
});

describe('the shape of a password that was rejected', () => {
  // Why this exists: "the password is wrong" has several causes that look
  // identical from the database's side, and two of them are paste accidents with
  // a visible signature. Naming the signature is the difference between a fix and
  // another round of guessing.

  it('recognises the mask copied instead of the password', () => {
    // Selecting the field by hand while it is still hidden. The most common of
    // these, and the one that looks least like a paste problem.
    const shape = passwordShape('postgresql://neondb_owner:%E2%80%A2%E2%80%A2%E2%80%A2%E2%80%A2%E2%80%A2%E2%80%A2@host/db');

    expect(shape).toContain('MASK');
    expect(shape).toMatch(/copy button|reveal/);
  });

  it('recognises asterisks too, which is how some consoles mask', () => {
    expect(passwordShape('postgresql://u:********@host/db')).toContain('MASK');
  });

  it('points at whitespace dragged along by the copy', () => {
    expect(passwordShape('postgresql://u:npg_abc%20def@host/db')).toContain('space');
  });

  it('says when the string carries no password at all', () => {
    expect(passwordShape('postgresql://neondb_owner@host/db')).toContain('no password');
  });

  it('describes a normal Neon password by its shape and nothing else', () => {
    // No English in the fixture: a word inside it would collide with the prose of
    // the message and fail the leak check for the wrong reason.
    const secret = 'npg_7Kq2ZxV9mTbR4wLd';
    const shape = passwordShape(`postgresql://neondb_owner:${secret}@host/db`);

    expect(shape).toContain('20 characters');
    expect(shape).toContain('starts with npg_');
    /*
     * The assertion that matters: this line goes into a public build log, so the
     * shape must not be the thing itself. Every four-character run of the secret
     * part is checked, because a description that happened to quote a piece of it
     * would be a leak nobody noticed.
     *
     * The `npg_` prefix is excluded, and only that: it is a constant Neon puts on
     * every password it issues, so naming it tells an attacker what the provider
     * already documents. Everything after it is the secret.
     */
    const secretPart = secret.slice('npg_'.length);
    for (let i = 0; i + 4 <= secretPart.length; i += 1) {
      expect(shape).not.toContain(secretPart.slice(i, i + 4));
    }
  });

  it('notices a password that is not a Neon one', () => {
    expect(passwordShape('postgresql://u:hunter2@host/db')).toContain('does not start with npg_');
  });

  it('does not throw on a string that is not a URL', () => {
    expect(passwordShape('host=db user=postgres')).toContain('does not parse');
  });
});
