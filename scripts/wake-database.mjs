#!/usr/bin/env node
/**
 * Wake the database, and prove we can reach it, before a migration tries.
 *
 * Serverless Postgres suspends an idle compute to nothing. The app already knows
 * this — `src/lib/db/client.ts` retries a failed *connection* so the first
 * visitor of the morning does not get an error page for a database that is
 * healthy a heartbeat later. `prisma migrate deploy` knows nothing of the kind:
 * it makes one attempt, and a compute that has been asleep for a week answers
 * the first knock with
 *
 *     Error: P1001: Can't reach database server at `ep-….neon.tech:5432`
 *
 * which reads exactly like a wrong hostname, a firewall, or a deleted database.
 * That is the failure this script exists to tell apart from those, because the
 * remedies could not be more different: one is "wait two seconds", the others
 * are "fix the secret".
 *
 * So: knock until it answers, then get out of the way. And when it truly never
 * answers, say which of the possible causes it actually was, and — for a Neon
 * URL, where the direct and pooled hostnames differ by one word and are easy to
 * derive wrongly by hand — check whether a neighbouring hostname answers
 * instead, since "the endpoint you have is not the one you want" is the other
 * way this step fails.
 *
 * Usage:  node scripts/wake-database.mjs [connection string]
 *         DIRECT_URL=… node scripts/wake-database.mjs
 *
 * Prints nothing that could not go in a public build log: every message names
 * the host, never the password.
 */

import pg from 'pg';

/** Long enough for a cold start on a free tier, short enough to not look hung. */
const BUDGET_MS = Number(process.env.WAKE_BUDGET_MS ?? 90_000);

/**
 * Pauses between knocks, in milliseconds.
 *
 * Front-loaded: a compute that is merely suspended is usually up inside three
 * seconds, and there is no reason to wait ten for it. The long tail is for a
 * project that has been idle long enough that its storage is cold too.
 */
const DELAYS_MS = [500, 1_000, 2_000, 3_000, 5_000, 8_000, 8_000, 10_000, 15_000, 15_000];

/** How long one attempt may spend waiting for a TCP connection and a handshake. */
const ATTEMPT_TIMEOUT_MS = 15_000;

/**
 * The host, the port and the database — and nothing else, ever.
 *
 * This runs in CI, where stdout is a build log that outlives the run and is
 * visible to everyone with read access to the repository. A connection string
 * carries the password, so it never gets printed whole, not even on the error
 * paths where it would be most useful.
 */
export function describe(url) {
  try {
    const parsed = new URL(url);
    const database = parsed.pathname.replace(/^\//, '') || '(default)';
    return `${parsed.hostname}:${parsed.port || '5432'}/${database}`;
  } catch {
    return '(unparseable connection string)';
  }
}

/**
 * Hostnames worth trying when the one we were given cannot be reached.
 *
 * Neon hands out two connection strings that differ by one word: the pooled one
 * carries `-pooler` in the hostname and belongs in `DATABASE_URL`, and the
 * direct one, which migrations need, does not. Deriving the second from the
 * first by hand is the documented way to get it, and it is one keystroke away
 * from a hostname that resolves — Neon wildcards the domain — but routes
 * nowhere.
 *
 * So if the given host does not answer, these do the experiment the operator
 * would otherwise do by hand: try the sibling hostnames, and report which one
 * works so the fix is a specific edit to a specific secret rather than a guess.
 *
 * Returned in the order they are worth trying, and the original is never
 * repeated.
 */
export function siblingHosts(url) {
  let host;
  try {
    host = new URL(url).hostname;
  } catch {
    return [];
  }

  // Only Neon's endpoint hostnames have a derivable sibling. Somebody else's
  // Postgres gets no guesses: inventing hostnames for it would be noise.
  if (!/^ep-/.test(host)) return [];

  const candidates = [
    // Dropping the pooler: the single most common mix-up, and the one deploy.sh
    // already refuses outright when it is obvious.
    host.replace('-pooler.', '.'),
    // Some projects' direct endpoint sits on the bare regional domain rather
    // than under the cluster label that the pooled hostname carries.
    host.replace(/\.c-\d+\./, '.'),
    // And the reverse, which tells us something useful even though we would not
    // migrate through it: if only the pooled host answers, the direct hostname
    // in DIRECT_URL is wrong, rather than the database being asleep.
    host.includes('-pooler.') ? null : host.replace(/^(ep-[^.]+)\./, '$1-pooler.'),
  ];

  return [...new Set(candidates.filter((candidate) => candidate && candidate !== host))];
}

function withHost(url, host) {
  const parsed = new URL(url);
  parsed.hostname = host;
  return parsed.toString();
}

/**
 * One knock.
 *
 * Resolves to `null` when the database answered, or to the error when it did
 * not. A plain `SELECT 1` rather than a bare connection, because Neon's pooler
 * will accept a TCP connection while the compute behind it is still starting —
 * connecting is not the same as being able to run a statement.
 */
async function knock(url) {
  const client = new pg.Client({
    connectionString: url,
    connectionTimeoutMillis: ATTEMPT_TIMEOUT_MS,
    query_timeout: ATTEMPT_TIMEOUT_MS,
    statement_timeout: ATTEMPT_TIMEOUT_MS,
  });

  try {
    await client.connect();
    await client.query('SELECT 1');
    return null;
  } catch (error) {
    return error;
  } finally {
    await client.end().catch(() => {});
  }
}

/**
 * What kind of failure this is — which is the whole point of the script.
 *
 * `asleep` is the recoverable one: keep knocking. Everything else is a fact
 * about the configuration that will not change however long we wait, so saying
 * so immediately is better than spending the budget to reach the same answer.
 */
export function classify(error) {
  const code = String(error?.code ?? '');
  const message = String(error?.message ?? error ?? '');

  if (code === '28P01' || /password authentication failed/i.test(message)) {
    return {
      kind: 'credentials',
      advice:
        'The host is right and the password is not. Copy the connection string again from your database provider — and if you have rotated the password since, that is why.',
    };
  }

  if (code === '3D000' || /database .* does not exist/i.test(message)) {
    return {
      kind: 'database',
      advice: 'Reached the server, but there is no database by that name. Check the path at the end of the URL.',
    };
  }

  if (code === '28000' || /no pg_hba\.conf entry|SSL|certificate/i.test(message)) {
    return {
      kind: 'tls',
      advice: 'The server refused the connection settings. A managed host almost always needs ?sslmode=require on the end of the URL.',
    };
  }

  if (code === 'ENOTFOUND' || /getaddrinfo/i.test(message)) {
    return { kind: 'hostname', advice: 'That hostname does not resolve. It is a typo, or the database has been deleted.' };
  }

  // ECONNREFUSED, ETIMEDOUT, ECONNRESET, "Connection terminated unexpectedly",
  // "timeout expired" — every one of which is what a suspended compute, a
  // cold-starting one, and an unroutable endpoint all look like from here. They
  // are only told apart by whether knocking again eventually works.
  return { kind: 'asleep', advice: null };
}

async function reachable(url, { label }) {
  const startedAt = Date.now();
  let announced = false;

  for (let attempt = 0; ; attempt += 1) {
    const error = await knock(url);
    if (!error) {
      const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);
      console.log(`  ${label} answered after ${seconds}s`);
      return { ok: true };
    }

    const verdict = classify(error);
    if (verdict.kind !== 'asleep') {
      console.log(`  ${label}: ${verdict.kind}`);
      return { ok: false, verdict, error };
    }

    const delay = DELAYS_MS[attempt];
    const spent = Date.now() - startedAt;
    if (delay === undefined || spent + delay > BUDGET_MS) {
      return { ok: false, verdict, error };
    }

    if (!announced) {
      // Said once. A line per attempt turns a two-second wake into a wall of
      // text that looks like something going wrong.
      console.log(`  ${label} did not answer; it may be asleep — knocking until it does`);
      announced = true;
    }

    await new Promise((resolve) => setTimeout(resolve, delay));
  }
}

