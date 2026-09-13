import { withRoute } from '@/lib/api/handler';
import { jsonOk } from '@/lib/api/response';
import { clearSessionCookie } from '@/lib/auth/session';

export const runtime = 'nodejs';

export const POST = withRoute(async () => {
  await clearSessionCookie();
  return jsonOk({ ok: true });
});
