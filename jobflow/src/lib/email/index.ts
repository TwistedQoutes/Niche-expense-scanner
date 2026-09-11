import { getEnv } from '@/lib/env';

/**
 * Transactional email.
 *
 * A tiny driver contract, a safe default, and
 * one real implementation. The default driver **logs to the server console
 * instead of sending**, which matters for two reasons:
 *
 *   - Local development needs no API key and no inbox.
 *   - A production deployment that has not configured email yet fails loudly in
 *     the logs rather than silently swallowing a password-reset request.
 *
 * Resend is the real driver, called over plain HTTP — no SDK, because one POST
 * does not justify a dependency.
 */

export type EmailMessage = {
  to: string;
  subject: string;
  text: string;
};

export type EmailResult = { delivered: boolean; driver: string };

async function sendViaResend(message: EmailMessage): Promise<EmailResult> {
  const env = getEnv();

  if (!env.RESEND_API_KEY) {
    // Validated at boot, so this is defence in depth rather than an expected path.
    throw new Error('EMAIL_DRIVER is "resend" but RESEND_API_KEY is not set.');
  }

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: env.EMAIL_FROM,
      to: [message.to],
      subject: message.subject,
      text: message.text,
    }),
  });

  if (!response.ok) {
    // The body can name the problem (unverified domain, invalid key), which is
    // exactly what you need at 2am — but it must not reach the user.
    const detail = await response.text().catch(() => '');
    throw new Error(`Resend rejected the message (${response.status}): ${detail.slice(0, 500)}`);
  }

  return { delivered: true, driver: 'resend' };
}

function logInsteadOfSending(message: EmailMessage): EmailResult {
  console.info(
    [
      '',
      '─── email not sent: EMAIL_DRIVER is "none" ───',
      `to:      ${message.to}`,
      `subject: ${message.subject}`,
      '',
      message.text,
      '──────────────────────────────────────────────',
      '',
    ].join('\n'),
  );

  return { delivered: false, driver: 'none' };
}

export async function sendEmail(message: EmailMessage): Promise<EmailResult> {
  const { EMAIL_DRIVER } = getEnv();
  return EMAIL_DRIVER === 'resend' ? sendViaResend(message) : logInsteadOfSending(message);
}

/** True when this deployment can actually deliver mail. */
export function emailEnabled(): boolean {
  return getEnv().EMAIL_DRIVER === 'resend';
}
