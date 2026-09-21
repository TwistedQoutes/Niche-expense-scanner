import { expect, test } from '@playwright/test';

import { api, expectNoServerError, signUp } from './support';

/**
 * The profit screen, which is a payroll read through a different lens.
 *
 * Two things are worth proving in a real browser rather than in a unit test.
 * The first is that the page renders at all against a real database — the
 * arithmetic is covered in tests/profit.test.ts, but a report that throws on an
 * empty workspace is a report nobody ever sees. The second is who can open it,
 * which matters more here than on most screens: every figure on it is derived
 * from what people are paid.
 */

type JobPayload = { job: { id: string; number: string } };

test.describe('the profit view', () => {
  test('an empty workspace gets an explanation, not an error', async ({ page }) => {
    /*
     * The first thing a new customer sees. A division by zero, an empty chart
     * with a 0% that looks like a verdict, or a stack trace would all be worse
     * than a sentence saying there is nothing here yet.
     */
    await signUp(page, 'profit-empty');
    await page.goto('/profit');

    await expect(page.getByRole('heading', { name: 'Profit', exact: true })).toBeVisible();
    await expect(page.getByText(/no finished jobs in this period/i)).toBeVisible();
    await expectNoServerError(page);
  });

  test('a finished job appears, and an uncosted one stays out of the total', async ({ page }) => {
    await signUp(page, 'profit-totals');

    const customer = await api<{ customer: { id: string } }>(page, '/api/customers', {
      method: 'POST',
      body: { firstName: 'Dana', lastName: 'Okafor', phone: '+15125550166' },
    });

    const job = await api<JobPayload>(page, '/api/jobs', {
      method: 'POST',
      body: { customerId: customer.body.customer.id, title: 'Weekly mow', priceCents: 9_000 },
    });
    expect(job.status).toBe(201);

    await api(page, `/api/jobs/${job.body.job.id}/status`, {
      method: 'POST',
      body: { action: 'start' },
    });
    await api(page, `/api/jobs/${job.body.job.id}/status`, {
      method: 'POST',
      body: { action: 'complete', finalPriceCents: 9_000 },
    });

    await page.goto('/profit');

    /*
     * Nobody has set a pay rate on a brand-new workspace, so this job's cost is
     * unknown — and the screen must say so rather than reporting $90 kept on a
     * job whose wage bill nobody has counted. This is the rule the whole feature
     * rests on, and the place it is most tempting to break.
     */
    await expect(page.getByText(/not in those totals/i)).toBeVisible();
    await expect(page.getByText(/no pay rate is set/i)).toBeVisible();

    // And it names the fix, in one place, as a link rather than an instruction.
    await expect(page.getByRole('link', { name: /set pay rates/i })).toBeVisible();
    await expectNoServerError(page);
  });

  test('the crew cannot open it, and are not told it exists', async ({ page, browser }) => {
    /*
     * Every number on this page comes from what people are paid, so it sits
     * behind the same line as the pay rates themselves. The refusal is a
     * not-found rather than a "you are not allowed": a crew member who follows a
     * link should not learn that a screen about wages exists.
     */
    await signUp(page, 'profit-gate');

    const crewEmail = `crew-${Date.now().toString(36)}@example.test`;
    const invited = await api<{ inviteUrl: string | null }>(page, '/api/team/invites', {
      method: 'POST',
      body: { email: crewEmail, role: 'STAFF' },
    });
    expect(invited.status).toBe(201);

    const stranger = await browser.newContext();
    const crewPage = await stranger.newPage();
    await crewPage.goto(invited.body.inviteUrl!);
    await crewPage.getByLabel('Your name').fill('Sam Crew');
    await crewPage.getByLabel('Choose a password').fill('CorrectHorse9!');
    await crewPage.getByRole('button', { name: /join/i }).click();
    await crewPage.waitForURL(/\/dashboard/, { timeout: 30_000 });

    // Not in the navigation.
    await expect(crewPage.getByRole('link', { name: 'Profit' })).toHaveCount(0);

    // And not reachable by typing the address either.
    await crewPage.goto('/profit');
    await expect(crewPage.getByText(/couldn.t find|not found|404/i).first()).toBeVisible();
    await expect(crewPage.getByText(/charged/i)).toHaveCount(0);

    await stranger.close();
  });
});
