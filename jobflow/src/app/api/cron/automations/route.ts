import { AppError } from '@/lib/api/errors';
import { withRoute } from '@/lib/api/handler';
import { jsonOk } from '@/lib/api/response';
import { runDueAutomations } from '@/lib/automations/worker';
import { runReactivationSweepForAll } from '@/lib/reviews/repository';
import { getEnv } from '@/lib/env';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * The automation worker's trigger. Call it on a schedule.
 *
 * On Vercel, a cron entry in vercel.json; anywhere else, a minutely curl from
 * whatever scheduler you have. Every minute is fine — the work is bounded and a
 * pass with nothing due costs one indexed query.
 *
 * Authorisation is a shared secret, and the endpoint **refuses to run without
 * one configured**. An unauthenticated endpoint that sends SMS on demand is a
 * stranger spending our customers' messaging allowance, and "nobody will guess
 * the URL" is not an access control.
 *
 * Accepts the secret as a bearer token or as Vercel's `x-vercel-cron` style
 * header value; POST and GET both work, because schedulers differ on which they
 * send and a 405 at 3am is a silent outage.
 *
 * `?sweep=1` additionally runs the reactivation sweep. Schedule that one daily,
 * not minutely.
 */
async function handle(request: Request): Promise<Response> {
  const env = getEnv();

  if (!env.CRON_SECRET) {
    throw new AppError(
      'not_implemented',
      'CRON_SECRET is not set, so the automation worker is disabled. Set it to enable scheduled follow-ups.',
    );
  }

  const header = request.headers.get('authorization') ?? '';
  const bearer = header.startsWith('Bearer ') ? header.slice(7) : null;
  const supplied = bearer ?? request.headers.get('x-cron-secret');

  if (!supplied || !timingSafeEqual(supplied, env.CRON_SECRET)) {
    // Deliberately terse: a prober learns only that they were refused.
    throw new AppError('unauthorized', 'Not authorised.');
  }

  const report = await runDueAutomations();

  /*
   * The reactivation sweep runs on its own, slower schedule, asked for with
   * `?sweep=1` (see vercel.json). Who counts as lapsed changes by the day, not by
   * the minute, so running it on every pass would be one extra query per
   * workspace per minute to reach the same answer.
   */
  const wantsSweep = new URL(request.url).searchParams.get('sweep') === '1';
  const sweep = wantsSweep ? await runReactivationSweepForAll() : null;

  return jsonOk({ ok: true, ...report, ...(sweep ? { sweep } : {}) });
}

/**
 * Constant-time comparison.
 *
 * A `===` on a secret leaks its length and, in principle, its prefix through
 * timing. The cost of doing it properly is a few microseconds.
 */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;

  let mismatch = 0;
  for (let index = 0; index < a.length; index += 1) {
    mismatch |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return mismatch === 0;
}

export const POST = withRoute(handle);
export const GET = withRoute(handle);
