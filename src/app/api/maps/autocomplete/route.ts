import { z } from 'zod';

import { notImplemented, validationFailed } from '@/lib/api/errors';
import { readJsonBody, withRoute } from '@/lib/api/handler';
import { RATE_LIMITS, enforceRateLimit } from '@/lib/api/rate-limit';
import { jsonOk, toFieldErrors } from '@/lib/api/response';
import { requireAuth } from '@/lib/auth/context';
import { autocompleteAddress, mapsEnabled, placeDetails } from '@/lib/maps/client';
import { singleLineText } from '@/lib/validation/common';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * A session token is Google's, not ours, so it is only shape-checked.
 *
 * The browser generates one per address being typed and sends the same value
 * with every keystroke and with the final lookup, which is what makes Google bill
 * the whole thing as one session instead of a dozen requests. It identifies
 * nothing on our side and grants nothing, so the only rule worth enforcing is
 * that it looks like a token rather than an injection attempt.
 */
const sessionTokenSchema = z
  .string()
  .trim()
  .min(8)
  .max(64)
  .regex(/^[A-Za-z0-9_-]+$/, 'Malformed session token.');

const bodySchema = z.union([
  z.object({
    kind: z.literal('suggest'),
    input: singleLineText(200),
    sessionToken: sessionTokenSchema,
  }),
  z.object({
    kind: z.literal('resolve'),
    placeId: singleLineText(300),
    sessionToken: sessionTokenSchema,
  }),
]);

/**
 * Address suggestions, and the address behind a chosen one.
 *
 * Proxied through here rather than called from the page with a `NEXT_PUBLIC_`
 * key. Three things come out of that choice, and the third is why it is a POST
 * rather than a GET with a query string:
 *
 *  - The Maps key stays on the server, restricted by IP, never in page source.
 *  - No third-party script is loaded into a page that renders customer records.
 *  - **The per-organization rate limit sits in front of a billed endpoint that
 *    fires on keystrokes.** Without it, one person holding a key down is a bill,
 *    and there would be nothing between them and it.
 *
 * Both operations share a route because they share a session: splitting them
 * would invite a caller to use a fresh token for the resolve step, which silently
 * doubles the cost of every address anyone enters.
 */
export const POST = withRoute(async (request) => {
  const auth = await requireAuth();

  // The AI bucket: same shape of cost, same need to be metered per workspace
  // rather than per person.
  enforceRateLimit(RATE_LIMITS.ai, auth.organization.id);

  if (!mapsEnabled()) {
    throw notImplemented(
      'Address lookup is not configured on this deployment. Type the address by hand.',
    );
  }

  const parsed = bodySchema.safeParse(await readJsonBody(request));
  if (!parsed.success) throw validationFailed(toFieldErrors(parsed.error));

  if (parsed.data.kind === 'suggest') {
    const suggestions = await autocompleteAddress(parsed.data.input, parsed.data.sessionToken, {
      // Suggestions are scoped to the country the business operates in. A lawn
      // care firm in Texas typing "12 Oak" wants Texan streets, not a list from
      // four continents.
      country: 'us',
    });

    return jsonOk({ suggestions });
  }

  const place = await placeDetails(parsed.data.placeId, parsed.data.sessionToken);
  if (!place) {
    // Not an error the person can act on — the suggestion they picked simply
    // could not be resolved — so the form keeps what they typed.
    return jsonOk({ place: null });
  }

  return jsonOk({ place });
});
