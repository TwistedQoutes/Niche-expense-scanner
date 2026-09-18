import { createHmac } from 'node:crypto';

import { expect, test, type APIRequestContext } from '@playwright/test';

import { E2E_ENV } from './environment';
import { api, expectNoServerError, signIn, signUp, type Workspace } from './support';

/**
 * The missed-call text back: the feature the landing page leads with.
 *
 * A homeowner rings three companies and hires whoever answers. When nobody
 * picks up, the product's claim is that they get a text within seconds, and that
 * the call is on the board as a lead whether or not the text worked. Everything
 * about that happens on a webhook from Twilio, with no person involved, which is
 * exactly why it needs an end-to-end test: the pieces — signature, number
 * resolution, lead creation, the automation that sends the text — are each
 * covered by unit tests and none of that proves a missed call turns into
 * anything.
 *
 * The signature is the other half. Without it this endpoint lets anyone on the
 * internet put words in a customer's mouth: inject messages into a business's
 * inbox, invent leads, and — because STOP is honoured — unsubscribe that
 * business's customers from their own follow-ups. So the first thing asserted is
 * that an unsigned request does nothing at all.
 *
 * No text leaves the run: `SMS_DRIVER` is `none`, so the reply is recorded as
 * QUEUED. What is being tested is that the product *tried*, in the right thread,
 * with the owner's wording.
 */

test.describe.configure({ mode: 'serial' });

/**
 * A number nothing else in the suite will claim.
 *
 * Which workspace an inbound call belongs to is resolved from the business's own
 * phone number, and two workspaces holding the same one is refused rather than
 * guessed at — correctly, because guessing would put a stranger's call in
 * somebody else's inbox. Area code 555 is not assignable to anybody, so these
 * are fictional as well as unique.
 */
function fictionalNumber(): string {
  return `+1555${String(Math.floor(Math.random() * 10_000_000)).padStart(7, '0')}`;
}

/**
 * Twilio's signature: the URL it was configured to call, then every parameter
 * sorted by name and concatenated with no separators at all, HMAC-SHA1'd with
 * the account's auth token.
 */
function twilioSignature(params: Record<string, string>): string {
  const base = Object.keys(params)
    .sort()
    .reduce((accumulated, key) => accumulated + key + params[key], E2E_ENV.TWILIO_WEBHOOK_URL);

  return createHmac('sha1', E2E_ENV.TWILIO_AUTH_TOKEN).update(base, 'utf8').digest('base64');
}

function postToTwilioWebhook(
  request: APIRequestContext,
  params: Record<string, string>,
  options: { signature?: string | null } = {},
) {
  const signature =
    options.signature === undefined ? twilioSignature(params) : options.signature;

  return request.post('/api/webhooks/twilio', {
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      ...(signature === null ? {} : { 'x-twilio-signature': signature }),
    },
    form: params,
  });
}

