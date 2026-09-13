import { expect, test } from '@playwright/test';

import { api, signUp } from './support';

/**
 * The one property whose failure cannot be undone.
 *
 * `tests/tenant-isolation.test.ts` proves the data layer scopes every query. This
 * proves the same thing end to end, through real cookies and real routes — because
 * a correct data layer reached by a route that forgot to use it is still a leak,
 * and that is the mistake a growing codebase actually makes.
 */
test('one business cannot see or reach another\'s records', async ({ browser }) => {
  // Two independent browser contexts: separate cookie jars, as two real people.
  const alpha = await browser.newContext();
  const beta = await browser.newContext();

  try {
    const alphaPage = await alpha.newPage();
    const betaPage = await beta.newPage();

    await signUp(alphaPage, 'alpha');
    await signUp(betaPage, 'beta');

    // Alpha records a customer nobody else should ever see.
    await alphaPage.goto('/customers');

    const created = await api<{ customer: { id: string } }>(alphaPage, '/api/customers', {
      method: 'POST',
      body: { firstName: 'Zebediah', lastName: `Qualtrough ${Date.now()}`, phone: '+15125550188' },
    });
    expect(created.ok, JSON.stringify(created.body)).toBe(true);
    const customerId = created.body.customer.id;

    // Beta cannot list it.
    await betaPage.goto('/customers');
    await expect(betaPage.locator('body')).not.toContainText('Zebediah');

    // Beta cannot fetch it by id, even knowing the id exactly. A 404 rather than a
    // 403: telling them the record exists is itself a disclosure.
    const read = await api(betaPage, `/api/customers/${customerId}`);
    expect(read.status).toBe(404);

    // Beta cannot edit it.
    const edited = await api(betaPage, `/api/customers/${customerId}`, {
      method: 'PATCH',
      body: { firstName: 'Hijacked' },
    });
    expect(edited.status).toBe(404);

    // Beta cannot delete it.
    const deleted = await api(betaPage, `/api/customers/${customerId}`, { method: 'DELETE' });
    expect(deleted.status).toBe(404);

    // And Alpha's record is exactly as it was.
    const stillThere = await api<{ customer: { firstName: string } }>(
      alphaPage,
      `/api/customers/${customerId}`,
    );
    expect(stillThere.ok).toBe(true);
    expect(stillThere.body.customer.firstName).toBe('Zebediah');
  } finally {
    await alpha.close();
    await beta.close();
  }
});

test('a signed-out visitor is sent to sign in, not shown the app', async ({ page }) => {
  for (const path of ['/dashboard', '/leads', '/customers', '/billing', '/analytics']) {
    await page.goto(path);

    // Either redirected to login, or shown it — never the workspace itself.
    await expect(page).toHaveURL(/\/login/, { timeout: 15_000 });
  }
});

test('the platform admin surface is invisible to an ordinary owner', async ({ page }) => {
  await signUp(page, 'notadmin');

  const response = await page.goto('/admin');

  // A 404, not a 403: an unauthorised prober should not learn the surface exists.
  expect(response?.status()).toBe(404);

  await page.goto('/dashboard');
  // Both navs, named explicitly: `locator('nav')` matches the sidebar and the
  // mobile bar, and a strict-mode violation is not an assertion.
  await expect(page.getByRole('navigation', { name: 'Main' }).first()).not.toContainText(
    'All workspaces',
  );
});