async function main() {
  const url = process.argv[2] || process.env.DIRECT_URL || process.env.DATABASE_URL;

  if (!url) {
    console.error('Nothing to connect to: pass a connection string, or set DIRECT_URL.');
    process.exit(2);
  }

  console.log(`Reaching ${describe(url)}`);

  const first = await reachable(url, { label: 'It' });
  if (first.ok) {
    console.log('Database is awake.');
    return;
  }

  console.error(`\nCould not reach ${describe(url)}.`);

  if (first.verdict.advice) {
    console.error(`\n${first.verdict.advice}`);
    process.exit(1);
  }

  /*
   * It never answered, and the reason is one of several that look identical from
   * outside. Before blaming the network, find out whether a sibling hostname
   * answers — because if one does, nothing is broken except one word in one
   * secret, and that is a two-minute fix rather than a support ticket.
   */
  const siblings = siblingHosts(url);
  if (siblings.length > 0) {
    console.error('\nTrying the neighbouring hostnames, in case this is the wrong endpoint:');
  }

  for (const host of siblings) {
    // One knock each, with no patience: this is a question about routing, and a
    // wake we have already waited out above.
    const error = await knock(withHost(url, host));
    if (error && classify(error).kind === 'asleep') {
      console.error(`  ${host} — no`);
      continue;
    }

    const pooled = host.includes('-pooler.');
    console.error(`  ${host} — YES, this one answers`);
    console.error(
      pooled
        ? `\nOnly the POOLED endpoint answers, so DIRECT_URL is pointing at a direct endpoint that does not exist.\nGet the direct string from your provider (Neon: the connection details panel with pooling switched off)\nand put it in DIRECT_URL. Leave DATABASE_URL pooled.`
        : `\nFix: set DIRECT_URL to the same string with the host ${host}.\nEverything else about it — user, password, database, query string — stays as it is.`,
    );
    process.exit(1);
  }

  console.error(`
Nothing answered within ${Math.round(BUDGET_MS / 1000)}s. In order of likelihood:

  1. The database is suspended and slow to start, or the project is paused.
     Open it in your provider's console — loading the dashboard usually wakes it —
     then run this again.
  2. The hostname is right but unroutable from here. Some providers block
     connections from outside their own network until you allow the address.
  3. The database has been deleted, or the branch it lived on has.

The last error was: ${String(first.error?.message ?? first.error).slice(0, 300)}`);
  process.exit(1);
}

// Importable for its two pure functions without connecting to anything.
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
