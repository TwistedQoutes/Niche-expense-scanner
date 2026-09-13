import { Role } from '@prisma/client';

import { validationFailed } from '@/lib/api/errors';
import { readJsonBody, withRoute } from '@/lib/api/handler';
import { RATE_LIMITS, enforceRateLimit } from '@/lib/api/rate-limit';
import { jsonOk, toFieldErrors } from '@/lib/api/response';
import { requireRole } from '@/lib/auth/context';
import { prisma } from '@/lib/db/client';
import { markOnboarded, setIndustry } from '@/lib/onboarding/repository';
import { onboardingBodySchema } from '@/lib/validation/onboarding';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * One step of the setup wizard.
 *
 * ADMIN and up, and the workspace comes from the session — the same rules as
 * Settings, because this writes the same fields. The wizard is a guided path
 * through them, not a second way in with weaker checks.
 */
export const POST = withRoute(async (request) => {
  const auth = await requireRole(Role.ADMIN);
  enforceRateLimit(RATE_LIMITS.write, auth.organization.id);

  const parsed = onboardingBodySchema.safeParse(await readJsonBody(request));
  if (!parsed.success) throw validationFailed(toFieldErrors(parsed.error));

  const body = parsed.data;
  const organizationId = auth.organization.id;

  switch (body.step) {
    case 'trade': {
      const result = await setIndustry(auth.db, organizationId, body.industry);
      return jsonOk(result);
    }

    case 'business': {
      await prisma.organization.update({
        where: { id: organizationId },
        data: {
          phone: body.phone,
          timezone: body.timezone,
          ...(body.city === undefined ? {} : { city: body.city }),
          ...(body.state === undefined ? {} : { state: body.state }),
        },
      });
      return jsonOk({ ok: true });
    }

    case 'pricing': {
      await prisma.organization.update({
        where: { id: organizationId },
        data: {
          defaultLaborRateCents: body.defaultLaborRateCents,
          defaultProfitMarginBps: body.defaultProfitMarginBps,
          defaultMinimumJobCents: body.defaultMinimumJobCents,
        },
      });
      return jsonOk({ ok: true });
    }

    case 'reviews': {
      await prisma.organization.update({
        where: { id: organizationId },
        data: { reviewUrl: body.reviewUrl },
      });
      return jsonOk({ ok: true });
    }

    case 'finish': {
      await markOnboarded(organizationId);
      return jsonOk({ ok: true });
    }
  }
});
