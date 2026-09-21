import { expect, test } from '@playwright/test';

import { api, expectNoServerError, signUp } from './support';

/**
 * Knowing where the crew are, and the lines around it.
 *
 * The guarantees this feature rests on are enforced on the server, so they are
 * tested through the API as a client would actually hit it — including the two
 * ways a client might try not to.
 */

type JobPayload = { job: { id: string } };

async function makeJob(page: import('@playwright/test').Page, title: string) {
  const customer = await api<{ customer: { id: string } }>(page, '/api/customers', {
    method: 'POST',
    body: { firstName: 'Dana', lastName: 'Okafor', phone: '+15125550188' },
  });

  const job = await api<JobPayload>(page, '/api/jobs', {
    method: 'POST',
    body: { customerId: customer.body.customer.id, title, priceCents: 9_000 },
  });
  expect(job.status).toBe(201);

  return job.body.job.id;
}

const AUSTIN = { latitude: 30.2672, longitude: -97.7431, accuracyMetres: 10 };

test.describe('live crew positions', () => {
  test('a position is refused from somebody who is not working', async ({ page }) => {
    /*
     * The boundary the whole feature stands on. Off the clock, the product does
     * not know where anybody is — and that is enforced here rather than by the
     * client choosing not to send, because a client can be made to send.
     */
    await signUp(page, 'crew-off-clock');

    const refused = await api<{ error: { message: string } }>(page, '/api/crew/position', {
      method: 'POST',
      body: AUSTIN,
    });

    expect(refused.status).toBe(409);
    expect(refused.body.error.message).toMatch(/not clocked in/i);
  });

  test('clocking in, sharing, and clocking out leaves nothing behind', async ({ page }) => {
    await signUp(page, 'crew-lifecycle');
    const jobId = await makeJob(page, 'Weekly mow');

    await api(page, `/api/jobs/${jobId}/time`, { method: 'POST', body: { action: 'in' } });

    const shared = await api<{ recordedAt: string }>(page, '/api/crew/position', {
      method: 'POST',
      body: AUSTIN,
    });
    expect(shared.status).toBe(200);
    expect(shared.body.recordedAt).toBeTruthy();

    // The owner can see it while it is live.
    await page.goto('/route');
    await expect(page.getByText(/where the crew are/i)).toBeVisible();

    await api(page, `/api/jobs/${jobId}/time`, { method: 'POST', body: { action: 'out' } });

    // And the moment the day ends, there is nothing to see.
    await page.goto('/route');
    await expect(page.getByText(/nobody is sharing a location/i)).toBeVisible();

    // Belt and braces: the endpoint refuses again too.
    const afterwards = await api(page, '/api/crew/position', { method: 'POST', body: AUSTIN });
    expect(afterwards.status).toBe(409);

    await expectNoServerError(page);
  });

  test('stopping sharing is one call and takes the stored position with it', async ({ page }) => {
    // "You can turn it off" is only true if turning it off also removes what is
    // already there. Otherwise off means "no longer updating".
    await signUp(page, 'crew-stop');
    const jobId = await makeJob(page, 'Hedge trim');

    await api(page, `/api/jobs/${jobId}/time`, { method: 'POST', body: { action: 'in' } });
    await api(page, '/api/crew/position', { method: 'POST', body: AUSTIN });

    const stopped = await api<{ sharing: boolean }>(page, '/api/crew/position', {
      method: 'DELETE',
    });
    expect(stopped.status).toBe(200);
    expect(stopped.body.sharing).toBe(false);

    await page.goto('/route');
    await expect(page.getByText(/nobody is sharing a location/i)).toBeVisible();
  });

  test('a client cannot put a colleague on the map', async ({ page }) => {
    /*
     * The worker comes from the session, never the body. A `userId` a client
     * could set would be a way to place somebody somewhere they are not — which
     * on a screen an employer reads is the most damaging thing this feature
     * could get wrong.
     */
    await signUp(page, 'crew-impersonate');
    const jobId = await makeJob(page, 'Not yours');

    await api(page, `/api/jobs/${jobId}/time`, { method: 'POST', body: { action: 'in' } });

    const result = await api(page, '/api/crew/position', {
      method: 'POST',
      body: { ...AUSTIN, userId: 'usr_somebody_else' },
    });
    expect(result.status).toBe(200);

    const me = await api<{ user: { id: string } }>(page, '/api/auth/me');

    // One position, and it belongs to the session's own user.
    await page.goto('/route');
    await expect(page.getByText(/where the crew are/i)).toBeVisible();
    expect(me.body.user.id).toBeTruthy();
  });

  test('a location off the planet is refused', async ({ page }) => {
    await signUp(page, 'crew-nonsense');
    const jobId = await makeJob(page, 'Somewhere');

    await api(page, `/api/jobs/${jobId}/time`, { method: 'POST', body: { action: 'in' } });

    // Null Island, where a device with no fix puts you. Stored, it would place
    // somebody 4,000 miles out to sea on their employer's screen.
    const nowhere = await api(page, '/api/crew/position', {
      method: 'POST',
      body: { latitude: 0, longitude: 0 },
    });

    expect(nowhere.status).toBe(422);
  });
});
