import { expect, test } from '@playwright/test';

import { api, expectNoServerError, signUp } from './support';

/**
 * Clocking on and off a job, from the garden gate.
 *
 * What these specs are for, and what they are not: the arithmetic of "how far
 * from the property, and is that fix worth believing" is pure and lives in
 * tests/geo.test.ts, where two dozen cases cover the vague-fix and benefit-of-
 * the-doubt rules properly. Geocoding needs a real Maps key, so a test workspace
 * has no property coordinates to compare against anyway.
 *
 * So these prove the wiring, and above all the promise the whole feature rests
 * on: **the tap always works.** A crew member who declines location, or whose
 * phone cannot find itself, still clocks in. If that ever stops being true this
 * suite should be the thing that notices, because the alternative is finding out
 * from somebody standing in a garden unable to start their day.
 */

type JobPayload = { job: { id: string; number: string; status: string } };

async function makeJob(page: import('@playwright/test').Page, title: string) {
  const customer = await api<{ customer: { id: string } }>(page, '/api/customers', {
    method: 'POST',
    body: { firstName: 'Dana', lastName: 'Okafor', phone: '+15125550143' },
  });
  expect(customer.status).toBe(201);

  const job = await api<JobPayload>(page, '/api/jobs', {
    method: 'POST',
    body: { customerId: customer.body.customer.id, title, priceCents: 9_000 },
  });
  expect(job.status).toBe(201);

  return job.body.job;
}

