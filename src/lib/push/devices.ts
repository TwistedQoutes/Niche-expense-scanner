import { DevicePlatform } from '@prisma/client';

import type { TenantClient } from '@/lib/db/tenant';
import { sendPush, type PushMessage } from '@/lib/push';

/**
 * The device registry, and sending to it.
 *
 * Everything here is tenant-scoped through `TenantClient`, so a notification
 * about one business can never reach a phone registered to another — which
 * matters more than usual, because the body of a lead notification carries a
 * customer's name.
 */

/**
 * Records a phone, or refreshes one already known.
 *
 * The app registers on every launch rather than only on first permission grant,
 * because FCM rotates tokens on its own schedule and a stale one fails
 * silently. The upsert is keyed on (organization, token), which is what keeps
 * repeated launches from accumulating rows.
 *
 * `revokedAt` is cleared on the way through: a token coming back means the app
 * was reinstalled on a handset we had written off.
 */
export async function registerDevice(
  db: TenantClient,
  organizationId: string,
  input: { userId: string; token: string; platform: DevicePlatform },
): Promise<void> {
  await db.deviceToken.upsert({
    where: { organizationId_token: { organizationId, token: input.token } },
    create: {
      organizationId,
      userId: input.userId,
      token: input.token,
      platform: input.platform,
    },
    update: {
      // The owner is updated too. A shared truck phone that someone else signs
      // into must stop delivering the previous person's notifications.
      userId: input.userId,
      platform: input.platform,
      lastSeenAt: new Date(),
      revokedAt: null,
    },
  });
}

/**
 * Forgets a phone, on sign-out.
 *
 * A hard delete, not a revocation: the person asked to stop, and keeping the
 * row would leave a record of which handset they used that serves no purpose.
 */
export async function forgetDevice(db: TenantClient, token: string): Promise<void> {
  await db.deviceToken.deleteMany({ where: { token } });
}

/** Marks tokens the push provider rejected as permanently dead. */
export async function revokeDevices(db: TenantClient, tokens: string[]): Promise<void> {
  if (tokens.length === 0) return;
  await db.deviceToken.updateMany({
    where: { token: { in: tokens } },
    data: { revokedAt: new Date() },
  });
}

/**
 * Sends to the phones of specific people in this workspace.
 *
 * Returns quietly when nobody has registered, which is the normal case for a
 * workspace whose owner only uses the web app.
 */
export async function pushToUsers(
  db: TenantClient,
  userIds: string[],
  message: Omit<PushMessage, 'tokens'>,
): Promise<void> {
  if (userIds.length === 0) return;

  const devices = await db.deviceToken.findMany({
    where: { userId: { in: userIds }, revokedAt: null },
    select: { token: true },
  });

  if (devices.length === 0) return;

  const result = await sendPush({ ...message, tokens: devices.map((device) => device.token) });

  if (result.invalidTokens.length > 0) {
    await revokeDevices(db, result.invalidTokens);
  }
}
