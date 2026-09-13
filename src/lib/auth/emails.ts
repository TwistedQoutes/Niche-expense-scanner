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

export async function sendPasswordResetEmail(userId: string, email: string): Promise<void> {
  const { token } = await issueToken(userId, 'password_reset');
  const link = appUrl(`/reset-password?token=${encodeURIComponent(token)}`);

  await sendEmail({
    to: email,
    subject: 'Reset your JobFlow AI password',
    text: [
      'Someone asked to reset the password for this email address.',
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
      'Confirming your email means quotes you send come from an address your',
      'customers can reply to, and that you can recover this account if you',
      'ever forget your password:',
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
