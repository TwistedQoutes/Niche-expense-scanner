import { describe, expect, it } from 'vitest';

import {
  OPTED_OUT_TAG,
  OPT_OUT_CONFIRMATION,
  hasOptedOut,
  isOptIn,
  isOptOut,
} from '@/lib/messaging/optout';
import {
  AVAILABLE_PLACEHOLDERS,
  renderTemplate,
  unknownPlaceholders,
} from '@/lib/messaging/templates';
import { normaliseNumber, organizationsClaimingNumber } from '@/lib/messaging/inbound';
import {
  buildSignatureBase,
  computeSignature,
  signaturesMatch,
  verifyTwilioSignature,
} from '@/lib/sms/verify';
import { MAX_SMS_LENGTH } from '@/lib/sms';

/**
 * Two things in this phase have consequences that an apology cannot undo: a
 * forged webhook, and a missed opt-out. They get the most attention here.
 */

describe('Twilio signature verification', () => {
  // Twilio's own documented example, so this is testing against their algorithm
  // rather than against our reading of it.
  const authToken = '12345';
  const url = 'https://mycompany.com/myapp.php?foo=1&bar=2';
  const params = {
    CallSid: 'CA1234567890ABCDE',
    Caller: '+14158675309',
    Digits: '1234',
    From: '+14158675309',
    To: '+18005551212',
  };

  it('concatenates the URL and sorted params with no separators', () => {
    // The detail that breaks implementations: `a=1&b=2` becomes `a1b2`, not
    // `a=1&b=2` and not `a1&b2`.
    const base = buildSignatureBase(url, params);

    expect(base).toBe(
      `${url}CallSidCA1234567890ABCDECaller+14158675309Digits1234From+14158675309To+18005551212`,
    );

    // The URL's own query string keeps its `&` and `=` — Twilio signs the URL
    // verbatim. It is the appended parameters that carry no separators, so the
    // assertion has to be made about that section alone.
    const appended = base.slice(url.length);

    expect(appended).not.toContain('&');
    expect(appended).not.toContain('=');
    expect(appended.indexOf('CallSid')).toBeLessThan(appended.indexOf('Caller'));
  });

  it('sorts by name, not by insertion order', () => {
    const forward = buildSignatureBase(url, { a: '1', b: '2', c: '3' });
    const shuffled = buildSignatureBase(url, { c: '3', a: '1', b: '2' });

    expect(forward).toBe(shuffled);
  });

  it('matches the documented signature for the documented input', () => {
    expect(computeSignature(authToken, url, params)).toBe('RSOYDt4T1cUTdK1PDd93/VVr8B8=');
  });

  it('accepts a correctly signed request', () => {
    const signature = computeSignature(authToken, url, params);

    expect(
      verifyTwilioSignature({ authToken, url, params, signatureHeader: signature }),
    ).toEqual({ ok: true });
  });

  it('rejects a tampered parameter', () => {
    // The whole point: someone rewriting `From` to impersonate a customer.
    const signature = computeSignature(authToken, url, params);
    const forged = { ...params, From: '+19995550000' };

    expect(
      verifyTwilioSignature({ authToken, url, params: forged, signatureHeader: signature }),
    ).toEqual({ ok: false, reason: 'mismatch' });
  });

  it('rejects an added parameter', () => {
    const signature = computeSignature(authToken, url, params);
    const forged = { ...params, Body: 'STOP' };

    // Injecting a forged STOP would unsubscribe a business's own customer.
    expect(
      verifyTwilioSignature({ authToken, url, params: forged, signatureHeader: signature }),
    ).toEqual({ ok: false, reason: 'mismatch' });
  });

  it('rejects a signature computed for a different URL', () => {
    const signature = computeSignature(authToken, 'https://evil.example/hook', params);

    expect(
      verifyTwilioSignature({ authToken, url, params, signatureHeader: signature }),
    ).toEqual({ ok: false, reason: 'mismatch' });
  });

  it('rejects a signature computed with a different token', () => {
    const signature = computeSignature('not-the-token', url, params);

    expect(
      verifyTwilioSignature({ authToken, url, params, signatureHeader: signature }),
    ).toEqual({ ok: false, reason: 'mismatch' });
  });

  it('rejects a request with no signature at all', () => {
    expect(verifyTwilioSignature({ authToken, url, params, signatureHeader: null })).toEqual({
      ok: false,
      reason: 'missing_signature',
    });
  });

  it('fails closed when no token is configured', () => {
    // The alternative — accepting when unconfigured — turns a missing
    // environment variable into an open endpoint.
    expect(
      verifyTwilioSignature({
        authToken: undefined,
        url,
        params,
        signatureHeader: 'anything',
      }),
    ).toEqual({ ok: false, reason: 'not_configured' });
  });

  it('compares without throwing on a length mismatch', () => {
    // timingSafeEqual throws on unequal lengths; a signature's length is not a
    // secret, so short-circuiting is safe and not crashing is required.
    expect(signaturesMatch('abc', 'abcdef')).toBe(false);
    expect(signaturesMatch('', '')).toBe(true);
  });
});

