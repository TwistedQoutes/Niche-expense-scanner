import { describe, expect, it } from 'vitest';

import {
  DEMO_ACCOUNT_DOMAIN,
  DEMO_BUSINESS_PHONE,
  DEMO_CUSTOMERS,
  DEMO_EMAIL_DOMAIN,
  DEMO_LEADS,
  demoPhone,
} from '@/lib/demo/seed';

/**
 * The demo's real risk is not that it looks wrong — it is that a prospect playing
 * with a fake customer types a real phone number into one and the product texts a
 * stranger. `sendMessage` refuses to hand anything from a demo workspace to a
 * carrier, and that is checked live; this is the second line, on the seeded data
 * itself, so even a failure of the block lands nowhere real.
 */

describe('the numbers a demo ships with', () => {
  it('are all in the exchange reserved for fiction', () => {
    // +1 AAA NNN XXXX — the NNN exchange is 555, which is set aside precisely so
    // a made-up number cannot ring a real person.
    for (let index = 0; index < 200; index += 1) {
      const number = demoPhone(index);

      expect(number).toMatch(/^\+1\d{10}$/);
      expect(number.slice(5, 8)).toBe('555');
    }
  });

  it('gives every seeded contact a different one', () => {
    // Customers use 0..n and leads use 50..n; an overlap would thread two
    // different people's messages into one conversation.
    const used = [
      ...DEMO_CUSTOMERS.map((_, index) => demoPhone(index)),
      ...DEMO_LEADS.map((_, index) => demoPhone(50 + index)),
    ];

    expect(new Set(used).size).toBe(used.length);
  });

  it('uses one of them for the business itself', () => {
    expect(DEMO_BUSINESS_PHONE.slice(5, 8)).toBe('555');
  });

  it('stays inside the 555 range well past the seeded count', () => {
    // The helper pads to four digits; a seed that grew past 999 contacts would
    // silently roll into a different exchange.
    expect(demoPhone(899).slice(5, 8)).toBe('555');
    expect(demoPhone(0)).toBe('+15125550100');
  });
});

describe('the addresses a demo ships with', () => {
  it('are on a domain that can never be registered', () => {
    // `.test` is reserved by the IETF, so a stray send has nowhere to land.
    expect(DEMO_EMAIL_DOMAIN.endsWith('.test')).toBe(true);
  });

  it('uses a domain that cannot resolve for the throwaway account', () => {
    // `.invalid` is reserved and guaranteed not to resolve. It is also what the
    // cleanup matches on, so a real person is never swept up with the demos.
    expect(DEMO_ACCOUNT_DOMAIN.endsWith('.invalid')).toBe(true);
  });

  it('keeps the two domains distinct', () => {
    // The cleanup deletes users by the account domain. If seeded contacts shared
    // it, a sweep could reach beyond the demo accounts it means to remove.
    expect(DEMO_EMAIL_DOMAIN).not.toBe(DEMO_ACCOUNT_DOMAIN);
  });
});

describe('what a demo has in it', () => {
  it('has enough history for analytics to say something', () => {
    // A prospect who opens Analytics on an empty workspace learns nothing.
    const totalJobs = DEMO_CUSTOMERS.reduce((sum, customer) => sum + customer.jobs, 0);

    expect(DEMO_CUSTOMERS.length).toBeGreaterThanOrEqual(5);
    expect(totalJobs).toBeGreaterThanOrEqual(20);
  });

  it('has a lead at more than one stage, so the board shows what it is for', () => {
    const stages = new Set(DEMO_LEADS.map((lead) => lead.status));

    expect(stages.size).toBeGreaterThanOrEqual(3);
  });

  it('has more than one lead source, so the sources report is not one bar', () => {
    expect(new Set(DEMO_LEADS.map((lead) => lead.source)).size).toBeGreaterThanOrEqual(4);
  });

  it('includes somebody overdue, so reactivation has something to show', () => {
    const overdue = DEMO_CUSTOMERS.filter(
      (customer) => customer.nextDueDaysFromNow !== null && customer.nextDueDaysFromNow < 0,
    );

    expect(overdue.length).toBeGreaterThan(0);
  });

  it('gives every customer a lifetime value its job count can explain', () => {
    // The seed divides lifetime value by job count to price each visit; a zero
    // would divide by zero and a mismatch would show an absurd average job value.
    for (const customer of DEMO_CUSTOMERS) {
      expect(customer.jobs).toBeGreaterThan(0);
      expect(customer.lifetimeCents / customer.jobs).toBeGreaterThan(1_000);
      expect(customer.lifetimeCents / customer.jobs).toBeLessThan(100_000);
    }
  });
});
