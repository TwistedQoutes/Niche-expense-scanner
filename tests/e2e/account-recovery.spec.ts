import { expect, test, type Browser, type Page } from '@playwright/test';
import pg from 'pg';

import { TEST_PASSWORD, api, signUp } from './support';

/**
 * Getting back into an account: a teammate's password reset by their owner,
 * and a fresh email-confirmation link.
 *
 * The test run has no email provider (EMAIL_DRIVER=none), which is itself a
 * case worth covering: email-only paths must refuse and say why, and the
 * link-to-pass-on path must work, because that is exactly the situation a small
 * business without email set up is in.
 */

const NEW_PASSWORD = 'FreshStart2Go!';

async function joinAsCrew(ownerPage: Page, browser: Browser): Promise<{ email: string; page: Page; userId: string }> {
  const email = `crew-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}@example.test`;
  const invited = await api<{ inviteUrl: string }>(ownerPage, '/api/team/invites', {
    method: 'POST',
    body: { email, role: 'STAFF' },
  });
  expect(invited.status, JSON.stringify(invited.body)).toBe(201);

  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(invited.body.inviteUrl);
  await page.getByLabel('Your name').fill('Sam Crew');
  await page.getByLabel('Choose a password').fill(TEST_PASSWORD);
  await page.getByRole('button', { name: /join/i }).click();
  await page.waitForURL(/\/dashboard/, { timeout: 30_000 });

  const team = await api<{ members: { userId: string; email: string }[] }>(ownerPage, '/api/team');
  const userId = team.body.members.find((member) => member.email === email)!.userId;
  return { email, page, userId };
}

async function signInAs(page: Page, email: string, password: string): Promise<number> {
  return page.evaluate(
    async ({ email, password }) =>
      (
        await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ email, password }),
        })
      ).status,
    { email, password },
  );
}

test('an owner gets a crew member back in with a link, and the crew member chooses the password', async ({
  page,
  browser,
}) => {
  await signUp(page, 'reset');
  const crew = await joinAsCrew(page, browser);

  // Email is the first choice, and this deployment cannot send it — so it says
  // so and points at the alternative rather than pretending.
  const byEmail = await api<{ error: { message: string } }>(
    page,
    `/api/team/members/${crew.userId}/password-reset`,
    { method: 'POST', body: { delivery: 'email' } },
  );
  expect(byEmail.status).toBe(409);
  expect(byEmail.body.error.message).toMatch(/link to pass on/i);

  // Through the Team screen, as an owner would.
  await page.goto('/team');
  const row = page.locator('li', { hasText: crew.email });
  await row.getByRole('button', { name: 'Reset password' }).click();
  await expect(row.getByRole('button', { name: 'Email them a link' })).toHaveCount(0);
  await row.getByRole('button', { name: 'Get a link to text them' }).click();
  const link = (await row.locator('p.font-mono').innerText()).trim();
  expect(link).toMatch(/\/reset-password\?token=/);

  // The crew member, on their own phone, picks the new password.
  const phone = await browser.newContext();
  const phonePage = await phone.newPage();
  await phonePage.goto(new URL(link).pathname + new URL(link).search);
  await phonePage.getByLabel('New password', { exact: true }).fill(NEW_PASSWORD);
  await phonePage.getByLabel('Confirm new password', { exact: true }).fill(NEW_PASSWORD);
  await phonePage.getByRole('button', { name: /set the new password/i }).click();
  await phonePage.waitForURL(/\/login\?reset=1/, { timeout: 30_000 });

  // Every session they had is over, the new password works, the old one does not.
  expect((await api(crew.page, '/api/leads?limit=1')).status).toBe(401);
  expect(await signInAs(phonePage, crew.email, TEST_PASSWORD)).toBe(401);
  expect(await signInAs(phonePage, crew.email, NEW_PASSWORD)).toBe(200);

  // The link worked once.
  await phonePage.goto(new URL(link).pathname + new URL(link).search);
  await phonePage.getByLabel('New password', { exact: true }).fill('AnotherOne3!');
  await phonePage.getByLabel('Confirm new password', { exact: true }).fill('AnotherOne3!');
  await phonePage.getByRole('button', { name: /set the new password/i }).click();
  await expect(phonePage.getByRole('alert').first()).toBeVisible();
  expect(await signInAs(phonePage, crew.email, NEW_PASSWORD)).toBe(200);

  // And the owner's workspace has a record of who sent it.
  if (process.env.DATABASE_URL) {
    const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    const { rows } = await client.query(
      `SELECT metadata FROM audit_logs WHERE action = 'member.password_reset_sent' AND "entityId" = $1`,
      [crew.userId],
    );
    await client.end();
    expect(rows).toHaveLength(1);
    expect(rows[0].metadata).toEqual({ delivery: 'link' });
  }
});

