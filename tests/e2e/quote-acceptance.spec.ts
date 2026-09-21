import { expect, test } from '@playwright/test';

import { api, signUp } from './support';

/**
 * The moment the product earns its money: a customer with no account opens a link
 * from a text message and accepts a quote.
 *
 * Everything about that page is unusual — no session, a public URL, a write from
 * an unauthenticated visitor — so it gets its own end-to-end test rather than
 * being covered only by unit tests of the pieces.
 */
test('a customer with no account can open a quote and accept it', async ({ page, browser }) => {
  await signUp(page, 'quote');

  const customer = await api<{ customer: { id: string } }>(page, '/api/customers', {
    method: 'POST',
    body: { firstName: 'Dana', lastName: 'Green', phone: '+15125550155' },
  });
  expect(customer.ok, JSON.stringify(customer.body)).toBe(true);

  const services = await api<{ services: { id: string }[] }>(page, '/api/services');
  const serviceId = services.body.services[0]!.id;

  const quote = await api<{ quote: { id: string } }>(page, '/api/quotes', {
    method: 'POST',
    body: {
      customerId: customer.body.customer.id,
      title: 'Weekly mowing',
      pricing: { serviceId, overridePriceCents: 12_500 },
    },
  });
  expect(quote.ok, JSON.stringify(quote.body)).toBe(true);
  const quoteId = quote.body.quote.id;

  const sent = await api(page, `/api/quotes/${quoteId}/send`, { method: 'POST', body: {} });
  expect(sent.ok, JSON.stringify(sent.body)).toBe(true);

  const read = await api<{ quote: { publicId: string } }>(page, `/api/quotes/${quoteId}`);
  const publicId = read.body.quote.publicId;

  // A completely separate browser context: no cookies, no session, as a customer
  // tapping a link in a text message.
  const stranger = await browser.newContext();

  try {
    const strangerPage = await stranger.newPage();
    await strangerPage.goto(`/quote/${publicId}`);

    await expect(strangerPage.getByText('Weekly mowing')).toBeVisible();
    await expect(strangerPage.locator('body')).toContainText('125');

    await strangerPage.getByRole('button', { name: /accept/i }).first().click();
    await expect(strangerPage.locator('body')).toContainText(/accepted|thank/i, {
      timeout: 15_000,
    });

    // Accepting creates the job on the owner's side.
    const jobs = await api<{ jobs: { id: string; title: string }[] }>(page, '/api/jobs');
    const titles = jobs.body.jobs.map((job) => job.title).join(' ');
    expect(titles).toContain('Weekly mowing');

    /*
     * And the owner can see what that job cost them.
     *
     * The figures are mostly unknown on a job nobody has worked yet — no pay
     * rate, no hours, no measured drive — and that is the case worth asserting:
     * the screen says which parts it could not work out instead of totalling the
     * unknowns as zero and reporting a profit that is not there.
     */
    const job = jobs.body.jobs.find((one) => one.title === 'Weekly mowing')!;
    await page.goto(`/jobs/${job.id}`);

    await expect(page.getByText('What this job cost')).toBeVisible();
    await expect(page.getByText('Partial — some of the cost is not known yet.')).toBeVisible();
    await expect(page.getByText(/No pay rate is set/)).toBeVisible();
  } finally {
    await stranger.close();
  }
});

test('an unguessable quote id is required — a wrong one reveals nothing', async ({ page }) => {
  // The public id is the only credential on that page, so a miss must look the
  // same as a quote that never existed.
  const response = await page.goto('/quote/aaaaaaaaaaaaaaaaaaaaaa');

  expect(response?.status()).toBe(404);
  await expect(page.locator('body')).not.toContainText(/prisma|stack|at \w+ \(/i);
});
