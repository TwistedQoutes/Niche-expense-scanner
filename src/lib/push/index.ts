import { getEnv } from '@/lib/env';

/**
 * Push notifications to the mobile apps.
 *
 * Same shape as the email and SMS modules: a small driver contract, a default
 * that logs instead of sending, and one real implementation over plain HTTP.
 *
 * This is the feature the apps exist for. A lead that arrives at 7am is worth
 * money for about ten minutes, and nothing in a browser can wake a phone lying
 * on a truck dashboard. Everything else the apps do, a web page could.
 *
 * Both platforms go through Firebase Cloud Messaging. iOS included: Firebase
 * forwards to APNs on our behalf, so the server holds one credential rather
 * than a Google key and an Apple certificate with its own expiry to forget.
 */

export type PushMessage = {
  /** FCM registration tokens. Dead ones are reported back, not thrown on. */
  tokens: string[];
  title: string;
  body: string;
  /**
   * Where tapping the notification should land. A path, never a full URL: the
   * app prepends its own origin, so a malicious value cannot send a tap to
   * another site.
   */
  path?: string;
  /** Unread count for the iOS badge. Omitted leaves the badge alone. */
  badge?: number;
  /**
   * Collapses earlier notifications with the same key. Three leads arriving
   * while a phone is in a pocket should be one line on the lock screen, not
   * three.
   */
  collapseKey?: string;
};

export type PushResult = {
  driver: string;
  sent: number;
  /**
   * Tokens the provider rejected as permanently invalid — the app was deleted,
   * or the handset was wiped. The caller revokes these; retrying them forever
   * is how a push queue silently fills with dead addresses.
   */
  invalidTokens: string[];
};

export class PushError extends Error {
  readonly retryable: boolean;

  constructor(message: string, retryable = false) {
    super(message);
    this.name = 'PushError';
    this.retryable = retryable;
  }
}

export function pushEnabled(): boolean {
  const env = getEnv();
  return (
    env.PUSH_DRIVER === 'fcm' &&
    Boolean(env.FCM_PROJECT_ID) &&
    Boolean(env.FCM_CLIENT_EMAIL) &&
    Boolean(env.FCM_PRIVATE_KEY)
  );
}

/**
 * Sends, or logs when no driver is configured.
 *
 * Never throws for a per-token failure. A notification is an optional extra on
 * top of work that has already been done — the lead is saved, the job is
 * booked — so a push provider having a bad morning must not turn a successful
 * request into a 500.
 */
export async function sendPush(message: PushMessage): Promise<PushResult> {
  const tokens = [...new Set(message.tokens.filter((token) => token.trim().length > 0))];
  if (tokens.length === 0) {
    return { driver: 'none', sent: 0, invalidTokens: [] };
  }

  if (!pushEnabled()) {
    console.info('[push] not sent: PUSH_DRIVER is not configured', {
      title: message.title,
      recipients: tokens.length,
    });
    return { driver: 'none', sent: 0, invalidTokens: [] };
  }

  // Imported here rather than at the top so a deployment with push switched off
  // never loads the signing code or its key handling at all.
  const { sendViaFcm } = await import('@/lib/push/fcm');
  return sendViaFcm({ ...message, tokens });
}
