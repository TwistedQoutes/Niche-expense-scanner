import { withRoute } from '@/lib/api/handler';
import { RATE_LIMITS, clientIp, enforceRateLimit } from '@/lib/api/rate-limit';
import { getEnv } from '@/lib/env';
import { handleInboundSms, handleMissedCall, organizationForTwilioNumber } from '@/lib/messaging/inbound';
import { verifyTwilioSignature } from '@/lib/sms/verify';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Twilio's webhook: inbound texts and call status.
 *
 * Everything here is untrusted until the signature checks out. Without that,
 * this endpoint lets anyone on the internet put words in a customer's mouth —
 * inject messages into a business's inbox, create leads, and unsubscribe that
 * business's customers by sending a forged STOP.
 *
 * Returns 204 on every outcome we have finished with, including a rejection.
 * Twilio retries non-2xx responses, and retrying a request we have deliberately
 * refused just multiplies the noise.
 */
export const POST = withRoute(async (request) => {
  // Cheap first line of defence, before any parsing or hashing.
  enforceRateLimit(RATE_LIMITS.publicQuote, clientIp(request));

  const env = getEnv();
  const raw = await request.text();

  // Twilio posts form-encoded, and the signature is computed over the parameters
  // exactly as sent.
  const params: Record<string, string> = {};
  for (const [key, value] of new URLSearchParams(raw)) params[key] = value;

  /*
   * The URL Twilio signed, not the URL we happen to have received.
   *
   * Behind a proxy, a tunnel or a platform that rewrites the host, the incoming
   * request's own URL differs from the one configured in Twilio's console — and
   * verifying against the wrong string rejects every legitimate webhook. Hence
   * TWILIO_WEBHOOK_URL, with APP_URL as a sensible default.
   */
  const signedUrl =
    env.TWILIO_WEBHOOK_URL ?? `${env.APP_URL.replace(/\/+$/, '')}/api/webhooks/twilio`;

  const verification = verifyTwilioSignature({
    authToken: env.TWILIO_AUTH_TOKEN,
    url: signedUrl,
    params,
    signatureHeader: request.headers.get('x-twilio-signature'),
  });

  if (!verification.ok) {
    // Logged because a burst of these is either a misconfiguration or someone
    // probing; never echoed back, so a prober learns nothing about why.
    console.warn('[twilio] rejected an unverified webhook', {
      reason: verification.reason,
      from: params.From,
    });

    return new Response(null, { status: 204 });
  }

  const from = params.From ?? '';
  const to = params.To ?? '';

  if (!from || !to) return new Response(null, { status: 204 });

  const organizationId = await organizationForTwilioNumber(to);

  if (!organizationId) {
    // Fails closed. Attributing a stranger's text to an arbitrary business would
    // put one customer's message in another business's inbox.
    console.warn('[twilio] no organization matches the number dialled', { to });
    return new Response(null, { status: 204 });
  }

  // An inbound SMS carries a Body; a call status carries CallStatus.
  const callStatus = params.CallStatus;

  if (typeof params.Body === 'string' && params.Body.length > 0) {
    await handleInboundSms({
      organizationId,
      from,
      to,
      body: params.Body,
      providerMessageId: params.MessageSid ?? null,
    });

    return new Response(null, { status: 204 });
  }

  /*
   * A call that ended without being answered.
   *
   * "completed" is deliberately excluded: it means somebody picked up, and
   * texting "sorry we missed your call" to a person the owner just spoke to is
   * worse than saying nothing.
   */
  if (callStatus && ['no-answer', 'busy', 'failed', 'canceled'].includes(callStatus)) {
    await handleMissedCall({ organizationId, from, to });
    return new Response(null, { status: 204 });
  }

  return new Response(null, { status: 204 });
});
