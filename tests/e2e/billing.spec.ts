import { createHmac } from 'node:crypto';
import { createServer, type Server } from 'node:http';

import { expect, test, type APIRequestContext } from '@playwright/test';

import { E2E_ENV, STRIPE_STUB_PORT } from './environment';
import { api, expectNoServerError, signIn, signUp, type Workspace } from './support';

/**
 * Billing, end to end: the money path.
 *
 * The unit suite already covers signature arithmetic, the plan table and the
 * usage counters. What it cannot cover is the part that actually decides whether
 * a business is paying — the checkout the owner clicks, the webhook that grants
 * the plan, and the limits that bite when it is taken away. Those only exist
 * when the pieces are wired together, and they are the pieces with money on
 * them.
 *
 * Stripe is a stub on loopback rather than a mock inside the process. The app
 * makes a real HTTP request, form-encoded, through its real client, to a server
 * that answers the way Stripe answers — so what is under test is the wiring, not
 * a stand-in for it. `STRIPE_BASE_URL` exists for exactly this.
 *
 * Webhooks are signed here with the same secret the server holds, which is the
 * only way to test the thing that matters about them: that an unsigned one is
 * refused and a signed one is believed.
 *
 * Serial, and one workspace throughout, because this is a sequence rather than a
 * set of independent checks: a plan is bought, changed, replayed and cancelled,
 * and each step's meaning depends on the one before it.
 */

test.describe.configure({ mode: 'serial' });

/**
 * A prefix for this run's Stripe event ids.
 *
 * The webhook records every event id it has handled and refuses the second
 * delivery — which is the behaviour one of the tests below is about, and which
 * would otherwise make the *other* tests pass once and then silently stop
 * applying anything on the next run against the same database. Fixed ids would
 * be a suite that only works on an empty database.
 */
const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

type StripeCall = { path: string; params: URLSearchParams };

const stripeCalls: StripeCall[] = [];
let stripe: Server;

/** The last call Stripe received at a path, or undefined. */
function lastCall(path: string): StripeCall | undefined {
  return [...stripeCalls].reverse().find((call) => call.path === path);
}

test.beforeAll(async () => {
  stripe = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));

    request.on('end', () => {
      const path = (request.url ?? '').split('?')[0] ?? '';
      const params = new URLSearchParams(Buffer.concat(chunks).toString('utf8'));
      stripeCalls.push({ path, params });

      const reply = (status: number, body: unknown) => {
        response.writeHead(status, { 'content-type': 'application/json' });
        response.end(JSON.stringify(body));
      };

      /*
       * Answering the way Stripe answers, including returning the URLs it was
       * given: a completed checkout sends the customer to `success_url`, and the
       * portal returns them to `return_url`. Pointing them back at the app is
       * what lets the spec follow the browser all the way round.
       */
      if (path === '/checkout/sessions') {
        reply(200, { id: 'cs_test_e2e', url: params.get('success_url') });
        return;
      }

      if (path === '/billing_portal/sessions') {
        reply(200, { id: 'bps_test_e2e', url: params.get('return_url') });
        return;
      }

      reply(404, { error: { message: `The stub does not implement ${path}.` } });
    });
  });

  await new Promise<void>((resolve, reject) => {
    stripe.once('error', (error: NodeJS.ErrnoException) => {
      reject(
        error.code === 'EADDRINUSE'
          ? new Error(
              `Port ${STRIPE_STUB_PORT} is taken, so the stub Stripe could not start. Run one ` +
                'Playwright project at a time — the port is fixed because the server reads ' +
                'STRIPE_BASE_URL at boot and cannot be told a new one afterwards.',
            )
          : error,
      );
    });
    stripe.listen(STRIPE_STUB_PORT, '127.0.0.1', resolve);
  });
});

test.afterAll(async () => {
  await new Promise<void>((resolve) => stripe.close(() => resolve()));
});

/**
 * A webhook body and the header Stripe would have sent with it.
 *
 * The signature is over `<timestamp>.<raw body>`, and the raw body is the string
 * that gets posted — not a re-serialisation of it, which is the mistake that
 * makes every real webhook fail.
 */
function signed(event: unknown): { raw: string; header: string } {
  const raw = JSON.stringify(event);
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = createHmac('sha256', E2E_ENV.STRIPE_WEBHOOK_SECRET)
    .update(`${timestamp}.${raw}`, 'utf8')
    .digest('hex');

  return { raw, header: `t=${timestamp},v1=${signature}` };
}

