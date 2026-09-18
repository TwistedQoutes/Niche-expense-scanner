import { describe, expect, it } from 'vitest';

import { wasNeverConnected } from '@/lib/db/client';

/**
 * Which failures may be retried, and — much more importantly — which may not.
 *
 * Serverless Postgres suspends when idle, so the first query after a quiet spell
 * can fail simply because nobody had woken the server yet. Retrying that is
 * safe: the statement never reached the database, so it cannot run twice.
 *
 * Everything else must not be retried, and this is where that line is drawn. A
 * unique-constraint violation, a query that timed out mid-execution, a dropped
 * connection after the statement was sent — for each of those, "did it commit?"
 * cannot be answered from the client, and guessing wrong means a duplicate
 * write. A quote sent twice is an embarrassment; a card charged twice is a
 * refund and a lost customer.
 */
describe('a database failure that is safe to retry', () => {
  it.each([
    ['Prisma cannot reach the server', { code: 'P1001', message: "Can't reach database server at db:5432" }],
    ['Prisma timed out connecting', { code: 'P1002', message: 'The database server was reached but timed out' }],
    ['the host refused the connection', Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:5432'), { code: 'ECONNREFUSED' })],
    ['the hostname does not resolve', Object.assign(new Error('getaddrinfo ENOTFOUND db.example'), { code: 'ENOTFOUND' })],
    ['the pool gave up waiting', new Error('timeout exceeded when trying to connect')],
  ])('retries when %s', (_label, error) => {
    expect(wasNeverConnected(error)).toBe(true);
  });
});

describe('a database failure that must not be retried', () => {
  it.each([
    ['a unique constraint', { code: 'P2002', message: 'Unique constraint failed on the fields: (`email`)' }],
    ['a row that is not there', { code: 'P2025', message: 'An operation failed because it depends on one or more records that were required but not found' }],
    ['a foreign key', { code: 'P2003', message: 'Foreign key constraint failed on the field' }],
    ['a query cancelled mid-flight', { code: 'P1008', message: 'Operations timed out' }],
    [
      // The dangerous one: the connection dropped, but the statement had already
      // been sent. Whether it committed is unknowable from here.
      'a connection closed after the statement went out',
      { code: 'P1017', message: 'Server has closed the connection' },
    ],
    ['something with no code at all', new Error('Everything is on fire')],
    ['a string, because a thrown value need not be an Error', 'nope'],
  ])('does not retry %s', (_label, error) => {
    expect(wasNeverConnected(error)).toBe(false);
  });
});
