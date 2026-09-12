import { expect, type Page } from '@playwright/test';

/**
 * The small amount of shared machinery the end-to-end specs need.
 *
 * Every spec signs up its **own** workspace rather than sharing a fixture. That
 * costs a second and buys two things: the specs can run in parallel without
 * fighting over the same rows, and each one exercises the real signup path, which
 * is the first thing a new customer touches and therefore the first thing worth
 * knowing is unbroken.
 */

/** A password that satisfies the real policy, used only by tests. */
export const TEST_PASSWORD = 'CorrectHorse9!';

let counter = 0;

/** Values no other run will collide with, even running in parallel. */
export function unique(label: string) {
  counter += 1;
  const token = `${Date.now().toString(36)}${counter}${Math.random().toString(36).slice(2, 7)}`;

  return {
    email: `${label}-${token}@example.test`,
    businessName: `${label} ${token}`,
    // The 555 exchange is reserved for fiction, so a stray message has nowhere
    // real to land even if something goes wrong.
    phone: `+1512555${String(1000 + (counter % 9000)).slice(0, 4)}`,
  };
}

export type Workspace = {
  email: string;
  businessName: string;
  phone: string;
};

/** Signs up a fresh workspace through the real form and lands on the dashboard. */
export async function signUp(page: Page, label: string): Promise<Workspace> {
  const who = unique(label);

  await page.goto('/signup');
  await page.getByLabel('Your name').fill('Test Owner');
  await page.getByLabel('Business name').fill(who.businessName);
  await page.getByLabel('Email').fill(who.email);
  await page.getByLabel('Password', { exact: true }).fill(TEST_PASSWORD);

  // Watch the response rather than only the URL. Signup is rate-limited per IP
  // (20/hour), and every run of this suite comes from one address, so a long
  // session against a server that has been signing test users up all afternoon
  // starts getting 429s. Waiting only for the navigation turns that into a
  // 30-second timeout whose message says nothing about the actual cause; the
  // counters are in-memory, so the fix is a fresh server, and that is worth
  // saying out loud rather than leaving someone to guess.
  const [response] = await Promise.all([
    page.waitForResponse((r) => r.url().includes('/api/auth/signup') && r.request().method() === 'POST'),
    page.getByRole('button', { name: /create|sign up|start/i }).click(),
  ]);

  if (response.status() === 429) {
    throw new Error(
      'Signup was rate-limited (429). The limiter is per IP and in memory: restart the ' +
        'dev server to clear it, or wait out the hour-long window.',
    );
  }

  if (!response.ok()) {
    throw new Error(`Signup failed with ${response.status()}: ${await response.text()}`);
  }

  await page.waitForURL(/\/dashboard|\/onboarding/, { timeout: 30_000 });

  return who;
}

/** Signs in an existing workspace. */
export async function signIn(page: Page, email: string): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(TEST_PASSWORD);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 30_000 });
}

/** Asserts a page is not showing a server error or a stack trace. */
export async function expectNoServerError(page: Page): Promise<void> {
  const body = await page.locator('body').innerText();

  // A customer must never see a stack trace; an owner must never see a 500 where
  // a message belongs.
  expect(body).not.toContain('Internal Server Error');
  expect(body).not.toMatch(/at \w+ \(.*:\d+:\d+\)/);
}

export type ApiResult<T> = { status: number; ok: boolean; body: T };

/**
 * Calls the API **from inside the page**, using the browser's own `fetch`.
 *
 * Not Playwright's `request` fixture: the session cookie is `Secure`, as it should
 * be in a production build, and Playwright's separate request context does not
 * send it over a plain-HTTP loopback URL. Every call would come back 401 and the
 * test would be proving nothing.
 *
 * Going through the page is also closer to the truth — it is the same fetch the
 * application's own client code makes, with the same cookies and the same origin.
 */
export async function api<T = unknown>(
  page: Page,
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<ApiResult<T>> {
  return page.evaluate(
    async ({ path, method, body }) => {
      const response = await fetch(path, {
        method: method ?? 'GET',
        ...(body === undefined
          ? {}
          : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
      });

      const text = await response.text();
      let parsed: unknown = null;
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = text;
      }

      return { status: response.status, ok: response.ok, body: parsed };
    },
    { path, method: init.method, body: init.body },
  ) as Promise<ApiResult<T>>;
}