async function postWebhook(
  request: APIRequestContext,
  event: unknown,
  options: { header?: string } = {},
) {
  const { raw, header } = signed(event);

  return request.post('/api/stripe/webhook', {
    headers: {
      'content-type': 'application/json',
      'stripe-signature': options.header ?? header,
    },
    data: raw,
  });
}

/** A subscription event for one workspace, at one price. */
function subscriptionEvent(input: {
  id: string;
  type: string;
  organizationId: string;
  priceId: string;
  status: string;
}) {
  return {
    id: input.id,
    type: input.type,
    data: {
      object: {
        // Unique per run for the same reason the event ids are: a Stripe
        // customer belongs to exactly one workspace, table-wide, so a fixed one
        // would be claimed by the first run and refused to every run after it.
        id: `sub_${RUN}`,
        customer: `cus_${RUN}`,
        status: input.status,
        current_period_end: Math.floor(Date.now() / 1000) + 2_592_000,
        metadata: { organizationId: input.organizationId },
        items: { data: [{ price: { id: input.priceId } }] },
      },
    },
  };
}

test.describe('paying for the product', () => {
  /*
   * One workspace, carried between the tests below. Each test still gets its own
   * browser context — so each signs in again — but they are deliberately about
   * the same business: a plan being bought, changed, replayed and cancelled is
   * one story, and checking each step against a fresh workspace would prove only
   * that the step runs, not that the one before it stuck.
   */
  let owner: Workspace;
  let organizationId = '';

  test('an owner on trial can start a checkout, and Stripe is asked for the right thing', async ({
    page,
  }) => {
    owner = await signUp(page, 'billing');
    await page.goto('/billing');

    /*
     * A new workspace is on a Pro trial — no card, full features — which is what
     * makes the upgrade a deliberate act rather than a wall.
     *
     * Which plan is current is read from which button is missing: the card for
     * the plan you are on offers to manage it, not to buy it. That is one
     * unambiguous element per plan, where "Business" as text appears in a
     * heading, a feature list and a button.
     */
    await expect(page.getByText('On trial')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Choose Pro' })).toBeHidden();
    await expect(page.getByRole('button', { name: 'Choose Starter' })).toBeVisible();

    await Promise.all([
      page.waitForURL(/\/billing\?checkout=done/, { timeout: 30_000 }),
      page.getByRole('button', { name: 'Choose Starter' }).click(),
    ]);

    // The browser went where Stripe said to go, and came back to the page that
    // says the payment is being processed.
    await expect(page.getByText('Thank you — that is going through')).toBeVisible();

    const checkout = lastCall('/checkout/sessions');
    expect(checkout, 'the app should have called Stripe to open a checkout').toBeDefined();
    expect(checkout?.params.get('mode')).toBe('subscription');
    expect(checkout?.params.get('line_items[0][price]')).toBe(E2E_ENV.STRIPE_PRICE_STARTER);

    /*
     * The workspace the checkout is for, taken from the session rather than from
     * anything the browser sent. It is also the only thing tying the payment back
     * to a workspace, so the rest of this spec uses it as Stripe would.
     */
    organizationId = checkout?.params.get('client_reference_id') ?? '';
    expect(organizationId).not.toBe('');
    expect(checkout?.params.get('metadata[organizationId]')).toBe(organizationId);

    await expectNoServerError(page);
  });

  test('a forged webhook is refused and changes nothing', async ({ page, request }) => {
    // The highest-value request to forge in the product: a fabricated
    // subscription event is a free Business plan.
    const response = await postWebhook(
      request,
      subscriptionEvent({
        id: `evt_${RUN}_forged`,
        type: 'customer.subscription.updated',
        organizationId,
        priceId: E2E_ENV.STRIPE_PRICE_BUSINESS,
        status: 'active',
      }),
      { header: `t=${Math.floor(Date.now() / 1000)},v1=${'0'.repeat(64)}` },
    );

    expect(response.status()).toBe(400);

    await signIn(page, owner.email);
    await page.goto('/billing');
    // Still the trial it signed up with, still on Pro. Nothing was granted.
    await expect(page.getByText('On trial')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Choose Business' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Choose Pro' })).toBeHidden();
  });

  test('a signed webhook grants the plan it names', async ({ page, request }) => {
    const response = await postWebhook(
      request,
      subscriptionEvent({
        id: `evt_${RUN}_active`,
        type: 'customer.subscription.updated',
        organizationId,
        priceId: E2E_ENV.STRIPE_PRICE_BUSINESS,
        status: 'active',
      }),
    );

    expect(response.ok()).toBe(true);

    await signIn(page, owner.email);
    await page.goto('/billing');
    await expect(page.getByText('Active')).toBeVisible();
    // Business is now the plan it is on, and Pro is something it could buy.
    await expect(page.getByRole('button', { name: 'Choose Business' })).toBeHidden();
    await expect(page.getByRole('button', { name: 'Choose Pro' })).toBeVisible();
  });

  test('a redelivery of an event already handled is not applied again', async ({
    page,
    request,
  }) => {
    /*
     * Stripe retries any non-2xx, so a delivery arriving twice is ordinary. The
     * body here says the opposite of what the first one said — same event id,
     * cancelled, at the Free price — so if the gate were missing, the workspace
     * would be downgraded by a replay.
     */
    const response = await postWebhook(
      request,
      subscriptionEvent({
        id: `evt_${RUN}_active`,
        type: 'customer.subscription.updated',
        organizationId,
        priceId: E2E_ENV.STRIPE_PRICE_STARTER,
        status: 'canceled',
      }),
    );

    expect(response.ok()).toBe(true);
    expect(await response.json()).toMatchObject({ duplicate: true });

    await signIn(page, owner.email);
    await page.goto('/billing');
    await expect(page.getByText('Active')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Choose Business' })).toBeHidden();
    await expect(page.getByRole('button', { name: 'Choose Pro' })).toBeVisible();
  });

  test('a paying workspace can open the billing portal', async ({ page }) => {
    await signIn(page, owner.email);
    await page.goto('/billing');

    /*
     * The button only exists once a Stripe customer is linked, which the webhook
     * above did.
     *
     * Waited on by response rather than by URL: the portal returns the customer
     * to /billing, which is where they already are, so a URL wait is satisfied
     * before anything has happened.
     */
    const [response] = await Promise.all([
      page.waitForResponse(
        (one) => one.url().includes('/api/billing/portal') && one.request().method() === 'POST',
      ),
      page.getByRole('button', { name: 'Manage billing' }).click(),
    ]);

    // Only the status: the app navigates to the portal link as soon as it has it,
    // and a response body cannot be read after the page it belongs to has gone.
    expect(response.ok()).toBe(true);

    const portal = lastCall('/billing_portal/sessions');
    expect(portal, 'the app should have asked Stripe for a portal link').toBeDefined();
    // This workspace's own customer, from its own subscription row — never from
    // anything the browser supplied.
    expect(portal?.params.get('customer')).toBe(`cus_${RUN}`);
  });

  test('a cancellation drops the workspace to free limits, and the limit is enforced', async ({
    page,
    request,
  }) => {
    const response = await postWebhook(
      request,
      subscriptionEvent({
        id: `evt_${RUN}_cancelled`,
        type: 'customer.subscription.deleted',
        organizationId,
        priceId: E2E_ENV.STRIPE_PRICE_BUSINESS,
        status: 'canceled',
      }),
    );

    expect(response.ok()).toBe(true);

    await signIn(page, owner.email);
    await page.goto('/billing');
    await expect(page.getByText('Cancelled')).toBeVisible();

    /*
     * The part that matters more than the badge: the allowance. Nobody is locked
     * out — the workspace keeps its data and hits the free ceiling — so five
     * leads go in and the sixth is refused, by number and by plan name.
     */
    for (let index = 0; index < 5; index += 1) {
      const created = await api(page, '/api/leads', {
        method: 'POST',
        body: { firstName: `Free ${index}`, phone: `+1512555${2000 + index}`, source: 'MANUAL' },
      });

      expect(created.status, `lead ${index + 1} of the free allowance`).toBe(201);
    }

    const refused = await api<{ error: { message: string } }>(page, '/api/leads', {
      method: 'POST',
      body: { firstName: 'One too many', phone: '+15125552099', source: 'MANUAL' },
    });

    expect(refused.status).toBe(403);
    // Named, not vague: the owner's next question is always "how many do I get?"
    expect(refused.body.error.message).toContain('Free');
    expect(refused.body.error.message).toContain('5');

    await page.goto('/billing');
    await expect(page.getByText('5 / 5')).toBeVisible();
    await expectNoServerError(page);
  });
});
