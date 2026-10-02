import { headers } from 'next/headers';

/**
 * Telling the mobile apps apart from a browser, on the server.
 *
 * The native apps load this same web app inside a webview, so every screen is
 * shared. Two things must differ, and both are decided before the HTML is sent
 * rather than hidden with CSS afterwards — a reviewer reads the page, and
 * something merely hidden is still there to be found.
 *
 * Capacitor appends the marker below to the webview's user agent
 * (`capacitor.config.ts`, `appendUserAgent`).
 */

export type NativePlatform = 'ios' | 'android';

/**
 * Matches the exact marker Capacitor is configured to append, not a loose
 * "contains JobFlow" test: the user agent is attacker-controlled on the open
 * web, and the only thing it is used for here is removing features. The worst
 * a forged value can do is hide the billing link from someone who then visits
 * the billing page directly, which works fine.
 */
const MARKER = /JobFlowApp\/\d+\.\d+ \((ios|android)\)/;

export function nativePlatformFromUserAgent(
  userAgent: string | null | undefined,
): NativePlatform | null {
  if (!userAgent) return null;
  const match = MARKER.exec(userAgent);
  if (!match) return null;
  return match[1] === 'ios' ? 'ios' : 'android';
}

/** The native platform this request came from, or null for a browser. */
export async function nativePlatform(): Promise<NativePlatform | null> {
  const requestHeaders = await headers();
  return nativePlatformFromUserAgent(requestHeaders.get('user-agent'));
}

/**
 * Whether this request must be shown no way to buy anything.
 *
 * App Store Review Guideline 3.1.1 is the reason. An iOS app that sells a
 * digital subscription has to sell it through Apple's in-app purchase, which
 * costs 15–30% of the price. JobFlow does not do that: subscriptions are bought
 * on the web, and the app is a way to use an account you already have.
 *
 * What the guideline actually requires is stricter than "no checkout button".
 * The app may not display prices, may not describe what a paid plan includes in
 * a way that reads as an offer, and — the part that catches people — may not
 * link out to a web page where the purchase can be made. Reviewers do look for
 * the link. So the whole billing surface comes out: the nav entry, the upgrade
 * prompts, and the plan comparison.
 *
 * Android is treated the same. Google Play's billing policy is not identical,
 * and a B2B service has more room there, but the difference buys one extra
 * screen in one app and costs a second code path plus the chance of shipping
 * the wrong one. One rule, both platforms.
 *
 * What the app *may* say, and does, is that the plan is managed on the web —
 * without a tappable link. That is `BillingUnavailable`.
 */
export function hidesPurchasing(platform: NativePlatform | null): boolean {
  return platform !== null;
}

/** Convenience for server components: one call instead of two. */
export async function purchasingHidden(): Promise<boolean> {
  return hidesPurchasing(await nativePlatform());
}
