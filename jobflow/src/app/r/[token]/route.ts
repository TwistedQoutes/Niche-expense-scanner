import { withRoute } from '@/lib/api/handler';
import { RATE_LIMITS, clientIp, enforceRateLimit } from '@/lib/api/rate-limit';
import { recordReviewClick } from '@/lib/reviews/repository';
import { isSafeRedirectTarget } from '@/lib/validation/settings';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * The tracked link in a review request.
 *
 * A customer taps this from a text message, with no session and no account, so it
 * is unauthenticated by design — the token *is* the credential, and it identifies
 * exactly one review request and through it one organization.
 *
 * Three things are deliberate:
 *
 *  - **The redirect target is re-validated here**, not trusted because it passed
 *    validation when it was saved. A value can predate a rule or be written by
 *    hand, and this is the moment it turns into a link a real customer follows —
 *    so http/https only, and no credentials embedded in the URL.
 *  - **An unknown token gets the same treatment as a bad one**: sent to the
 *    marketing page, with nothing said about which it was. Someone walking the
 *    token space learns nothing.
 *  - **Rate limited**, because it is a public endpoint that writes to the
 *    database.
 */
export const GET = withRoute(async (request, context: { params: Promise<{ token: string }> }) => {
  enforceRateLimit(RATE_LIMITS.publicQuote, clientIp(request));

  const { token } = await context.params;

  /*
   * Shape-checked before it reaches the database. The tokens we issue are
   * base64url, and refusing anything else keeps junk out of the query — and keeps
   * the response for a malformed token indistinguishable from one for a token that
   * simply does not exist.
   */
  const looksLikeOurs = /^[A-Za-z0-9_-]{16,64}$/.test(token);

  const result = looksLikeOurs ? await recordReviewClick(token) : null;
  const target = result?.reviewUrl ?? null;

  /*
   * An explicit response rather than `redirect()`, which signals by throwing. It
   * reads plainly here, and it does not depend on the wrapper re-throwing
   * framework control flow to work.
   *
   * 303 rather than 302: this request had a side effect (the click is recorded),
   * and 303 is the status that says "the result is somewhere else, go and GET it".
   * `noindex` keeps a tracked link out of search results if one ever leaks.
   */
  const destination = isSafeRedirectTarget(target)
    ? target!
    : /*
       * Nowhere safe to send them. The product's own front page is a dead end
       * rather than an error message, which is right for a customer who did
       * nothing wrong — and it never reflects the stored value back, so a bad
       * value cannot become a reflected-redirect gadget.
       */
      new URL('/', request.url).toString();

  return new Response(null, {
    status: 303,
    headers: { Location: destination, 'X-Robots-Tag': 'noindex, nofollow' },
  });
});
