import { expect, test } from '@playwright/test';

/**
 * The screens every business sees first, checked as a stranger sees them.
 *
 * The signup and sign-in flows themselves are covered by every spec that calls
 * signUp() or signIn(); this checks what those do not: that the page says what
 * the product does, that the password toggle works, and that the showcase
 * beside the form costs nothing on a phone.
 */

test('signup promises what provisioning delivers', async ({ page }) => {
  await page.goto('/signup');

  // The trial on screen is TRIAL_DAYS (14 unless configured), which is the
  // trial provisioning grants — both read the same setting.
  await expect(page.getByText('14 days of Pro, free. Four questions to set up.')).toBeVisible();
  await expect(page.getByText('14-day Pro trial')).toBeVisible();
  await expect(page.getByText('No card required')).toBeVisible();

  // The phone is the business's number, not an alert channel for the owner.
  await expect(page.getByLabel('Business phone')).toBeVisible();
  await expect(page.locator('body')).not.toContainText(/hot lead comes in/i);
});

test('the password can be shown and hidden again', async ({ page }) => {
  await page.goto('/login');

  const password = page.getByLabel('Password', { exact: true });
  await password.fill('CorrectHorse9!');
  await expect(password).toHaveAttribute('type', 'password');

  const toggle = page.getByRole('button', { name: 'Show password' });
  await toggle.click();
  await expect(password).toHaveAttribute('type', 'text');
  await expect(page.getByRole('button', { name: 'Hide password' })).toHaveAttribute('aria-pressed', 'true');

  await page.getByRole('button', { name: 'Hide password' }).click();
  await expect(password).toHaveAttribute('type', 'password');
  // The value survives the round trip; toggling must not clear what was typed.
  await expect(password).toHaveValue('CorrectHorse9!');
});

test('the showcase appears beside the form on a wide screen and not on a phone', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/login');
  await expect(page.getByText('Quote accepted — job created')).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByText('Quote accepted — job created')).toBeHidden();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});

test('the sign-in pages ask no other host for anything', async ({ page, baseURL }) => {
  const origin = new URL(baseURL!).origin;
  const elsewhere: string[] = [];
  page.on('request', (request) => {
    const url = request.url();
    if (url.startsWith('data:') || url.startsWith('blob:')) return;
    if (new URL(url).origin !== origin) elsewhere.push(url);
  });

  for (const path of ['/login', '/signup', '/forgot-password']) {
    await page.goto(path, { waitUntil: 'networkidle' });
  }
  expect(elsewhere).toEqual([]);
});
