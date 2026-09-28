import { readFileSync } from 'node:fs';

import { expect, test, type Browser, type Page } from '@playwright/test';
import { strFromU8, unzipSync } from 'fflate';
import pg from 'pg';

import { TEST_PASSWORD, addLead, api, signUp, type Workspace } from './support';

/**
 * Taking your data, and taking it away.
 *
 * The deletion half is checked against the database directly, not just through
 * the API: "the app no longer shows it" and "it is gone" are different claims,
 * and the privacy page makes the second one. So after a deletion this counts
 * every row, in every table that has an organizationId column, that still
 * carries the deleted workspace's id — and expects none.
 */

const DATABASE_URL = process.env.DATABASE_URL;

async function sql<T extends pg.QueryResultRow>(text: string, values: unknown[] = []): Promise<T[]> {
  const client = new pg.Client({ connectionString: DATABASE_URL });
  await client.connect();
  try {
    return (await client.query<T>(text, values)).rows;
  } finally {
    await client.end();
  }
}

async function organizationIdFor(businessName: string): Promise<string> {
  const rows = await sql<{ id: string }>('SELECT id FROM organizations WHERE name = $1', [businessName]);
  expect(rows).toHaveLength(1);
  return rows[0]!.id;
}

/** Rows anywhere in the schema that still belong to this organization. */
async function rowsLeftFor(organizationId: string): Promise<Record<string, number>> {
  const tables = await sql<{ table_name: string }>(
    `SELECT table_name FROM information_schema.columns
      WHERE table_schema = 'public' AND column_name = 'organizationId'`,
  );
  const left: Record<string, number> = {};
  for (const { table_name } of tables) {
    const [row] = await sql<{ count: string }>(
      `SELECT count(*)::text AS count FROM "${table_name}" WHERE "organizationId" = $1`,
      [organizationId],
    );
    if (Number(row!.count) > 0) left[table_name] = Number(row!.count);
  }
  const [org] = await sql<{ count: string }>('SELECT count(*)::text AS count FROM organizations WHERE id = $1', [
    organizationId,
  ]);
  if (Number(org!.count) > 0) left.organizations = Number(org!.count);
  return left;
}

async function userExists(email: string): Promise<boolean> {
  const rows = await sql('SELECT 1 FROM users WHERE email = $1', [email]);
  return rows.length > 0;
}

/** Invites a crew member and accepts in a fresh browser, like team-invites.spec.ts. */
async function addCrewMember(page: Page, browser: Browser): Promise<{ email: string; page: Page }> {
  const email = `crew-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}@example.test`;
  const invited = await api<{ inviteUrl: string | null }>(page, '/api/team/invites', {
    method: 'POST',
    body: { email, role: 'STAFF' },
  });
  expect(invited.status, JSON.stringify(invited.body)).toBe(201);

  const context = await browser.newContext();
  const crewPage = await context.newPage();
  await crewPage.goto(invited.body.inviteUrl!);
  await crewPage.getByLabel('Your name').fill('Sam Crew');
  await crewPage.getByLabel('Choose a password').fill(TEST_PASSWORD);
  await crewPage.getByRole('button', { name: /join/i }).click();
  await crewPage.waitForURL(/\/dashboard/, { timeout: 30_000 });

  return { email, page: crewPage };
}

async function downloadExport(page: Page): Promise<Record<string, Uint8Array>> {
  await page.goto('/settings');
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('link', { name: 'Download .zip' }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/^jobflow-[a-z0-9-]+-\d{4}-\d{2}-\d{2}\.zip$/);
  return unzipSync(readFileSync((await download.path())!));
}

