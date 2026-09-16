import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

import { E2E_ENV } from './environment';
import { api, expectNoServerError, signIn, signUp, type Workspace } from './support';

/**
 * The automation worker: the part of the product that works when nobody is
 * looking.
 *
 * Everything else in this suite is something a person does. This is a scheduler
 * hitting an endpoint every minute, and the three properties that matter are all
 * invisible from a screen:
 *
 *  - **Nobody else can trigger it.** The endpoint sends text messages on a
 *    customer's behalf and spends their allowance; "nobody will guess the URL"
 *    is not an access control.
 *  - **What is due goes out.** A follow-up nobody sent is the feature not
 *    existing.
 *  - **It goes out once.** Two overlapping passes, or a scheduler that fires
 *    twice, must not text the same person twice — the fastest way to look like a
 *    robot.
 *
 * No message leaves the run: `SMS_DRIVER` is `none`, so a sent message is
 * recorded as QUEUED, which is exactly what the inbox is asserted on.
 *
 * Serial, and one workspace: this is a sequence — switch an automation on, send
 * a quote, let the worker run — where each step only means something because of
 * the one before it.
 */

test.describe.configure({ mode: 'serial' });

/** The worker's trigger, called the way a scheduler would. */
function runWorker(
  request: APIRequestContext,
  options: { secret?: string | null; sweep?: boolean } = {},
) {
  const secret = options.secret === undefined ? E2E_ENV.CRON_SECRET : options.secret;

  return request.post(`/api/cron/automations${options.sweep ? '?sweep=1' : ''}`, {
    headers: secret === null ? {} : { authorization: `Bearer ${secret}` },
  });
}

/**
 * How many times a phrase appears in this workspace's inbox.
 *
 * Read from the screen rather than from a query, because "the customer was
 * chased twice" is a thing the owner sees in a thread. The inbox preview carries
 * the latest message's text, which is what the count is over.
 */
async function timesInInbox(page: Page, phrase: string): Promise<number> {
  await page.goto('/messages');
  return page.getByText(phrase).count();
}