test('nobody resets their own password this way, and crew cannot reset anyone', async ({ page, browser }) => {
  await signUp(page, 'resetrank');
  const crew = await joinAsCrew(page, browser);
  const me = await api<{ user: { id: string } }>(page, '/api/auth/me');

  const self = await api(page, `/api/team/members/${me.body.user.id}/password-reset`, {
    method: 'POST',
    body: { delivery: 'link' },
  });
  expect(self.status).toBe(403);

  const upward = await api(crew.page, `/api/team/members/${me.body.user.id}/password-reset`, {
    method: 'POST',
    body: { delivery: 'link' },
  });
  expect(upward.status).toBe(403);

  const stranger = await api(page, '/api/team/members/cmnotarealuser0000000000/password-reset', {
    method: 'POST',
    body: { delivery: 'link' },
  });
  expect(stranger.status).toBe(404);

  // Crew do not see the control at all.
  await crew.page.goto('/team');
  await expect(crew.page.getByRole('button', { name: 'Reset password' })).toHaveCount(0);
});

test('an account that also works for another business can only be reset by its own email', async ({
  page,
  browser,
}) => {
  await signUp(page, 'sharedA');
  const crew = await joinAsCrew(page, browser);

  // A second business invites the same person, who joins with the account
  // they already have.
  const otherContext = await browser.newContext();
  const other = await otherContext.newPage();
  await signUp(other, 'sharedB');
  const invited = await api<{ inviteUrl: string }>(other, '/api/team/invites', {
    method: 'POST',
    body: { email: crew.email, role: 'STAFF' },
  });
  expect(invited.status, JSON.stringify(invited.body)).toBe(201);
  const token = decodeURIComponent(invited.body.inviteUrl.split('/invite/')[1]!);
  const joined = await api(crew.page, '/api/team/invites/accept', { method: 'POST', body: { token } });
  expect(joined.status, JSON.stringify(joined.body)).toBe(200);

  // Business A must not be handed a link that would unlock business B too.
  const refused = await api<{ error: { message: string } }>(
    page,
    `/api/team/members/${crew.userId}/password-reset`,
    { method: 'POST', body: { delivery: 'link' } },
  );
  expect(refused.status).toBe(409);
  expect(refused.body.error.message).toMatch(/another business/i);
});

test('a fresh confirmation link is asked for honestly', async ({ page, browser }) => {
  const owner = await signUp(page, 'verify');

  // Settings says where things stand, and does not offer what it cannot do.
  await page.goto('/settings');
  await expect(page.getByText(`${owner.email} · Not confirmed yet`)).toBeVisible();
  await expect(page.getByText(/cannot send email yet/i)).toBeVisible();

  const resend = await api<{ error: { message: string } }>(page, '/api/auth/verify-email/resend', {
    method: 'POST',
  });
  expect(resend.status).toBe(409);

  // A dead link, opened signed out, offers a new one and says to sign in first.
  const stranger = await (await browser.newContext()).newPage();
  await stranger.goto('/verify-email?token=not-a-real-token-value-at-all');
  await stranger.getByRole('button', { name: 'Send a new confirmation link' }).click();
  await expect(stranger.getByText(/then send a new link from Settings/)).toBeVisible();
});
