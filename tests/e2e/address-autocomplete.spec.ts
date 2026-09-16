import { expect, test, type Page, type Request } from '@playwright/test';

import { expectNoServerError, signUp } from './support';

/**
 * Address autocomplete, in a real browser.
 *
 * The unit suite covers what the server does with Google's payloads. What it
 * cannot see is the part a person actually touches: whether typing produces a
 * list, whether the list can be worked with a keyboard, whether choosing an
 * address fills in the three fields underneath it — and whether a burst of
 * typing produces one request or eleven, which is the difference between a
 * feature and a bill.
 *
 * Google is never reached. The page's own endpoint is intercepted in the
 * browser, so these assertions are about this application's behaviour and
 * nothing else's availability.
 */

const SUGGESTIONS = [
  {
    placeId: 'ChIJOne',
    description: '12 Oak Lane, Austin, TX 78701, USA',
    main: '12 Oak Lane',
    secondary: 'Austin, TX, USA',
  },
  {
    placeId: 'ChIJTwo',
    description: '12 Oak Street, Austin, TX 78702, USA',
    main: '12 Oak Street',
    secondary: 'Austin, TX, USA',
  },
];

const PLACE = {
  addressLine1: '12 Oak Lane',
  city: 'Austin',
  state: 'TX',
  postalCode: '78701',
  country: 'US',
  latitude: 30.2672,
  longitude: -97.7431,
  placeId: 'ChIJOne',
};

type Sent = { kind: string; input?: string; placeId?: string; sessionToken: string };

/** Answers the app's own lookup endpoint, and records what it was asked. */
async function stubLookup(page: Page): Promise<Sent[]> {
  const sent: Sent[] = [];

  await page.route('**/api/maps/autocomplete', async (route, request: Request) => {
    const body = request.postDataJSON() as Sent;
    sent.push(body);

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(
        body.kind === 'suggest' ? { suggestions: SUGGESTIONS } : { place: PLACE },
      ),
    });
  });

  return sent;
}

test.describe('typing a property address', () => {
  test('fills the city, state and ZIP from the address that was chosen', async ({ page }) => {
    const sent = await stubLookup(page);
    await signUp(page, 'address');

    await page.goto('/leads/new');
    const field = page.getByLabel('Property address');

    // A combobox, not a text box: the list has to be reachable by somebody who
    // is not using a mouse.
    await expect(field).toHaveAttribute('role', 'combobox');

    await field.fill('12 Oak');

    const listbox = page.getByRole('listbox', { name: 'Address suggestions' });
    await expect(listbox).toBeVisible();
    // Scoped to the listbox: the "where did they come from?" select on this same
    // form is full of <option> elements, which carry the same role.
    const options = listbox.getByRole('option');
    await expect(options).toHaveCount(2);

    // Down to the first option, Enter to take it — no mouse involved.
    await field.press('ArrowDown');
    await expect(options.first()).toHaveAttribute('aria-selected', 'true');
    await field.press('Enter');

    await expect(listbox).toBeHidden();
    await expect(field).toHaveValue('12 Oak Lane');
    await expect(page.getByLabel('City')).toHaveValue('Austin');
    await expect(page.getByLabel('State')).toHaveValue('TX');
    await expect(page.getByLabel('ZIP')).toHaveValue('78701');

    // The three fields most likely to be mistyped were not typed at all.
    const suggest = sent.filter((one) => one.kind === 'suggest');
    const resolve = sent.filter((one) => one.kind === 'resolve');
    expect(resolve).toHaveLength(1);
    expect(resolve[0]?.placeId).toBe('ChIJOne');

    // One session for the whole address, suggestions and lookup alike. Google
    // bills a session once and a loose request every time.
    const tokens = new Set(sent.map((one) => one.sessionToken));
    expect(tokens.size).toBe(1);

    // And choosing an address does not ask for suggestions for the text it
    // just wrote — which would reopen the list on the address already picked.
    expect(suggest.every((one) => one.input !== '12 Oak Lane')).toBe(true);

    await expectNoServerError(page);
  });

  test('asks once for a burst of typing, and not at all for two characters', async ({ page }) => {
    const sent = await stubLookup(page);
    await signUp(page, 'address');

    await page.goto('/leads/new');
    const field = page.getByLabel('Property address');

    await field.pressSequentially('12', { delay: 30 });
    // Below the floor: nothing to identify an address with, so nothing is spent.
    await page.waitForTimeout(600);
    expect(sent).toHaveLength(0);

    await field.pressSequentially(' Oak Lane', { delay: 30 });
    await expect(page.getByRole('listbox')).toBeVisible();
    await page.waitForTimeout(600);

    // Nine more keystrokes, one request: the debounce is doing its job. Without
    // it this is one billed call per character typed.
    expect(sent).toHaveLength(1);
    expect(sent[0]?.input).toBe('12 Oak Lane');
  });

  test('keeps working as an ordinary field when the lookup fails', async ({ page }) => {
    // Rate-limited, unconfigured, offline — all the same to somebody typing.
    await page.route('**/api/maps/autocomplete', (route) =>
      route.fulfill({
        status: 429,
        contentType: 'application/json',
        body: JSON.stringify({ error: { message: 'Slow down.' } }),
      }),
    );

    await signUp(page, 'address');
    await page.goto('/leads/new');

    await page.getByLabel('Property address').fill('12 Oak Lane');
    await page.waitForTimeout(600);

    await expect(page.getByRole('listbox')).toBeHidden();
    // The address survives, and the form still submits.
    await expect(page.getByLabel('Property address')).toHaveValue('12 Oak Lane');

    await page.getByLabel('First name').fill('Dana');
    await page.getByLabel('Phone').fill('+15125550101');

    // Waiting on the response, not only the URL: `/leads/new` matches any
    // pattern for `/leads/<id>`, so a URL wait passes before anything has been
    // submitted and the assertion below would be made against the form.
    const [response] = await Promise.all([
      page.waitForResponse(
        (one) => one.url().includes('/api/leads') && one.request().method() === 'POST',
      ),
      page.getByRole('button', { name: 'Add lead' }).click(),
    ]);
    expect(response.ok()).toBe(true);

    await page.waitForURL((url) => /\/leads\/[^/]+$/.test(url.pathname) && !url.pathname.endsWith('/new'), {
      timeout: 30_000,
    });
    await expect(page.getByText('12 Oak Lane')).toBeVisible();
    await expectNoServerError(page);
  });
});
