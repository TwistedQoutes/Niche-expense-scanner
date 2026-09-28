import { getEnv } from '@/lib/env';
import { issueToken } from '@/lib/auth/tokens';
import { sendEmail } from '@/lib/email';

/**
 * The transactional emails the auth system sends.
 *
 * Plain text on purpose. A password-reset email is the single most phished
 * message a product sends, and a plain, short, link-once message is both harder
 * to spoof convincingly and less likely to be mangled by a spam filter than a
 * marketing-styled HTML template.
 */

function appUrl(path: string): string {
  const base = getEnv().APP_URL.replace(/\/+$/, '');
  return `${base}${path}`;
}

/**
 * A fresh password-reset link, as a URL.
 *
 * Issuing one consumes any earlier link for the same person (`issueToken`), so
 * there is only ever one live reset link per account.
 */
export async function issuePasswordResetLink(userId: string): Promise<{ link: string; expiresAt: Date }> {
  const { token, expiresAt } = await issueToken(userId, 'password_reset');
  return { link: appUrl(`/reset-password?token=${encodeURIComponent(token)}`), expiresAt };
}

/**
 * The reset email.
 *
 * `requestedBy` is set when an owner or admin sent it from the Team page. The
 * email then says who, and for which business — a reset nobody asked for is
 * the classic phishing lure, and "your boss at Green Acres sent this" is what
 * lets a crew member tell the real one from a fake.
 */
export async function sendPasswordResetEmail(
  userId: string,
  email: string,
  requestedBy?: { name: string | null; organizationName: string },
): Promise<void> {
  const { link } = await issuePasswordResetLink(userId);

  const opening = requestedBy
    ? `${requestedBy.name ?? 'Someone'} at ${requestedBy.organizationName} sent you a link to reset your JobFlow AI password.`
    : 'Someone asked to reset the password for this email address.';

  await sendEmail({
    to: email,
    subject: 'Reset your JobFlow AI password',
    text: [
      opening,
      '',
      'To choose a new one, open this link within the next hour:',
      link,
      '',
      "If that wasn't you, you can ignore this email — nothing has changed, and",
      'the link expires on its own.',
      '',
      'Resetting your password also signs you out on every device.',
    ].join('\n'),
  });
}

export async function sendVerificationEmail(userId: string, email: string): Promise<void> {
  const { token } = await issueToken(userId, 'email_verify');
  const link = appUrl(`/verify-email?token=${encodeURIComponent(token)}`);

  await sendEmail({
    to: email,
    subject: 'Confirm your email address',
    text: [
      'Welcome to JobFlow AI.',
      '',
      // Says only what confirming does. It used to promise replies from
      // customers and account recovery; neither depends on this.
      'Please confirm this is your email address, so we know messages about',
      'your account are reaching you:',
      link,
      '',
      'The link is good for three days.',
    ].join('\n'),
  });
}

/**
 * The invitation itself.
 *
 * Named in the subject line, because a bare "You've been invited" from a product
 * nobody has heard of is indistinguishable from spam — the business's own name is
 * the only thing in this message the recipient recognises.
 *
 * The token is passed in rather than issued here: an invitation is not an
 * `AuthToken`, since the person may not have an account yet (see
 * src/lib/team/repository.ts).
 */
export async function sendTeamInviteEmail(input: {
  email: string;
  token: string;
  organizationName: string;
  invitedByName: string | null;
  roleLabel: string;
}): Promise<void> {
  const link = appUrl(`/invite/${encodeURIComponent(input.token)}`);
  const who = input.invitedByName ? `${input.invitedByName} has` : 'Someone has';

  await sendEmail({
    to: input.email,
    subject: `${input.organizationName} invited you to JobFlow AI`,
    text: [
      `${who} invited you to join ${input.organizationName} on JobFlow AI as ${input.roleLabel}.`,
      '',
      'Open this link to accept:',
      link,
      '',
      'The link works once and expires in seven days.',
      '',
      "If you weren't expecting this, you can ignore it — nothing happens until",
      'you open the link, and it expires on its own.',
    ].join('\n'),
  });
}
