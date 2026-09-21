import { expect, test } from '@playwright/test';

import { api, signUp } from './support';

/**
 * A second person getting into the workspace.
 *
 * Worth an end-to-end test rather than unit coverage because the interesting half
 * happens with no session at all: the invited person may have no account, opens a
 * link in a browser that has never seen this site, and ends up signed in to
 * somebody else's business. Every step of that crosses a boundary a mock would
 * paper over.
 *
 * These read the invitation link out of the API response rather than an inbox.
 * That is not a testing shortcut — when the deployment cannot send email the route
 * hands the link back to the inviter on purpose, so half of small operators can
 * pass it on over WhatsApp. The suite uses the same door they do.
 */

type InviteResponse = { delivered: boolean; inviteUrl?: string };

test('an invited teammate joins, can work, and cannot invite anyone else', async ({
  page,
  browser,
}) => {
  const owner = await signUp(page, 'inviter');
  const crewEmail = `crew-${Date.now().toString(36)}@example.test`;

  const invited = await api<InviteResponse>(page, '/api/team/invites', {
    method: 'POST',
    body: { email: crewEmail, role: 'STAFF' },
  });

  expect(invited.status, JSON.stringify(invited.body)).toBe(201);
  const inviteUrl = invited.body.inviteUrl;
  expect(inviteUrl, 'the link is returned when email is not configured').toBeTruthy();

  // The invitation holds a seat before anybody accepts it, or the limit is a
  // suggestion — see the note in src/lib/team/repository.ts.
  const before = await api<{ seats: { used: number }; invites: unknown[] }>(page, '/api/team');
  expect(before.body.seats.used).toBe(2);
  expect(before.body.invites).toHaveLength(1);

  // A browser that has never seen this site, which is the real situation.
  const stranger = await browser.newContext();
  const strangerPage = await stranger.newPage();
  await strangerPage.goto(inviteUrl!);

  await expect(strangerPage.getByRole('heading', { name: /join/i })).toContainText(
    owner.businessName,
  );

  await strangerPage.getByLabel('Your name').fill('Sam Crew');
  await strangerPage.getByLabel('Choose a password').fill('CorrectHorse9!');
  await strangerPage.getByRole('button', { name: /join/i }).click();

  // Accepting signs them in: they hold a link sent to their address and have just
  // chosen a password, which is more than signup asks for.
  await strangerPage.waitForURL(/\/dashboard/, { timeout: 30_000 });

  // They can do the job they were hired for.
  const leads = await api(strangerPage, '/api/leads?limit=5');
  expect(leads.status).toBe(200);

  // And not the things that decide who else gets in, or what the business charges.
  const escalation = await api(strangerPage, '/api/team/invites', {
    method: 'POST',
    body: { email: 'someone-else@example.test', role: 'ADMIN' },
  });
  expect(escalation.status).toBe(403);

  // The owner now sees two people and no outstanding invitation.
  type TeamRow = { userId: string; role: string; hourlyRateCents: number | null; payVisible: boolean };
  const after = await api<{ members: TeamRow[]; invites: unknown[] }>(page, '/api/team');
  expect(after.body.members).toHaveLength(2);
  expect(after.body.invites).toHaveLength(0);

  /*
   * Pay, which is the most sensitive column in the product.
   *
   * The owner sets a rate for the crew member and one for themselves — an
   * owner-operator costing their own hours is the ordinary case, and the rank
   * rule allows acting on yourself for pay where it refuses it for roles.
   */
  const crew = after.body.members.find((member) => member.role === 'STAFF')!;
  const ownerRow = after.body.members.find((member) => member.role === 'OWNER')!;

  for (const [userId, rate] of [
    [crew.userId, 2_200],
    [ownerRow.userId, 4_500],
  ] as const) {
    const saved = await api(page, `/api/team/members/${userId}`, {
      method: 'PATCH',
      body: { hourlyRateCents: rate },
    });
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
  }

  // What the crew member can see of that: their own rate, and nothing where the
  // owner's would be. A crew member who can look up the payroll is the failure
  // this rule exists to prevent.
  const asCrew = await api<{ members: TeamRow[] }>(strangerPage, '/api/team');
  expect(asCrew.status).toBe(200);

  const ownerAsSeenByCrew = asCrew.body.members.find((member) => member.userId === ownerRow.userId)!;
  const selfAsSeenByCrew = asCrew.body.members.find((member) => member.userId === crew.userId)!;

  expect(ownerAsSeenByCrew.hourlyRateCents).toBeNull();
  expect(ownerAsSeenByCrew.payVisible).toBe(false);
  expect(selfAsSeenByCrew.hourlyRateCents).toBe(2_200);
  expect(selfAsSeenByCrew.payVisible).toBe(true);

  // And they cannot set one — not the owner's, and not their own.
  for (const userId of [ownerRow.userId, crew.userId]) {
    const refused = await api(strangerPage, `/api/team/members/${userId}`, {
      method: 'PATCH',
      body: { hourlyRateCents: 9_900 },
    });
    expect(refused.status).toBe(403);
  }

  // The rate the owner set is still the rate.
  const unchanged = await api<{ members: TeamRow[] }>(page, '/api/team');
  expect(unchanged.body.members.find((member) => member.userId === crew.userId)?.hourlyRateCents).toBe(2_200);

  await stranger.close();
});

test('an invitation works once, and only for the workspace that sent it', async ({
  page,
  browser,
}) => {
  await signUp(page, 'once');

  const invited = await api<InviteResponse>(page, '/api/team/invites', {
    method: 'POST',
    body: { email: `single-${Date.now().toString(36)}@example.test` },
  });
  expect(invited.status).toBe(201);
  const token = invited.body.inviteUrl!.split('/invite/')[1]!;

  // Somebody else's workspace cannot withdraw it, and is told it does not exist
  // rather than that it is not theirs.
  const otherContext = await browser.newContext();
  const otherPage = await otherContext.newPage();
  await signUp(otherPage, 'outsider');

  const listed = await api<{ invites: { id: string }[] }>(page, '/api/team');
  const inviteId = listed.body.invites[0]!.id;

  const poached = await api(otherPage, `/api/team/invites/${inviteId}`, { method: 'DELETE' });
  expect(poached.status).toBe(404);

  // Still live for the workspace that sent it.
  const stillThere = await api<{ invites: unknown[] }>(page, '/api/team');
  expect(stillThere.body.invites).toHaveLength(1);

  // Accepted once…
  const stranger = await browser.newContext();
  const strangerPage = await stranger.newPage();
  // `api()` runs fetch inside the page, so it needs an origin to be relative to.
  await strangerPage.goto('/login');
  const first = await api(strangerPage, '/api/team/invites/accept', {
    method: 'POST',
    body: { token, name: 'First Taker', password: 'CorrectHorse9!' },
  });
  expect(first.status).toBe(201);

  // …and never again, even from a different browser.
  const replayContext = await browser.newContext();
  const replayPage = await replayContext.newPage();
  await replayPage.goto('/login');
  const replay = await api(replayPage, '/api/team/invites/accept', {
    method: 'POST',
    body: { token, name: 'Second Taker', password: 'CorrectHorse9!' },
  });
  expect(replay.status).toBe(409);

  // A spent link and a made-up one look the same, so walking the id space tells
  // you nothing about which guesses landed.
  await replayPage.goto(`/invite/${token}`);
  await expect(replayPage.getByText(/not valid any more/i)).toBeVisible();

  await Promise.all([otherContext.close(), stranger.close(), replayContext.close()]);
});
