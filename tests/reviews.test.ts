import { describe, expect, it } from 'vitest';

import { generateReviewToken } from '@/lib/reviews/repository';
import {
  isSafeRedirectTarget,
  reviewUrlSchema,
  timeZoneSchema,
  updateOrganizationSchema,
} from '@/lib/validation/settings';

/**
 * The review link is the one value in this product that a business types in and
 * the product then sends to every one of its customers. It gets the scrutiny.
 */

describe('the link customers are sent to', () => {
  it('accepts the review links a business actually has', () => {
    for (const url of [
      'https://g.page/r/CQhVQ8Zx1234/review',
      'https://www.google.com/maps/place/?q=place_id:ChIJ123',
      'https://www.yelp.com/biz/green-thumb-austin',
      'http://example.test/leave-a-review',
    ]) {
      expect(reviewUrlSchema.safeParse(url).success).toBe(true);
      expect(isSafeRedirectTarget(url)).toBe(true);
    }
  });

  it('refuses a scheme that would execute rather than navigate', () => {
    // A customer taps this from a text message. `javascript:` in that position is
    // script execution, not a link.
    for (const url of [
      'javascript:alert(1)',
      'JavaScript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'file:///etc/passwd',
      'ftp://example.test/x',
    ]) {
      expect(reviewUrlSchema.safeParse(url).success).toBe(false);
      expect(isSafeRedirectTarget(url)).toBe(false);
    }
  });

  it('refuses a link with credentials hidden in it', () => {
    // Reads as Google to somebody skimming; resolves to evil.example.
    const deceptive = 'https://www.google.com@evil.example/review';

    expect(reviewUrlSchema.safeParse(deceptive).success).toBe(false);
    expect(isSafeRedirectTarget(deceptive)).toBe(false);
  });

  it('refuses something that is not a URL at all', () => {
    for (const url of ['google.com/review', 'not a link', 'https://', '://missing-scheme']) {
      expect(reviewUrlSchema.safeParse(url).success).toBe(false);
      expect(isSafeRedirectTarget(url)).toBe(false);
    }
  });

  it('treats an empty value as "not set" rather than an error', () => {
    // Clearing the field is how an owner turns review requests off.
    const parsed = reviewUrlSchema.safeParse('');

    expect(parsed.success).toBe(true);
    expect(parsed.data).toBeNull();
    expect(isSafeRedirectTarget(null)).toBe(false);
  });

  it('refuses a link long enough to be an attack on the column', () => {
    expect(reviewUrlSchema.safeParse(`https://example.test/${'a'.repeat(3000)}`).success).toBe(
      false,
    );
  });

  it('is checked again at redirect time, not just on the way in', () => {
    // A value can predate the rule or be written by hand; the redirect is the
    // moment it becomes a link a real customer follows.
    expect(isSafeRedirectTarget('javascript:alert(1)')).toBe(false);
    expect(isSafeRedirectTarget('')).toBe(false);
    expect(isSafeRedirectTarget(null)).toBe(false);
  });
});

describe('the timezone a business runs on', () => {
  it('accepts zones the runtime knows', () => {
    for (const zone of ['America/New_York', 'America/Phoenix', 'Europe/London', 'UTC']) {
      expect(timeZoneSchema.safeParse(zone).success).toBe(true);
    }
  });

  it('refuses one it does not', () => {
    // A bad zone throws inside Intl on every calendar render, taking the page
    // down rather than showing the wrong hour.
    for (const zone of ['Mars/Olympus_Mons', 'EST5EDT_TYPO', 'not a zone', '']) {
      expect(timeZoneSchema.safeParse(zone).success).toBe(false);
    }
  });
});

describe('what the settings form will accept', () => {
  it('takes a partial change', () => {
    expect(updateOrganizationSchema.safeParse({ name: 'Green Thumb Lawns' }).success).toBe(true);
    expect(updateOrganizationSchema.safeParse({ timezone: 'America/Chicago' }).success).toBe(true);
  });

  it('refuses an empty change', () => {
    expect(updateOrganizationSchema.safeParse({}).success).toBe(false);
  });

  it('refuses a bad review link through the whole form', () => {
    const parsed = updateOrganizationSchema.safeParse({ reviewUrl: 'javascript:alert(1)' });

    expect(parsed.success).toBe(false);
  });

  it('refuses a service radius that is not a service area', () => {
    expect(updateOrganizationSchema.safeParse({ serviceRadiusMiles: 0 }).success).toBe(false);
    expect(updateOrganizationSchema.safeParse({ serviceRadiusMiles: 5000 }).success).toBe(false);
    expect(updateOrganizationSchema.safeParse({ serviceRadiusMiles: 25 }).success).toBe(true);
  });
});

describe('the token in a review link', () => {
  it('is long and random enough not to be walked', () => {
    // Same argument as a quote's public id: the URL is the only thing identifying
    // the request, and it arrives by text message.
    const tokens = Array.from({ length: 200 }, () => generateReviewToken());

    expect(new Set(tokens).size).toBe(200);

    for (const token of tokens) {
      expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(token.length).toBeGreaterThanOrEqual(20);
    }
  });

  it('matches the shape the redirect route will accept', () => {
    // The route shape-checks before touching the database; a token we issue that
    // the route rejected would be a dead link in a sent message.
    const routePattern = /^[A-Za-z0-9_-]{16,64}$/;

    for (let index = 0; index < 100; index += 1) {
      expect(routePattern.test(generateReviewToken())).toBe(true);
    }
  });
});
