import { getEnv } from '@/lib/env';

/**
 * Outbound SMS.
 *
 * Same shape as the email module: a tiny driver contract, a safe default, and
 * one real implementation over plain HTTP. Twilio's SDK is a large dependency
 * for what is a single form POST.
 *
 * The default driver **logs instead of sending**, which matters more here than
 * anywhere else in the product. Every message costs money at the carrier, and a
 * bug that sends a hundred texts is a bill and a reputation problem rather than
 * a stack trace. Local development therefore cannot send by accident.
 */

export type SmsMessage = {
  to: string;
  body: string;
};

export type SmsResult = {
  delivered: boolean;
  driver: string;
  /** Twilio's SID, so a delivery-status callback can find the row again. */
  providerMessageId: string | null;
};

/**
 * The longest body we will hand to the carrier.
 *
 * A long message is split into segments and billed per segment, so an
 * accidentally unbounded template is a bill multiplied by every recipient. Three
 * segments is generous for the kind of message this product sends; anything
 * longer is a mistake worth catching before it is charged for.
 */
export const MAX_SMS_LENGTH = 480;

export class SmsError extends Error {
  readonly retryable: boolean;

  constructor(message: string, retryable = false) {
    super(message);
    this.name = 'SmsError';
    this.retryable = retryable;
  }
}

export function smsEnabled(): boolean {
  const env = getEnv();
  return (
    env.SMS_DRIVER === 'twilio' &&
    Boolean(env.TWILIO_ACCOUNT_SID) &&
    Boolean(env.TWILIO_AUTH_TOKEN) &&
    Boolean(env.TWILIO_PHONE_NUMBER)
  );
}

async function sendViaTwilio(message: SmsMessage): Promise<SmsResult> {
  const env = getEnv();

  const url = `${env.TWILIO_BASE_URL.replace(/\/+$/, '')}/Accounts/${env.TWILIO_ACCOUNT_SID}/Messages.json`;

  const body = new URLSearchParams({
    To: message.to,
    From: env.TWILIO_PHONE_NUMBER!,
    Body: message.body,
  });

  // Bounded, like every other outbound call: a hung request would hold a
  // serverless invocation open until the platform kills it.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        // Twilio uses HTTP basic auth: account SID as the user, token as the
        // password.
        Authorization: `Basic ${Buffer.from(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new SmsError('The SMS provider timed out.', true);
    }
    throw new SmsError('Could not reach the SMS provider.', true);
  } finally {
    clearTimeout(timer);
  }

  const payload = (await response.json().catch(() => null)) as
    | { sid?: string; message?: string; code?: number }
    | null;

  if (!response.ok) {
    /*
     * 4xx from Twilio is almost always permanent for this message — an
     * unreachable number, an unverified sender, a body the carrier rejected.
     * Retrying those burns the allowance and never succeeds, so only 5xx and
     * 429 are worth another attempt.
     */
    const retryable = response.status >= 500 || response.status === 429;

    throw new SmsError(
      `The SMS provider rejected the message (${response.status}): ${payload?.message ?? 'no detail'}`,
      retryable,
    );
  }

  return { delivered: true, driver: 'twilio', providerMessageId: payload?.sid ?? null };
}

function logInsteadOfSending(message: SmsMessage): SmsResult {
  console.info(
    [
      '',
      '─── SMS not sent: SMS_DRIVER is "none" ───',
      `to:   ${message.to}`,
      '',
      message.body,
      '──────────────────────────────────────────',
      '',
    ].join('\n'),
  );

  return { delivered: false, driver: 'none', providerMessageId: null };
}

export async function sendSms(message: SmsMessage): Promise<SmsResult> {
  if (message.body.length > MAX_SMS_LENGTH) {
    throw new SmsError(
      `That message is ${message.body.length} characters; the limit is ${MAX_SMS_LENGTH}.`,
    );
  }

  if (message.to.trim().length === 0) {
    throw new SmsError('No phone number to send to.');
  }

  return smsEnabled() ? sendViaTwilio(message) : logInsteadOfSending(message);
}
