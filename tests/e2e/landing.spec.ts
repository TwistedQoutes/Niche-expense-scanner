import { expect, test } from '@playwright/test';

/**
 * The front door.
 *
 * Nothing else in the suite visits `/` as a stranger does: every other spec
 * signs up first. So this checks the things a visitor, or a link preview, meets
 * before they have an account — that the page renders, that every "Start free"
 * leads somewhere, that the share card exists, and that the page asks no other
 * host for anything.
 */

test('the landing page renders, and every call to action leads to signup', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));

  const response = await page.goto('/');
  expect(response?.status()).toBe(200);

  await expect(page.getByRole('heading', { level: 1 })).toContainText('Turn leads into jobs.');

  const startFree = page.getByRole('link', { name: /^Start free/ });
  expect(await startFree.count()).toBeGreaterThan(1);
  for (const href of await startFree.evaluateAll((links) => links.map((link) => link.getAttribute('href')))) {
    expect(href).toBe('/signup');
  }

  // Every in-page anchor in the header lands on a section that exists.
  for (const id of ['how-it-works', 'pricing', 'questions']) {
    await expect(page.locator(`#${id}`)).toHaveCount(1);
  }

  expect(errors).toEqual([]);
});

test('a question opens when tapped', async ({ page }) => {
  await page.goto('/');
  const question = page.locator('#questions details').first();
  await expect(question).not.toHaveAttribute('open');
  await question.locator('summary').click();
  await expect(question).toHaveAttribute('open');
});

/*
 * The CSP already forbids other hosts; this is the check that the page does
 * not *try*. A blocked font or script is a console error in production and a
 * silently different page — and a request to a third party from the home page
 * tells that party who is visiting.
 */
test('the landing page asks no other host for anything', async ({ page, baseURL }) => {
  const origin = new URL(baseURL!).origin;
  const elsewhere: string[] = [];
  page.on('request', (request) => {
    const url = request.url();
    if (url.startsWith('data:') || url.startsWith('blob:')) return;
    if (new URL(url).origin !== origin) elsewhere.push(url);
  });

  await page.goto('/', { waitUntil: 'networkidle' });
  expect(elsewhere).toEqual([]);
});

test('the share card is an absolute image link that resolves', async ({ page, request }) => {
  await page.goto('/');

  const ogImage = await page.locator('meta[property="og:image"]').first().getAttribute('content');
  expect(ogImage).toMatch(/^https?:\/\//);
  await expect(page.locator('meta[name="twitter:card"]')).toHaveAttribute('content', 'summary_large_image');

  // Fetched by path: the absolute URL carries APP_URL, which in a test run is
  // the server under test but in general need not be.
  const image = await request.get(new URL(ogImage!).pathname);
  expect(image.status()).toBe(200);
  expect(image.headers()['content-type']).toBe('image/png');
  expect((await image.body()).byteLength).toBeGreaterThan(10_000);
});

test('the page fits a phone without sideways scrolling', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await page.goto('/');
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});
