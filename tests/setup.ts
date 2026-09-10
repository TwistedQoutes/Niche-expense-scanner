/**
 * Test environment.
 *
 * `src/lib/env.ts` validates configuration on first read and throws when it is
 * missing, which is the behaviour we want in production and an obstacle in a
 * unit test. Setting the minimum here keeps that strictness intact rather than
 * loosening the schema for the benefit of tests.
 *
 * These are obvious non-secrets, and nothing in the suite opens a connection.
 */
process.env.DATABASE_URL ??= 'postgresql://test@127.0.0.1:5432/test';
process.env.AUTH_SECRET ??= 'test-only-secret-value-that-is-long-enough-000';
// NODE_ENV is typed read-only by @types/node; vitest already sets it to "test".
