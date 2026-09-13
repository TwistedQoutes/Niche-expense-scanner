import { expect, test } from '@playwright/test';

import { addLead, expectNoServerError, signUp } from './support';

/**
 * The path a new customer actually takes on their first morning: sign up, add the
 * lead that just rang, see it on the board.
 *
 * If this breaks, nothing else matters.
 */
test('a new owner can sign up, add a lead, and see it on the board', async ({ page }) => {
  await signUp(page, 'pipeline');

  await addLead(page, { firstName: 'Renee', lastName: 'Alvarez', phone: '+15125550142' });

  await page.goto('/leads');
  // By role, not by text: the card also carries screen-reader-only text naming
  // the lead, and two matches is a strict-mode violation rather than an assertion.
  await expect(page.getByRole('link', { name: /Renee Alvarez/ })).toBeVisible();
  await expectNoServerError(page);
});

test('the board offers a way to move a card without dragging', async ({ page }) => {
  // Drag-and-drop does nothing on touch, and this product is used on a phone in a
  // truck. The select is the real interaction there, not a degraded fallback.
  await signUp(page, 'touch');

  await addLead(page, { firstName: 'Owen', phone: '+15125550143' });

  await page.goto('/leads');
  await expect(page.locator('select').first()).toBeVisible();
});

test('every built screen renders for a brand-new workspace', async ({ page }) => {
  /*
   * An empty workspace is the state every customer starts in, and it is the one
   * most easily broken by code written against populated data — a chart dividing
   * by zero, a `.at(-1)` on nothing. Each screen is loaded and checked for a
   * server error rather than for specific content.
   */
  await signUp(page, 'empty');

  for (const path of [
    '/dashboard',
    '/leads',
    '/customers',
    '/quotes',
    '/jobs',
    '/calendar',
    '/messages',
    '/automations',
    '/reviews',
    '/analytics',
    '/pricing-settings',
    '/settings',
    '/billing',
    '/onboarding',
  ]) {
    const response = await page.goto(path);

    expect(response?.status(), `${path} should render`).toBeLessThan(400);
    await expectNoServerError(page);
  }
});
