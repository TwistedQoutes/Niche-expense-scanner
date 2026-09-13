import { notFound } from '@/lib/api/errors';
import type { TenantClient } from '@/lib/db/tenant';

/**
 * Proves that relation ids sent by a caller belong to the caller's business.
 *
 * The tenant client (`forOrganization`) rewrites the **top-level** `where` and
 * `data` of the model being queried. That covers the row you are reading or
 * writing, and it is what makes a guessed `id` a 404 instead of a leak. It does
 * not, and cannot, cover two other things:
 *
 *  1. A foreign key written into your own row. `lead.create` with a
 *     `customerId` belonging to another business is a perfectly valid insert:
 *     the *lead* gets stamped with your organization, and the column just holds
 *     a cuid that Postgres is happy to point at anything.
 *  2. Reading back through that key. Prisma's nested reads for a to-one
 *     relation (`include: { customer: ... }`) take no `where` clause, so there
 *     is nowhere for the extension to add a filter even in principle. The join
 *     follows the key wherever it points.
 *
 * Together those made a real cross-tenant read: create a lead in your own
 * workspace carrying another business's `customerId` and `propertyId`, then open
 * it, and the page rendered their customer's name, email, phone and the
 * property's street address. Nothing was guessed except ids, which appear in
 * URLs that any former employee has already seen.
 *
 * So a supplied id has to be checked once, on the way in, against the tenant
 * client — where "does this row exist?" and "is this row mine?" are the same
 * question. That is the only place the check works: after the write, the
 * relation is indistinguishable from a legitimate one.
 *
 * A miss is reported as "does not exist" rather than "belongs to someone else",
 * for the same reason every other lookup here is: the difference between those
 * two answers is itself information about another business.
 *
 * Since this was written, the database enforces the same rule underneath: every
 * relation between two tenant-owned models references `(organizationId, id)`, so
 * a cross-tenant reference is a row Postgres refuses (see
 * prisma/migrations/20260913000000_tenant_composite_foreign_keys). That makes this
 * module the *first* line rather than the only one, and it is still worth having:
 * a foreign-key violation surfaces as a 500 with a Postgres error in it, where
 * this gives the caller the same 404 as any other unknown id. Belt and braces,
 * with the braces doing the talking.
 */

/** The relation ids callers are allowed to supply, across every write path. */
export type OwnedRefs = {
  customerId?: string | null | undefined;
  propertyId?: string | null | undefined;
  serviceId?: string | null | undefined;
  quoteId?: string | null | undefined;
  jobId?: string | null | undefined;
  leadId?: string | null | undefined;
};

type Check = {
  /** Reads the row through the tenant client, so the scope is applied for us. */
  find: (db: TenantClient, id: string) => Promise<{ id: string } | null>;
  /** Names the thing in the message the caller sees. */
  label: string;
};

const CHECKS: { [K in keyof Required<OwnedRefs>]: Check } = {
  customerId: {
    find: (db, id) => db.customer.findUnique({ where: { id }, select: { id: true } }),
    label: 'customer',
  },
  propertyId: {
    find: (db, id) => db.property.findUnique({ where: { id }, select: { id: true } }),
    label: 'property',
  },
  serviceId: {
    find: (db, id) => db.service.findUnique({ where: { id }, select: { id: true } }),
    label: 'service',
  },
  quoteId: {
    find: (db, id) => db.quote.findUnique({ where: { id }, select: { id: true } }),
    label: 'quote',
  },
  jobId: {
    find: (db, id) => db.job.findUnique({ where: { id }, select: { id: true } }),
    label: 'job',
  },
  leadId: {
    find: (db, id) => db.lead.findUnique({ where: { id }, select: { id: true } }),
    label: 'lead',
  },
};

/**
 * Throws `not_found` unless every id present in `refs` belongs to this tenant.
 *
 * Absent and `null` keys are skipped: clearing a relation is not a reference to
 * check. Checks run in sequence so the message names the first bad id rather
 * than whichever query happened to return first.
 */
export async function assertOwned(db: TenantClient, refs: OwnedRefs): Promise<void> {
  for (const key of Object.keys(refs) as (keyof OwnedRefs)[]) {
    const id = refs[key];
    if (typeof id !== 'string' || id === '') continue;

    const check = CHECKS[key];
    const found = await check.find(db, id);
    if (!found) throw notFound(`That ${check.label} does not exist.`);
  }
}
