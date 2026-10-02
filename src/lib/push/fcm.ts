import { SignJWT, importPKCS8 } from 'jose';

import { getEnv } from '@/lib/env';
import { PushError, type PushMessage, type PushResult } from '@/lib/push';

/**
 * Firebase Cloud Messaging over its HTTP v1 API.
 *
 * The SDK is not used, for the same reason Twilio's is not: it is a large
 * dependency, it pulls in a native-ish runtime, and what it does here is sign a
 * JWT and POST some JSON. `jose` already ships for session tokens and signs
 * this one too.
 */

const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';

/** FCM accepts up to 500 tokens per batch; stay well inside it. */
const BATCH_SIZE = 100;

type CachedToken = { value: string; expiresAt: number };
let cachedAccessToken: CachedToken | null = null;

/**
 * A service account key pasted through a hosting dashboard usually arrives with
 * its newlines escaped, because that is how it sits inside the JSON file. The
 * failure that causes is a signature rejection with no hint about why, so it is
 * fixed here rather than documented.
 */
function normalisePrivateKey(raw: string): string {
  return raw.includes('\\n') ? raw.replace(/\\n/g, '\n') : raw;
}

/**
 * An OAuth access token for the service account, cached until shortly before it
 * expires.
 *
 * Google issues these for an hour. Minting one per notification would add a
 * round trip to every send and, on a busy morning, run into the token endpoint's
 * own rate limit.
 */
async function accessToken(): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (cachedAccessToken && cachedAccessToken.expiresAt > now + 60) {
    return cachedAccessToken.value;
  }

  const env = getEnv();
  const clientEmail = env.FCM_CLIENT_EMAIL;
  const privateKeyPem = env.FCM_PRIVATE_KEY;
  if (!clientEmail || !privateKeyPem) {
    throw new PushError('FCM credentials are missing.');
  }

  let key: CryptoKey;
  try {
    key = await importPKCS8(normalisePrivateKey(privateKeyPem), 'RS256');
  } catch {
    // Deliberately says nothing about the key's contents.
    throw new PushError('FCM_PRIVATE_KEY is not a valid PKCS#8 private key.');
  }

  const assertion = await new SignJWT({ scope: SCOPE })
    .setProtectedHeader({ alg: 'RS256' })
    .setIssuer(clientEmail)
    .setSubject(clientEmail)
    .setAudience(TOKEN_ENDPOINT)
    .setIssuedAt(now)
    .setExpirationTime(now + 3600)
    .sign(key);

  const response = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  });

  if (!response.ok) {
    // 5xx from Google's token endpoint is worth another go; a 4xx means the
    // credentials are wrong and retrying will not fix them.
    throw new PushError(
      `Could not get an FCM access token (${response.status}).`,
      response.status >= 500,
    );
  }

  const payload = (await response.json()) as { access_token?: string; expires_in?: number };
  if (!payload.access_token) {
    throw new PushError('FCM token response carried no access token.');
  }

  cachedAccessToken = {
    value: payload.access_token,
    expiresAt: now + (payload.expires_in ?? 3600),
  };
  return cachedAccessToken.value;
}

/** Errors that mean this token will never work again. */
const PERMANENT_FAILURES = new Set(['UNREGISTERED', 'INVALID_ARGUMENT', 'SENDER_ID_MISMATCH']);

function isPermanentFailure(body: unknown): boolean {
  const details = (body as { error?: { details?: { errorCode?: string }[]; status?: string } })?.error;
  if (!details) return false;
  if (details.status === 'NOT_FOUND' || details.status === 'INVALID_ARGUMENT') return true;
  return (details.details ?? []).some(
    (detail) => detail.errorCode != null && PERMANENT_FAILURES.has(detail.errorCode),
  );
}

async function sendOne(
  projectId: string,
  bearer: string,
  token: string,
  message: PushMessage,
): Promise<{ sent: boolean; invalid: boolean }> {
  const response = await fetch(
    `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/messages:send`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${bearer}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message: {
          token,
          notification: { title: message.title, body: message.body },
          // Read by the app when a tap opens it. Kept as data rather than in
          // the notification body so the app decides where to navigate.
          data: message.path ? { path: message.path } : undefined,
          android: {
            priority: 'HIGH',
            collapseKey: message.collapseKey,
            notification: {
              // Matches the brand colour used for the status bar and splash.
              color: '#059669',
              channelId: 'leads',
            },
          },
          apns: {
            headers: {
              'apns-priority': '10',
              ...(message.collapseKey ? { 'apns-collapse-id': message.collapseKey } : {}),
            },
            payload: {
              aps: {
                sound: 'default',
                ...(message.badge == null ? {} : { badge: message.badge }),
              },
            },
          },
        },
      }),
    },
  );

  if (response.ok) return { sent: true, invalid: false };

  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    // A non-JSON error body tells us nothing extra; the status still decides.
  }

  if (response.status === 404 || response.status === 400) {
    return { sent: false, invalid: isPermanentFailure(body) || response.status === 404 };
  }

  // Everything else — throttling, an outage — is this send's bad luck, not this
  // token's fault. Logged, counted as unsent, and left for the next trigger.
  console.warn('[push] FCM refused a message', { status: response.status });
  return { sent: false, invalid: false };
}

export async function sendViaFcm(message: PushMessage): Promise<PushResult> {
  const env = getEnv();
  const projectId = env.FCM_PROJECT_ID;
  if (!projectId) throw new PushError('FCM_PROJECT_ID is missing.');

  const bearer = await accessToken();

  let sent = 0;
  const invalidTokens: string[] = [];

  // FCM v1 has no multicast endpoint, so this is one request per token. Batched
  // so a workspace with a large crew does not open two hundred sockets at once.
  for (let index = 0; index < message.tokens.length; index += BATCH_SIZE) {
    const batch = message.tokens.slice(index, index + BATCH_SIZE);
    const outcomes = await Promise.all(
      batch.map(async (token) => {
        try {
          return await sendOne(projectId, bearer, token, message);
        } catch (error) {
          console.warn('[push] a token could not be delivered to', {
            error: error instanceof Error ? error.message : 'unknown',
          });
          return { sent: false, invalid: false };
        }
      }),
    );

    outcomes.forEach((outcome, offset) => {
      if (outcome.sent) sent += 1;
      if (outcome.invalid) invalidTokens.push(batch[offset]!);
    });
  }

  return { driver: 'fcm', sent, invalidTokens };
}

/** Test seam: the access token is cached across calls in a long-lived process. */
export function resetFcmTokenCacheForTests(): void {
  cachedAccessToken = null;
}
