import { Role } from '@prisma/client';

import { withRoute } from '@/lib/api/handler';
import { RATE_LIMITS, enforceRateLimit } from '@/lib/api/rate-limit';
import { requireRole } from '@/lib/auth/context';
import { exportWorkspace } from '@/lib/workspace/export';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Download everything in this workspace, as a zip of spreadsheets.
 *
 * OWNER only. It is every customer's name, phone number and address in one file
 * — the single most valuable thing in the account to a competitor — so it is
 * the owner's decision, not something an admin or a crew member can take home.
 *
 * A GET, so a plain link can download it. That is safe against cross-site
 * requests: the session cookie is SameSite=Lax and the response is a download,
 * so another site can at most make the owner's browser save a file the owner is
 * allowed to have — it can never read the bytes.
 *
 * Each download is written to the audit log, because "who took a copy of the
 * whole customer list, and when" is a question an owner may one day need
 * answered.
 */
export const GET = withRoute(async (request) => {
  const auth = await requireRole(Role.OWNER);
  enforceRateLimit(RATE_LIMITS.export, auth.organization.id);

  const archive = await exportWorkspace({ organizationId: auth.organization.id, db: auth.db });

  await auth.db.auditLog.create({
    data: {
      organizationId: auth.organization.id,
      actorUserId: auth.user.id,
      action: 'workspace.exported',
      entityType: 'organization',
      entityId: auth.organization.id,
      metadata: { tables: archive.tables, rows: archive.rows, bytes: archive.bytes.length },
      userAgent: request.headers.get('user-agent')?.slice(0, 300) ?? null,
    },
  });

  return new Response(archive.bytes as unknown as BodyInit, {
    headers: {
      'content-type': 'application/zip',
      'content-length': String(archive.bytes.length),
      'content-disposition': `attachment; filename="${archive.fileName}"`,
      // The whole customer list: never kept by a shared cache or the browser's.
      'cache-control': 'private, no-store',
    },
  });
});