test.describe('the automation worker', () => {
  let owner: Workspace;
  let automationId = '';

  const FOLLOW_UP = 'just checking in about';

  test('refuses to run for anyone without the shared secret', async ({ request }) => {
    // No header at all, as an internet-wide scan would arrive.
    expect((await runWorker(request, { secret: null })).status()).toBe(401);

    // A guess, including one the right length — the comparison is constant-time,
    // but the answer is the same either way.
    expect((await runWorker(request, { secret: 'not-the-secret' })).status()).toBe(401);
    expect(
      (await runWorker(request, { secret: `${E2E_ENV.CRON_SECRET}x` })).status(),
    ).toBe(401);

    // And with the secret it runs, whether or not there is anything to do.
    const allowed = await runWorker(request);
    expect(allowed.ok()).toBe(true);
    expect(await allowed.json()).toMatchObject({ ok: true, claimed: expect.any(Number) });

    /*
     * The daily pass does more than the minutely one: it also looks for lapsed
     * customers to win back and deletes expired demo workspaces. That second one
     * deletes rows, on a schedule, with no person watching — worth knowing it
     * runs and reports rather than throwing at 3am.
     */
    const daily = await runWorker(request, { sweep: true });
    expect(daily.ok()).toBe(true);
    expect(await daily.json()).toMatchObject({ ok: true, sweep: expect.anything(), demos: expect.anything() });
  });

  test('an owner switches the quote follow-up on', async ({ page }) => {
    owner = await signUp(page, 'worker');
    await page.goto('/automations');

    /*
     * Off by default, deliberately: an automation that starts texting customers
     * because somebody signed up is not a feature. So the spec turns it on the
     * way an owner does, and the id the worker is later asked about comes from
     * the request that button makes — the page renders automations without their
     * ids, and inventing one here would be testing a different automation.
     */
    const card = page
      .locator('div.rounded-2xl')
      .filter({ has: page.getByRole('heading', { name: 'Quote follow-up' }) });

    // Exact: `getByText` matches substrings, and this page is full of "on" and
    // "off" inside longer words.
    await expect(card.getByText('Off', { exact: true })).toBeVisible();

    const [patch] = await Promise.all([
      page.waitForRequest(
        (one) => one.url().includes('/api/automations/') && one.method() === 'PATCH',
      ),
      card.getByRole('button', { name: 'Turn on' }).click(),
    ]);

    automationId = patch.url().split('/api/automations/')[1] ?? '';
    expect(automationId).not.toBe('');

    await expect(card.getByText('On', { exact: true })).toBeVisible();
    await expectNoServerError(page);
  });

  test('a quote that goes out is followed up by the worker, once', async ({ page, request }) => {
    await signIn(page, owner.email);

    /*
     * The first nudge normally waits two days, which is the right gap for a
     * customer and an impossible one for a test. So it is shortened the way the
     * product allows an owner to shorten it — through the same endpoint the
     * timing editor uses — rather than by reaching into the database. What is
     * under test is the worker, not the number.
     */
    const read = await api<{ automation: { steps: { id: string; position: number }[] } }>(
      page,
      `/api/automations/${automationId}`,
    );
    expect(read.ok, JSON.stringify(read.body)).toBe(true);

    const firstStep = read.body.automation.steps.find((step) => step.position === 0);
    expect(firstStep, 'the follow-up should have a first step').toBeDefined();

    const retimed = await api(page, `/api/automations/${automationId}`, {
      method: 'PUT',
      body: { stepId: firstStep!.id, delayMinutes: 0 },
    });
    expect(retimed.ok, JSON.stringify(retimed.body)).toBe(true);

    // A customer, a quote, and the quote going out — the event the sequence
    // hangs off.
    const customer = await api<{ customer: { id: string } }>(page, '/api/customers', {
      method: 'POST',
      body: { firstName: 'Dana', lastName: 'Green', phone: '+15125550166' },
    });
    expect(customer.ok, JSON.stringify(customer.body)).toBe(true);

    const services = await api<{ services: { id: string }[] }>(page, '/api/services');
    const quote = await api<{ quote: { id: string } }>(page, '/api/quotes', {
      method: 'POST',
      body: {
        customerId: customer.body.customer.id,
        title: 'Weekly mowing',
        pricing: { serviceId: services.body.services[0]!.id, overridePriceCents: 12_500 },
      },
    });
    expect(quote.ok, JSON.stringify(quote.body)).toBe(true);

    const sent = await api(page, `/api/quotes/${quote.body.quote.id}/send`, {
      method: 'POST',
      body: {},
    });
    expect(sent.ok, JSON.stringify(sent.body)).toBe(true);

    // Nothing has been sent yet: sending the quote schedules the follow-up, it
    // does not perform it. The screen says so.
    await page.goto('/automations');
    await expect(page.getByText('1 in flight')).toBeVisible();
    expect(await timesInInbox(page, FOLLOW_UP)).toBe(0);

    /*
     * The scheduler's pass.
     *
     * The report is asserted loosely — at least one run claimed — because the
     * worker is deliberately global: it drains every workspace's queue, including
     * whatever another spec running beside this one has just scheduled. What is
     * asserted exactly is this workspace's inbox, which nothing else can touch.
     */
    const firstPass = await runWorker(request);
    expect(firstPass.ok()).toBe(true);
    expect((await firstPass.json()).claimed).toBeGreaterThanOrEqual(1);

    // The customer has been chased, in their own thread, in the owner's words
    // rather than a string hard-coded in the worker.
    expect(await timesInInbox(page, FOLLOW_UP)).toBe(1);

    // And the product is honest that nothing actually left: no SMS driver is
    // configured, so it is logged rather than sent, and it says so.
    await page.getByText(FOLLOW_UP).click();
    await expect(page.getByText('not sent (no channel configured)')).toBeVisible();

    /*
     * The second pass is the one that matters. The run has advanced to a step
     * days away, so a worker that re-sent what it had already sent — or claimed
     * one run twice — shows up here as a second identical text to a customer who
     * has had one.
     */
    const secondPass = await runWorker(request);
    expect(secondPass.ok()).toBe(true);

    expect(await timesInInbox(page, FOLLOW_UP)).toBe(1);
    await expectNoServerError(page);
  });

});
