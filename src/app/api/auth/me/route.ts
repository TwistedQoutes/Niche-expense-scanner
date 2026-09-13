import { withRoute } from '@/lib/api/handler';
import { jsonOk } from '@/lib/api/response';
import { requireAuth } from '@/lib/auth/context';

export const runtime = 'nodejs';

/** Who the caller is, and which workspace they are acting in. */
export const GET = withRoute(async () => {
  const { user, organization, role, subscription } = await requireAuth();

  return jsonOk({
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      emailVerified: user.emailVerifiedAt !== null,
    },
    organization: {
      id: organization.id,
      slug: organization.slug,
      name: organization.name,
      industry: organization.industry,
      timezone: organization.timezone,
      currency: organization.currency,
      onboarded: organization.onboardedAt !== null,
    },
    role,
    subscription,
  });
});
