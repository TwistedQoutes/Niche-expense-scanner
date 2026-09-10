import { withRoute } from '@/lib/api/handler';
import { jsonOk } from '@/lib/api/response';
import { getCurrentUser } from '@/lib/auth/current-user';
import type { UserDto } from '@/types';

export const runtime = 'nodejs';

export const GET = withRoute(async () => {
  const user = await getCurrentUser();
  return jsonOk<{ user: UserDto | null }>({ user });
});
