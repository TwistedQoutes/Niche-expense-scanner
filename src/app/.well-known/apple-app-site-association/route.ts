import { getEnv } from '@/lib/env';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Apple's Universal Links association file.
 *
 * Apple fetches this over HTTPS when the app is installed. If it matches, a
 * link to a quote or a password reset opens the app; if it does not, every such
 * link opens Safari instead, which is a silently worse experience with nothing
 * in any log to explain it.
 *
 * Three things the format insists on, each of which fails quietly:
 *   - no `.json` extension on the path,
 *   - `Content-Type: application/json`,
 *   - no redirect on the way to it.
 *
 * Served from a route handler rather than a static file so the Team ID comes
 * from the environment: it differs between the personal and company accounts a
 * developer may switch between, and a wrong one here is invisible until a link
 * misbehaves on a real phone.
 */
export async function GET() {
  const env = getEnv();
  const teamId = env.APPLE_TEAM_ID;
  const bundleId = env.IOS_BUNDLE_ID;

  // Without the Team ID there is nothing meaningful to publish. A 404 is the
  // honest answer and is what Apple treats as "this domain has no app".
  if (!teamId) {
    return new Response('Not found', { status: 404 });
  }

  const body = {
    applinks: {
      details: [
        {
          appIDs: [`${teamId}.${bundleId}`],
          components: [
            // Everything the app can show, and nothing it cannot.
            { '/': '/quote/*', comment: 'A quote a customer was sent' },
            { '/': '/reset-password*', comment: 'Password reset' },
            { '/': '/verify-email*', comment: 'Email verification' },
            { '/': '/invite/*', comment: 'A teammate invitation' },
            { '/': '/leads/*', comment: 'A lead, from a push notification' },
            { '/': '/jobs/*', comment: 'A job, from a push notification' },
            // Marketing and billing stay in the browser: billing in particular
            // must never open in the app (App Store Guideline 3.1.1).
            { '/': '/billing*', exclude: true },
            { '/': '/', exclude: true },
          ],
        },
      ],
    },
  };

  return new Response(JSON.stringify(body), {
    headers: {
      'Content-Type': 'application/json',
      // Apple caches this; a short window makes a correction land the same day.
      'Cache-Control': 'public, max-age=3600',
    },
  });
}
