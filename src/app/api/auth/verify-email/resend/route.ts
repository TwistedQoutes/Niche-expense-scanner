import { conflict } from '@/lib/api/errors';
import { withRoute } from '@/lib/api/handler';
import { RATE_LIMITS, enforceRateLimit } from '@/lib/api/rate-limit';
import { jsonOk } from '@/lib/api/response';
import { sendVerificationEmail } from '@/lib/auth/emails';
import { requireAuth } from '@/lib/auth/context';
import { emailEnabled } from '@/lib/email';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Sends the signed-in person a fresh confirmation link.
 *
 * Only ever to the address on their own account — there is no body, so there
 * is nothing to point it anywhere else. Issuing a new link retires the old one
 * (`issueToken`), so the latest email is always the one that works.
 *
 * Limited per person on the password-reset limiter's numbers: every accepted
 * request is an email, and a button that can be pressed in a loop is a way to
 * fill someone's inbox and get the sending domain blocklisted.
 */
export const POST = withRoute(async () => {
  const auth = await requireAuth();
  enforceRateLimit(RATE_LIMITS.passwordReset, `verify-resend:${auth.user.id}`);

  if (auth.user.emailVerifiedAt) {
    return jsonOk({ sent: false, alreadyVerified: true });
  }

  if (!emailEnabled()) {
    throw conflict('This site cannot send email yet, so a confirmation link has nowhere to go.');
  }

  // Awaited: the whole point of the request is that an email goes out, so a
  // failure to send is a failure the person should see.
  await sendVerificationEmail(auth.user.id, auth.user.email);

  return jsonOk({ sent: true, alreadyVerified: false });
});
