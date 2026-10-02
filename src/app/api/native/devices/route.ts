import { validationFailed } from '@/lib/api/errors';
import { readJsonBody, withRoute } from '@/lib/api/handler';
import { RATE_LIMITS, enforceRateLimit } from '@/lib/api/rate-limit';
import { jsonOk, toFieldErrors } from '@/lib/api/response';
import { requireAuth } from '@/lib/auth/context';
import { forgetDevice, registerDevice } from '@/lib/push/devices';
import { forgetDeviceSchema, registerDeviceSchema } from '@/lib/validation/devices';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Where the mobile apps say "this phone will take notifications for this
 * workspace".
 *
 * Called on every launch, not only when permission is first granted: FCM
 * rotates tokens on its own schedule and a stale one fails silently, which
 * presents as "notifications just stopped working" weeks later with nothing in
 * any log. Re-registering is an upsert, so the repetition costs one row write.
 *
 * No role check. A crew member needs the notification about the job they have
 * been assigned at least as much as the owner does, and registering a phone
 * grants no access to anything.
 */
export const POST = withRoute(async (request) => {
  const auth = await requireAuth();
  // Keyed on the user rather than the workspace: this is a per-device action,
  // and one person's phone with a flapping connection should not use up a
  // shared allowance and lock out their colleagues.
  enforceRateLimit(RATE_LIMITS.write, auth.user.id);

  const parsed = registerDeviceSchema.safeParse(await readJsonBody(request));
  if (!parsed.success) throw validationFailed(toFieldErrors(parsed.error));

  await registerDevice(auth.db, auth.organization.id, {
    userId: auth.user.id,
    token: parsed.data.token,
    platform: parsed.data.platform,
  });

  return jsonOk({ registered: true });
});

/**
 * Sign-out, from the phone's side.
 *
 * Without this a signed-out handset keeps receiving a workspace's lead
 * notifications — customer names on the lock screen of someone who has left the
 * business. The app calls it before clearing the session.
 */
export const DELETE = withRoute(async (request) => {
  const auth = await requireAuth();
  enforceRateLimit(RATE_LIMITS.write, auth.user.id);

  const parsed = forgetDeviceSchema.safeParse(await readJsonBody(request));
  if (!parsed.success) throw validationFailed(toFieldErrors(parsed.error));

  // Scoped to this workspace by the tenant client, so one business cannot
  // unregister a phone belonging to another even if it learns the token.
  await forgetDevice(auth.db, parsed.data.token);

  return jsonOk({ forgotten: true });
});
