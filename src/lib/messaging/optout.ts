/**
 * Opt-out.
 *
 * This is the one rule in the product with statutory weight rather than
 * commercial weight. In the United States the TCPA requires that a consumer who
 * asks to stop receiving texts is not texted again, and the carriers enforce it
 * independently of the law: a sender that keeps messaging after a STOP gets its
 * number filtered, which silently breaks messaging for every one of our
 * customers on that number pool.
 *
 * So opt-out is checked on the way *out* — before every single send, including
 * from an automation — rather than trusted to be handled wherever a STOP arrives.
 * A missed unsubscribe is not recoverable by an apology.
 */

/**
 * The words carriers treat as an unsubscribe.
 *
 * Matched as the whole message, case-insensitively, with punctuation stripped.
 * Substring matching would be wrong in the other direction: "please stop by on
 * Tuesday" is a request for a visit, not an unsubscribe, and treating it as one
 * would silently cut off a customer who wanted the opposite.
 */
const STOP_WORDS = new Set([
  'stop',
  'stopall',
  'unsubscribe',
  'cancel',
  'end',
  'quit',
  'stop all',
  'optout',
  'opt out',
  'remove me',
]);

/** The words that resume messaging after a stop. */
const START_WORDS = new Set(['start', 'unstop', 'yes', 'resume', 'subscribe', 'opt in', 'optin']);

function normalise(body: string): string {
  return body
    .trim()
    .toLowerCase()
    // Strip punctuation and collapse whitespace so "STOP." and "stop!" match.
    .replace(/[.,!?;:'"()\[\]]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function isOptOut(body: string): boolean {
  return STOP_WORDS.has(normalise(body));
}

export function isOptIn(body: string): boolean {
  return START_WORDS.has(normalise(body));
}

/**
 * The tag written into `Customer.tags` to record an opt-out.
 *
 * Stored on the customer rather than in a separate table because it has to be
 * visible wherever a person looks at that customer — the CRM page, the inbox, a
 * list — and a tag is already rendered in all three. A hidden flag is a flag
 * somebody sends around.
 */
export const OPTED_OUT_TAG = 'sms-opted-out';

export function hasOptedOut(tags: readonly string[]): boolean {
  return tags.includes(OPTED_OUT_TAG);
}

/**
 * The confirmation sent back when someone opts out.
 *
 * Carriers expect an acknowledgement, and it is the last message the recipient
 * will get, so it says plainly how to undo it. Deliberately short: it is billed
 * like any other segment.
 */
export const OPT_OUT_CONFIRMATION =
  'You will not get any more texts from us. Reply START if you change your mind.';

export const OPT_IN_CONFIRMATION = 'You are subscribed again. Reply STOP at any time to end it.';
