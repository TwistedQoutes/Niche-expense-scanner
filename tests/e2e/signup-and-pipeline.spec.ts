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

/**
 * The screen that used to promise what it could not deliver.
 *
 * With no email provider configured — which is how this suite runs, and how a
 * first deployment starts — a reset link cannot be sent. Telling somebody to
 * check their spam folder for it turns a forgotten password into an account
 * nobody can recover, with the product insisting it did its part.
 */
test('password reset says so when the deployment cannot send email', async ({ page }) => {
  await page.goto('/forgot-password');

  await expect(page.getByText('This site cannot send email yet')).toBeVisible();
  // And it does not take an address it cannot do anything with.
  await expect(page.getByRole('button', { name: /send the reset link/i })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /back to sign in/i })).toBeVisible();

  await expectNoServerError(page);
});
