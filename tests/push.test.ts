import { describe, expect, it } from 'vitest';

import { leadNotificationBody } from '@/lib/push/notify';
import { registerDeviceSchema } from '@/lib/validation/devices';

describe('leadNotificationBody', () => {
  it('uses what the customer actually said', () => {
    expect(leadNotificationBody('Dana Reyes', 'Need weekly mowing on a half acre, back gate is open.')).toBe(
      'Need weekly mowing on a half acre, back gate is open.',
    );
  });

  it('falls back to the name when there is nothing to quote', () => {
    expect(leadNotificationBody('Dana Reyes', null)).toBe(
      'Dana Reyes just came in. Tap to see the details.',
    );
    expect(leadNotificationBody('Dana Reyes', '   ')).toBe(
      'Dana Reyes just came in. Tap to see the details.',
    );
  });

  it('collapses the line breaks a web form leaves behind', () => {
    expect(leadNotificationBody('Dana', 'Gutters\n\nand   downspouts')).toBe('Gutters and downspouts');
  });

  it('cuts long text at a word boundary, not mid-word', () => {
    const long =
      'We have a large property with several flower beds that need weeding and mulching before ' +
      'the end of the month, plus the hedges along the driveway want cutting back hard.';

    const body = leadNotificationBody('Dana', long);

    expect(body.endsWith('…')).toBe(true);
    expect(body.length).toBeLessThanOrEqual(111);
    // The character before the ellipsis is part of a whole word.
    expect(body.slice(-2, -1)).not.toBe(' ');
    expect(long.startsWith(body.slice(0, -1))).toBe(true);
  });

  it('still truncates something with no spaces to break on', () => {
    // A pasted URL. The word-boundary rule would otherwise eat the whole string.
    const url = `https://example.com/${'a'.repeat(200)}`;
    const body = leadNotificationBody('Dana', url);

    expect(body.length).toBeLessThanOrEqual(111);
    expect(body.endsWith('…')).toBe(true);
    expect(body.length).toBeGreaterThan(1);
  });

  it('leaves a body exactly at the limit alone', () => {
    const exact = 'x'.repeat(110);
    expect(leadNotificationBody('Dana', exact)).toBe(exact);
  });
});

describe('registerDeviceSchema', () => {
  // Shaped like a real FCM registration token: URL-safe base64 with a colon.
  const token = `fMEQ7${'a'.repeat(120)}:APA91bH${'x'.repeat(30)}`;

  it('accepts a token from a real device', () => {
    const parsed = registerDeviceSchema.safeParse({ token, platform: 'IOS' });
    expect(parsed.success).toBe(true);
  });

  it('refuses anything that is not one of the two platforms', () => {
    expect(registerDeviceSchema.safeParse({ token, platform: 'WEB' }).success).toBe(false);
    expect(registerDeviceSchema.safeParse({ token, platform: 'ios' }).success).toBe(false);
  });

  it('refuses control characters and newlines', () => {
    // This string is concatenated into a request to Google. A newline in it is
    // a header-injection shape, so it is rejected before it travels.
    expect(registerDeviceSchema.safeParse({ token: `${token}\nX-Evil: 1`, platform: 'IOS' }).success).toBe(
      false,
    );
    expect(registerDeviceSchema.safeParse({ token: `${token}\u0000`, platform: 'IOS' }).success).toBe(false);
  });

  it('refuses something far too short or far too long to be a token', () => {
    expect(registerDeviceSchema.safeParse({ token: 'abc', platform: 'IOS' }).success).toBe(false);
    expect(registerDeviceSchema.safeParse({ token: 'a'.repeat(513), platform: 'IOS' }).success).toBe(false);
  });

  it('trims surrounding whitespace rather than rejecting it', () => {
    const parsed = registerDeviceSchema.safeParse({ token: `  ${token}  `, platform: 'ANDROID' });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.token).toBe(token);
  });
});