describe('opt-out', () => {
  it.each(['STOP', 'stop', 'Stop.', 'STOP!', ' stop ', 'UNSUBSCRIBE', 'cancel', 'quit', 'End'])(
    'treats %j as an unsubscribe',
    (body) => {
      expect(isOptOut(body)).toBe(true);
    },
  );

  it('does not treat a sentence containing "stop" as an unsubscribe', () => {
    // Substring matching would cut off a customer who wanted the opposite.
    expect(isOptOut('please stop by on Tuesday')).toBe(false);
    expect(isOptOut('can you stop the mower going over the flowerbed')).toBe(false);
    expect(isOptOut('I need you to cancel my appointment please')).toBe(false);
  });

  it('recognises the words that resume messaging', () => {
    expect(isOptIn('START')).toBe(true);
    expect(isOptIn('yes')).toBe(true);
    expect(isOptIn('unstop')).toBe(true);
  });

  it('does not read an ordinary yes-ish sentence as an opt-in', () => {
    expect(isOptIn('yes that works for me thanks')).toBe(false);
  });

  it('reads the opt-out state off a customer tag', () => {
    expect(hasOptedOut([OPTED_OUT_TAG])).toBe(true);
    expect(hasOptedOut(['commercial', 'weekly'])).toBe(false);
    expect(hasOptedOut([])).toBe(false);
  });

  it('confirms an opt-out in one short segment, and says how to undo it', () => {
    // It is billed like any other message, and it is the last one they will get.
    expect(OPT_OUT_CONFIRMATION.length).toBeLessThan(160);
    expect(OPT_OUT_CONFIRMATION).toMatch(/START/);
  });
});