test.describe('your data', () => {
  test.skip(!DATABASE_URL, 'Needs DATABASE_URL to check the database directly.');

  test('the owner downloads everything, and nothing secret comes with it', async ({ page }) => {
    const owner = await signUp(page, 'export');
    await addLead(page, { firstName: 'Dana', lastName: 'Okafor', phone: '+15125550143' });

    const files = await downloadExport(page);

    expect(Object.keys(files)).toEqual(
      expect.arrayContaining(['README.txt', 'data.json', 'business.csv', 'customers.csv', 'leads.csv', 'team.csv']),
    );

    const leads = strFromU8(files['leads.csv']!);
    expect(leads).toContain('Dana');
    expect(leads).toContain('Okafor');

    const team = strFromU8(files['team.csv']!);
    expect(team).toContain(owner.email);
    expect(team).toContain('OWNER');

    expect(strFromU8(files['business.csv']!)).toContain(owner.businessName);

    // No hash of any secret, in any file.
    for (const [name, bytes] of Object.entries(files)) {
      const text = strFromU8(bytes);
      expect(text, name).not.toMatch(/passwordHash|tokenHash|\$argon2|\$2[aby]\$/);
    }

    // The download itself is on the record, and shows up in the next one.
    const again = await downloadExport(page);
    expect(strFromU8(again['audit_log.csv']!)).toContain('workspace.exported');
  });

  test('a crew member can neither download nor delete the workspace', async ({ page, browser }) => {
    await signUp(page, 'crewlock');
    const crew = await addCrewMember(page, browser);

    expect((await api(crew.page, '/api/workspace/export')).status).toBe(403);
    expect(
      (await api(crew.page, '/api/workspace/delete', { method: 'POST', body: { confirmName: 'x', password: 'x' } }))
        .status,
    ).toBe(403);

    // And the settings page does not offer either.
    await crew.page.goto('/settings');
    await expect(crew.page.getByText('Download .zip')).toHaveCount(0);
    await expect(crew.page.getByRole('button', { name: /delete workspace/i })).toHaveCount(0);
  });

  test('deleting refuses a wrong name or password, and refuses while billing cannot be cancelled', async ({ page }) => {
    const owner: Workspace = await signUp(page, 'refuse');
    const organizationId = await organizationIdFor(owner.businessName);

    const wrongName = await api<{ error: { fieldErrors: Record<string, string> } }>(page, '/api/workspace/delete', {
      method: 'POST',
      body: { confirmName: 'Some Other Business', password: TEST_PASSWORD },
    });
    expect(wrongName.status).toBe(422);
    expect(wrongName.body.error.fieldErrors.confirmName).toBeTruthy();

    const wrongPassword = await api<{ error: { fieldErrors: Record<string, string> } }>(
      page,
      '/api/workspace/delete',
      { method: 'POST', body: { confirmName: owner.businessName, password: 'not-the-password' } },
    );
    expect(wrongPassword.status).toBe(422);
    expect(wrongPassword.body.error.fieldErrors.password).toBeTruthy();

    // A live subscription Stripe will not cancel. In this suite Stripe is a stub
    // that does not implement cancellation (or is not running at all), which is
    // exactly the outage this guards against.
    await sql(
      `UPDATE subscriptions SET "stripeSubscriptionId" = $2, status = 'ACTIVE' WHERE "organizationId" = $1`,
      [organizationId, `sub_e2e_${organizationId}`],
    );

    const billingDown = await api<{ error: { message: string } }>(page, '/api/workspace/delete', {
      method: 'POST',
      body: { confirmName: owner.businessName, password: TEST_PASSWORD },
    });
    expect(billingDown.status).toBe(502);
    expect(billingDown.body.error.message).toMatch(/nothing has been deleted/i);

    // And nothing was.
    const [still] = await sql<{ count: string }>('SELECT count(*)::text AS count FROM organizations WHERE id = $1', [
      organizationId,
    ]);
    expect(still!.count).toBe('1');
    expect(await userExists(owner.email)).toBe(true);
    expect((await api(page, '/api/leads?limit=1')).status).toBe(200);
  });

  test('the owner deletes the workspace, and every row, account and session goes with it', async ({
    page,
    browser,
  }) => {
    const owner = await signUp(page, 'delete');
    await addLead(page, { firstName: 'Priya', lastName: 'Shah', phone: '+15125550177' });
    const crew = await addCrewMember(page, browser);
    const organizationId = await organizationIdFor(owner.businessName);

    expect(Object.keys(await rowsLeftFor(organizationId)).length).toBeGreaterThan(3);

    // Through the real form: folded away, then disabled until the name matches.
    await page.goto('/settings');
    await page.getByRole('button', { name: 'Delete workspace…' }).click();
    const confirm = page.getByRole('button', { name: /delete everything permanently/i });
    await page.getByLabel('Your password').fill(TEST_PASSWORD);
    await expect(confirm).toBeDisabled();
    await page.getByLabel(/to confirm/).fill(owner.businessName.toUpperCase());
    await expect(confirm).toBeEnabled();
    await confirm.click();

    await page.waitForURL(/\/goodbye$/, { timeout: 30_000 });
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Your workspace has been deleted');

    // Gone from the database, not just from view.
    expect(await rowsLeftFor(organizationId)).toEqual({});
    expect(await userExists(owner.email)).toBe(false);
    expect(await userExists(crew.email)).toBe(false);

    // The owner is signed out here, and the crew member's still-open session
    // stops working on its next request.
    expect((await api(page, '/api/leads?limit=1')).status).toBe(401);
    expect((await api(crew.page, '/api/leads?limit=1')).status).toBe(401);

    // And the account cannot sign back in.
    await page.goto('/login');
    await page.getByLabel('Email').fill(owner.email);
    await page.getByLabel('Password').fill(TEST_PASSWORD);
    await page.getByRole('button', { name: /sign in/i }).click();
    await expect(page.getByText(/did not match/i)).toBeVisible();
  });
});