test.describe('the crew clock', () => {
  test('a tap starts the clock and the job together', async ({ page, context }) => {
    /*
     * Arriving and starting work are one event to the person holding the phone.
     * Two taps to say one thing means the second one stops happening, and the
     * database fills up with jobs that were worked and never marked as under way.
     */
    await context.grantPermissions(['geolocation']);
    await context.setGeolocation({ latitude: 30.2672, longitude: -97.7431 });

    await signUp(page, 'clock-start');
    const job = await makeJob(page, 'Front and back mow');

    await page.goto(`/jobs/${job.id}`);
    await page.getByRole('button', { name: 'Clock in' }).click();

    await expect(page.getByText(/you are on the clock/i)).toBeVisible({ timeout: 15_000 });

    // The job moved with the first person on site.
    const after = await api<JobPayload>(page, `/api/jobs/${job.id}`);
    expect(after.body.job.status).toBe('IN_PROGRESS');

    await expect(page.getByText(/hours on this job/i)).toBeVisible();
    // The badge on the entry, not the card heading above it, which also contains
    // the phrase — `getByText` is strict and matching both is a test failure
    // rather than a product one.
    await expect(page.getByText('on the clock', { exact: true })).toBeVisible();
    await expectNoServerError(page);
  });

  test('a refused location does not stop anybody working', async ({ page, context }) => {
    /*
     * The single most important behaviour here. Permission is never granted in
     * this test, so `getCurrentPosition` fails with PERMISSION_DENIED exactly as
     * it does on a phone whose owner tapped "Don't allow" once, months ago, and
     * has no idea they did.
     *
     * The clock-in must still land. The entry records that there is no pin and
     * why — a gap in the evidence, not a gap in the timesheet.
     */
    await context.clearPermissions();

    await signUp(page, 'clock-denied');
    const job = await makeJob(page, 'Hedge trim, no GPS');

    await page.goto(`/jobs/${job.id}`);
    await page.getByRole('button', { name: 'Clock in' }).click();

    await expect(page.getByText(/you are on the clock/i)).toBeVisible({ timeout: 20_000 });

    // And the record says which kind of nothing it was, rather than staying blank.
    await expect(page.getByText(/no location/i)).toBeVisible();
    await expectNoServerError(page);
  });

  test('tapping twice does not bill the job for two people', async ({ page, context }) => {
    await context.grantPermissions(['geolocation']);
    await context.setGeolocation({ latitude: 30.2672, longitude: -97.7431 });

    await signUp(page, 'clock-double');
    const job = await makeJob(page, 'Double tap');

    // Straight at the API, which is where a retry on a flaky connection arrives.
    const first = await api(page, `/api/jobs/${job.id}/time`, {
      method: 'POST',
      body: { action: 'in' },
    });
    const second = await api<{ changed: boolean }>(page, `/api/jobs/${job.id}/time`, {
      method: 'POST',
      body: { action: 'in' },
    });

    expect(first.status).toBe(200);
    // Not an error — a crew member tapping twice on one bar of signal has not
    // done anything wrong — but explicitly "nothing changed", so the interface
    // does not announce a second arrival.
    expect(second.status).toBe(200);
    expect(second.body.changed).toBe(false);

    await page.goto(`/jobs/${job.id}`);
    await expect(page.getByText(/hours on this job/i)).toBeVisible();
    await expect(page.getByText(/1 entry/)).toBeVisible();
  });

  test('you cannot be in two gardens at once', async ({ page }) => {
    /*
     * The one that catches a real mistake rather than a double tap: driving to
     * the afternoon's job without clocking out of the morning's. The refusal
     * names the job they are still on, because "you are already clocked in" with
     * no clue which job is a message that sends somebody hunting.
     */
    await signUp(page, 'clock-two-jobs');
    const morning = await makeJob(page, 'Morning mow');
    const afternoon = await makeJob(page, 'Afternoon mow');

    await api(page, `/api/jobs/${morning.id}/time`, { method: 'POST', body: { action: 'in' } });

    const clash = await api<{ error: { message: string } }>(
      page,
      `/api/jobs/${afternoon.id}/time`,
      { method: 'POST', body: { action: 'in' } },
    );

    expect(clash.status).toBe(409);
    expect(clash.body.error.message).toContain(morning.number);
  });

  test('clocking out records the hours and leaves the job open', async ({ page, context }) => {
    await context.grantPermissions(['geolocation']);
    await context.setGeolocation({ latitude: 30.2672, longitude: -97.7431 });

    await signUp(page, 'clock-out');
    const job = await makeJob(page, 'Full service');

    await api(page, `/api/jobs/${job.id}/time`, { method: 'POST', body: { action: 'in' } });

    const out = await api<{ minutes: number | null; changed: boolean }>(
      page,
      `/api/jobs/${job.id}/time`,
      { method: 'POST', body: { action: 'out', note: 'Gate was locked, did the front only.' } },
    );

    expect(out.status).toBe(200);
    expect(out.body.changed).toBe(true);
    expect(out.body.minutes).not.toBeNull();

    /*
     * And the job is still IN_PROGRESS. Packing the truck is not the same
     * decision as declaring the work finished — completing moves the customer's
     * lifetime value and starts the review request, and that stays a deliberate
     * act by somebody who means it.
     */
    const after = await api<JobPayload>(page, `/api/jobs/${job.id}`);
    expect(after.body.job.status).toBe('IN_PROGRESS');

    await page.goto(`/jobs/${job.id}`);
    await expect(page.getByText('Gate was locked, did the front only.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Clock in' })).toBeVisible();
  });

  test('clocking out when you were never on says so plainly', async ({ page }) => {
    await signUp(page, 'clock-never-on');
    const job = await makeJob(page, 'Never started');

    const out = await api<{ error: { message: string } }>(page, `/api/jobs/${job.id}/time`, {
      method: 'POST',
      body: { action: 'out' },
    });

    expect(out.status).toBe(409);
    expect(out.body.error.message).toMatch(/not clocked in/i);
  });

  test('a client cannot clock in somebody else', async ({ page }) => {
    /*
     * The one abuse worth a test of its own. If the worker came from the request
     * body, a crew member could clock in a colleague who is still in bed, and
     * the wage bill would quietly agree. The session decides who is working, and
     * a `userId` in the body is ignored rather than honoured.
     */
    await signUp(page, 'clock-impersonate');
    const job = await makeJob(page, 'Not yours to start');

    const result = await api<{ entry: { userId: string } }>(page, `/api/jobs/${job.id}/time`, {
      method: 'POST',
      body: { action: 'in', userId: 'usr_somebody_else' },
    });

    expect(result.status).toBe(200);
    expect(result.body.entry.userId).not.toBe('usr_somebody_else');

    const me = await api<{ user: { id: string } }>(page, '/api/auth/me');
    expect(result.body.entry.userId).toBe(me.body.user.id);
  });
});