describe('template rendering', () => {
  const values = {
    first_name: 'Dana',
    business_name: 'Green Thumb Lawn Care',
    service: 'Lawn mowing',
    address: '12 Oak Lane',
    quote_url: 'https://jobflow.test/quote/abc',
  };

  it('fills in what it has', () => {
    const result = renderTemplate(
      'Hi {{first_name}}, about the {{service}} at {{address}} — {{quote_url}}',
      values,
    );

    expect(result.text).toBe(
      'Hi Dana, about the Lawn mowing at 12 Oak Lane — https://jobflow.test/quote/abc',
    );
    expect(result.missing).toHaveLength(0);
  });

  it('never leaves raw template syntax in a customer message', () => {
    // The most visible possible bug: a customer receiving "{{first_name}}".
    const result = renderTemplate('Hi {{first_name}}, about {{service}}.', {});

    expect(result.text).not.toContain('{{');
    expect(result.text).not.toContain('}}');
  });

  it('uses a natural fallback where one reads properly', () => {
    const result = renderTemplate('Hi {{first_name}},', {});

    expect(result.text).toBe('Hi there,');
    expect(result.missing).toContain('first_name');
  });

  it('drops an unknown placeholder and reports it', () => {
    const result = renderTemplate('Hi {{first_name}}, your {{invoice_total}} is due.', values);

    expect(result.text).not.toContain('invoice_total');
    expect(result.unknown).toContain('invoice_total');
  });

  it('tidies the punctuation a dropped value leaves behind', () => {
    // ", ." reads as a typo the owner gets blamed for.
    const result = renderTemplate('Thanks {{first_name}}, {{service}}.', { first_name: 'Dana' });

    expect(result.text).not.toContain(' .');
    expect(result.text).not.toMatch(/,\s*\./);
  });

  it('tolerates whitespace inside the braces', () => {
    expect(renderTemplate('Hi {{ first_name }}', values).text).toBe('Hi Dana');
  });

  it('treats a blank value as missing rather than rendering nothing', () => {
    const result = renderTemplate('Hi {{first_name}},', { first_name: '   ' });

    expect(result.text).toBe('Hi there,');
    expect(result.missing).toContain('first_name');
  });

  it('lists unknown placeholders for the editor to reject', () => {
    expect(unknownPlaceholders('{{first_name}} and {{nope}} and {{also_nope}}')).toEqual([
      'nope',
      'also_nope',
    ]);
    expect(unknownPlaceholders('{{first_name}} {{service}}')).toEqual([]);
  });

  it('exposes every placeholder it can fill, for the editor to offer', () => {
    expect(AVAILABLE_PLACEHOLDERS).toContain('first_name');
    expect(AVAILABLE_PLACEHOLDERS).toContain('quote_url');
    expect(AVAILABLE_PLACEHOLDERS).toContain('review_url');
  });

  it('renders the shipped quote follow-up inside one SMS budget', () => {
    // The templates provisioning installs have to fit what a carrier will send
    // without splitting into a surprise number of billed segments.
    const shipped =
      'Hi {{first_name}}, just checking in about the {{service}} estimate we sent for {{address}}. Happy to answer any questions — reply here any time. – {{business_name}}';

    const result = renderTemplate(shipped, values);

    expect(result.unknown).toHaveLength(0);
    expect(result.text.length).toBeLessThanOrEqual(MAX_SMS_LENGTH);
  });
});

describe('resolving which business was dialled', () => {
  const organizations = [
    { id: 'org-alpha', phone: '+1 (512) 555-0101' },
    { id: 'org-beta', phone: '512.555.0202' },
    { id: 'org-no-phone', phone: null },
  ];

  it('matches across the ways a number gets written', () => {
    for (const spelling of ['+15125550101', '5125550101', '(512) 555-0101', '512-555-0101']) {
      expect(organizationsClaimingNumber(organizations, spelling)).toEqual(['org-alpha']);
    }
  });

  it('returns nothing for a number no business claims', () => {
    expect(organizationsClaimingNumber(organizations, '+19995550000')).toEqual([]);
  });

  it('reports every claimant when two businesses share a number', () => {
    // The caller must refuse this rather than pick one: filing a stranger's text
    // in whichever workspace signed up first is one tenant reading another
    // tenant's customer.
    const colliding = [...organizations, { id: 'org-duplicate', phone: '512-555-0101' }];

    expect(organizationsClaimingNumber(colliding, '+15125550101')).toEqual([
      'org-alpha',
      'org-duplicate',
    ]);
  });

  it('will not identify anybody from a partial number', () => {
    // "5555" as a last-ten would `contains`-match an unrelated customer whose
    // number merely includes those digits.
    expect(normaliseNumber('5555')).toBeNull();
    expect(normaliseNumber('')).toBeNull();
    expect(organizationsClaimingNumber(organizations, '0101')).toEqual([]);
  });

  it('ignores a business that has not given a phone number', () => {
    expect(organizationsClaimingNumber(organizations, '')).toEqual([]);
    expect(organizationsClaimingNumber([{ id: 'x', phone: null }], '+15125550101')).toEqual([]);
  });

  it('keeps the last ten digits of a longer international number', () => {
    expect(normaliseNumber('+44 20 7946 0958')).toBe('2079460958');
  });
});
