import { withRoute } from '@/lib/api/handler';
import { jsonOk } from '@/lib/api/response';
import { clearSessionCookie } from '@/lib/auth/session';

export const runtime = 'nodejs';

/**
 * POST rather than GET: a logout link that a prefetcher or an <img> tag can
 * trigger is a nuisance, and SameSite=Lax already blocks cross-site POSTs.
 */
export const POST = withRoute(async () => {
  await clearSessionCookie();
  return jsonOk({ ok: true });
});
