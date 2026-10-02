import { describe, expect, it } from 'vitest';

import { hidesPurchasing, nativePlatformFromUserAgent } from '@/lib/native/platform';

/**
 * These decide whether a price is rendered into the HTML the App Store
 * reviewer reads. A false negative here is a 3.1.1 rejection, so the matcher is
 * tested against the user agents Capacitor actually produces rather than the
 * fragment it appends.
 */

// What the real webviews send: the platform's own user agent with Capacitor's
// `appendUserAgent` value on the end.
const IOS_WEBVIEW =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 ' +
  '(KHTML, like Gecko) Mobile/15E148 JobFlowApp/1.0 (ios)';

const ANDROID_WEBVIEW =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) ' +
  'Chrome/126.0.0.0 Mobile Safari/537.36 JobFlowApp/1.0 (android)';

const MOBILE_SAFARI =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 ' +
  '(KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';

describe('nativePlatformFromUserAgent', () => {
  it('recognises the iOS app', () => {
    expect(nativePlatformFromUserAgent(IOS_WEBVIEW)).toBe('ios');
  });

  it('recognises the Android app', () => {
    expect(nativePlatformFromUserAgent(ANDROID_WEBVIEW)).toBe('android');
  });

  it('does not mistake mobile Safari for the app', () => {
    // The iOS webview and Safari share almost everything. Only the marker
    // separates them, and getting this wrong would hide billing from every
    // iPhone visitor on the open web.
    expect(nativePlatformFromUserAgent(MOBILE_SAFARI)).toBeNull();
  });

  it('ignores a missing or empty user agent', () => {
    expect(nativePlatformFromUserAgent(null)).toBeNull();
    expect(nativePlatformFromUserAgent(undefined)).toBeNull();
    expect(nativePlatformFromUserAgent('')).toBeNull();
  });

  it('requires the whole marker, not just the product name', () => {
    expect(nativePlatformFromUserAgent('JobFlowApp')).toBeNull();
    expect(nativePlatformFromUserAgent('JobFlowApp/1.0')).toBeNull();
    expect(nativePlatformFromUserAgent('JobFlowApp/1.0 (windows)')).toBeNull();
    expect(nativePlatformFromUserAgent('Mozilla/5.0 JobFlow AI')).toBeNull();
  });

  it('keeps matching as the app version moves', () => {
    expect(nativePlatformFromUserAgent('x JobFlowApp/2.14 (ios)')).toBe('ios');
    expect(nativePlatformFromUserAgent('x JobFlowApp/10.0 (android)')).toBe('android');
  });
});

describe('hidesPurchasing', () => {
  it('hides every purchase surface in both apps', () => {
    expect(hidesPurchasing('ios')).toBe(true);
    expect(hidesPurchasing('android')).toBe(true);
  });

  it('leaves the browser alone', () => {
    // Where the subscription is actually sold.
    expect(hidesPurchasing(null)).toBe(false);
  });
});
