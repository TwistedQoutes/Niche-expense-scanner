import { expect, test } from '@playwright/test';

import { api, expectNoServerError, signUp } from './support';

/**
 * The route screen.
 *
 * The ordering itself is geometry, and it is tested as geometry in
 * tests/routing.test.ts — including against every possible order of a small day,
 * which is a far stronger check than anything a browser could do. What a browser
 * is needed for is the rest of it: that the page survives the states a real
 * workspace is actually in, and that the button which rewrites a day is behind
 * the door it should be behind.
 *
 * A test workspace has no geocoded properties, because geocoding needs a real
 * Maps key. That turns out to be the most valuable case to cover here rather
 * than the least: "we have jobs but no coordinates for any of them" is exactly
 * the state every new customer is in, and a route screen that divides by zero or
 * silently shows an empty day would be the first thing they saw.
 */

type JobPayload = { job: { id: string } };

async function bookAJob(page: import('@playwright/test').Page, title: string, date: string, time: string) {
  const customer = await api<{ customer: { id: string } }>(page, '/api/customers', {
    method: 'POST',
    body: { firstName: title, lastName: 'Tester', phone: '+15125550177' },
  });

  const job = await api<JobPayload>(page, '/api/jobs', {
    method: 'POST',
    body: { customerId: customer.body.customer.id, title, priceCents: 9_000 },
  });
  expect(job.status).toBe(201);

  const booked = await api(page, `/api/jobs/${job.body.job.id}/schedule`, {
    method: 'POST',
    body: { date, time, durationMinutes: 45 },
  });
  expect(booked.status, JSON.stringify(booked.body)).toBe(200);

  return job.body.job.id;
}

test.describe('the route screen', () => {
  test('a day with nothing booked explains itself', async ({ page }) => {
    await signUp(page, 'route-empty');
    await page.goto('/route?date=2026-06-10');

    await expect(page.getByRole('heading', { name: 'Route', exact: true })).toBeVisible();
    await expect(page.getByText(/nothing booked for this day/i)).toBeVisible();
    await expectNoServerError(page);
  });

  test('jobs with no coordinates are listed, not silently dropped', async ({ page }) => {
    /*
     * The state every new workspace is in. A job that cannot be placed on a map
     * must still appear, because a job missing from the day's plan is a job that
     * does not get done — and that failure would be invisible, which is the
     * worst kind.
     */
    await signUp(page, 'route-unplaced');
    await bookAJob(page, 'Hedge trim', '2026-06-10', '09:00');
    await bookAJob(page, 'Front lawn', '2026-06-10', '11:00');

    await page.goto('/route?date=2026-06-10');

    await expect(page.getByText(/no location/i).first()).toBeVisible();
    // Both of them are on the screen somewhere, whatever the plan can do with them.
    await expect(page.getByText('Hedge trim').first()).toBeVisible();
    await expect(page.getByText('Front lawn').first()).toBeVisible();

    // And with nothing placed, it says so rather than offering a route of nothing.
    await expect(page.getByText(/at least two placed stops/i)).toBeVisible();
    await expectNoServerError(page);
  });

  test('moving between days works and neither day breaks', async ({ page }) => {
    await signUp(page, 'route-days');
    await page.goto('/route?date=2026-06-10');

    await page.getByRole('link', { name: /next/i }).click();
    await expect(page.getByText('2026-06-11')).toBeVisible();

    await page.getByRole('link', { name: /previous/i }).click();
    await expect(page.getByText('2026-06-10')).toBeVisible();
    await expectNoServerError(page);
  });

  test('the crew cannot reorder the day, or learn that they could', async ({ page, browser }) => {
    /*
     * Applying a route changes times customers have been told. That is the
     * owner's call, and the person it affects most is the one who would be
     * driving it.
     */
    await signUp(page, 'route-gate');

    const invited = await api<{ inviteUrl: string | null }>(page, '/api/team/invites', {
      method: 'POST',
      body: { email: `crew-${Date.now().toString(36)}@example.test`, role: 'STAFF' },
    });
    expect(invited.status).toBe(201);

    const stranger = await browser.newContext();
    const crewPage = await stranger.newPage();
    await crewPage.goto(invited.body.inviteUrl!);
    await crewPage.getByLabel('Your name').fill('Sam Crew');
    await crewPage.getByLabel('Choose a password').fill('CorrectHorse9!');
    await crewPage.getByRole('button', { name: /join/i }).click();
    await crewPage.waitForURL(/\/dashboard/, { timeout: 30_000 });

    await expect(crewPage.getByRole('link', { name: 'Route' })).toHaveCount(0);

    await crewPage.goto('/route?date=2026-06-10');
    await expect(crewPage.getByText(/couldn.t find|not found|404/i).first()).toBeVisible();

    // And the endpoint refuses them too, not just the page.
    const refused = await api(crewPage, '/api/route-plan', {
      method: 'POST',
      body: { date: '2026-06-10', order: ['a'.repeat(25), 'b'.repeat(25)] },
    });
    expect(refused.status).toBe(403);

    await stranger.close();
  });

  test('a stale order is refused rather than half applied', async ({ page }) => {
    /*
     * Two tabs, or a page left open over lunch. Applying an order that mentions
     * a visit which has since been cancelled would pack jobs into slots that no
     * longer exist, so the whole thing is refused and the day is left alone.
     */
    await signUp(page, 'route-stale');
    await bookAJob(page, 'Still here', '2026-06-10', '09:00');

    const result = await api<{ error: { message: string } }>(page, '/api/route-plan', {
      method: 'POST',
      body: { date: '2026-06-10', order: ['x'.repeat(25), 'y'.repeat(25)] },
    });

    expect(result.status).toBe(404);
    expect(result.body.error.message).toMatch(/changed since/i);
  });
});