test.describe('a call nobody answered', () => {
  let owner: Workspace;

  const businessNumber = fictionalNumber();
  const caller = fictionalNumber();

  const TEXT_BACK = 'Sorry we missed your call';

  test('an owner puts their number in and turns the text back on', async ({ page }) => {
    owner = await signUp(page, 'missed');

    /*
     * The business's own number is what an inbound call is matched against —
     * until per-organization numbers are provisioned, it is the mapping — so this
     * is setup rather than decoration. Settings is where an owner does it.
     */
    const saved = await api(page, '/api/settings', {
      method: 'PATCH',
      body: { phone: businessNumber },
    });
    expect(saved.ok, JSON.stringify(saved.body)).toBe(true);

    await page.goto('/automations');

    const card = page
      .locator('div.rounded-2xl')
      .filter({ has: page.getByRole('heading', { name: 'Missed-call text back' }) });

    // Off until someone decides otherwise: this one texts strangers.
    await expect(card.getByText('Off', { exact: true })).toBeVisible();
    await card.getByRole('button', { name: 'Turn on' }).click();
    await expect(card.getByText('On', { exact: true })).toBeVisible();

    await expectNoServerError(page);
  });

  test('an unsigned call does nothing at all', async ({ page, request }) => {
    const params = {
      From: caller,
      To: businessNumber,
      CallStatus: 'no-answer',
      CallSid: 'CA-e2e-unsigned',
    };

    // No signature, then a wrong one. Both are answered 204 — a refusal we have
    // finished with should not be retried for days — so the assertion that
    // matters is what did *not* happen.
    expect((await postToTwilioWebhook(request, params, { signature: null })).status()).toBe(204);
    expect((await postToTwilioWebhook(request, params, { signature: 'not-a-signature' })).status()).toBe(204);

    await signIn(page, owner.email);
    await page.goto('/leads');
    await expect(page.getByText('Missed call')).toHaveCount(0);
  });

  test('a signed missed call becomes a lead and a text back', async ({ page, request }) => {
    const response = await postToTwilioWebhook(request, {
      From: caller,
      To: businessNumber,
      CallStatus: 'no-answer',
      CallSid: 'CA-e2e-missed',
    });

    expect(response.status()).toBe(204);

    await signIn(page, owner.email);

    // On the board, however the text went — the lead is worth more than the text.
    await page.goto('/leads');
    await page.getByRole('link', { name: 'Missed call' }).first().click();
    await page.waitForURL(/\/leads\/[^/]+$/);

    // Opened: the number that rang, and where it came from.
    await expect(page.getByText(caller).first()).toBeVisible();
    await expect(page.getByText(/missed call/i).first()).toBeVisible();

    /*
     * And texted back on the webhook's own request, not on the next scheduled
     * pass. That distinction is the whole feature: a minute later is long enough
     * for the competitor to have answered.
     */
    await page.goto('/messages');
    await expect(page.getByText(TEXT_BACK)).toHaveCount(1);
  });

  test('an answered call is not texted back', async ({ page, request }) => {
    // "completed" means somebody picked up. Texting "sorry we missed your call"
    // to a person the owner has just spoken to is worse than saying nothing.
    const answered = fictionalNumber();

    const response = await postToTwilioWebhook(request, {
      From: answered,
      To: businessNumber,
      CallStatus: 'completed',
      CallSid: 'CA-e2e-answered',
    });

    expect(response.status()).toBe(204);

    await signIn(page, owner.email);
    await page.goto('/messages');
    // Still only the one text back, to the caller nobody answered.
    await expect(page.getByText(TEXT_BACK)).toHaveCount(1);

    // And no second lead: the board still holds one missed call, not two.
    await page.goto('/leads');
    await expect(page.getByRole('link', { name: 'Missed call' })).toHaveCount(1);
  });

  test('a reply from the caller lands in the thread and stops the chasing', async ({
    page,
    request,
  }) => {
    await signIn(page, owner.email);

    /*
     * First, something to stop.
     *
     * The owner quotes the person who rang, which starts the follow-up sequence
     * against that lead — three touches over ten days. The rule being tested is
     * that the whole sequence stops the moment they answer, so there has to be a
     * sequence running; asserting "nothing is queued" against a workspace that
     * never queued anything would pass for the wrong reason.
     */
    await page.goto('/automations');
    const followUp = page
      .locator('div.rounded-2xl')
      .filter({ has: page.getByRole('heading', { name: 'Quote follow-up' }) });

    await followUp.getByRole('button', { name: 'Turn on' }).click();
    await expect(followUp.getByText('On', { exact: true })).toBeVisible();

    const leads = await api<{ leads: { id: string; firstName: string }[] }>(page, '/api/leads');
    const lead = leads.body.leads.find((one) => one.firstName === 'Missed call');
    expect(lead, 'the missed call should be on the board').toBeDefined();

    const services = await api<{ services: { id: string }[] }>(page, '/api/services');
    const quote = await api<{ quote: { id: string } }>(page, '/api/quotes', {
      method: 'POST',
      body: {
        leadId: lead!.id,
        title: 'Front lawn, weekly',
        pricing: { serviceId: services.body.services[0]!.id, overridePriceCents: 9_500 },
      },
    });
    expect(quote.ok, JSON.stringify(quote.body)).toBe(true);

    const sent = await api(page, `/api/quotes/${quote.body.quote.id}/send`, {
      method: 'POST',
      body: {},
    });
    expect(sent.ok, JSON.stringify(sent.body)).toBe(true);

    await page.goto('/automations');
    await expect(followUp.getByText('1 in flight')).toBeVisible();

    // Now the caller answers.
    const response = await postToTwilioWebhook(request, {
      From: caller,
      To: businessNumber,
      Body: 'Yes please — how much for a front lawn?',
      MessageSid: `SM-e2e-reply-${Date.now().toString(36)}`,
    });

    expect(response.status()).toBe(204);

    await page.goto('/messages');
    // In the same conversation as the text back, not a second thread for the
    // same person.
    await expect(page.getByText('how much for a front lawn?')).toBeVisible();

    /*
     * And the chasing has stopped. A customer who replies and then gets "just
     * checking in" two days later has been told, plainly, that nobody is reading.
     */
    await page.goto('/automations');
    await expect(page.getByText('in flight')).toHaveCount(0);
  });

  test('STOP is honoured, and answered once', async ({ page, request }) => {
    const response = await postToTwilioWebhook(request, {
      From: caller,
      To: businessNumber,
      Body: 'STOP',
      MessageSid: 'SM-e2e-stop',
    });

    expect(response.status()).toBe(204);

    await signIn(page, owner.email);
    await page.goto('/messages');

    /*
     * The one message a carrier expects after a STOP, and the last one this
     * number will get. It is sent even though the product will now refuse to text
     * them at all — which is the point: the acknowledgement is the law's, not the
     * business's.
     */
    await expect(
      page.getByText('You will not get any more texts from us'),
    ).toHaveCount(1);

    await expectNoServerError(page);
  });
});
