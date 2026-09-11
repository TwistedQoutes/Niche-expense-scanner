import { Prisma } from '@prisma/client';

import { prisma } from '@/lib/db/client';

/**
 * Multi-tenant isolation.
 *
 * Every business's rows live in the same tables, separated only by
 * `organizationId`. That works right up until one query forgets the filter —
 * and "remember the `where` clause" is not a security control, it is a hope.
 * One missing line in one list endpoint shows Business A the customer list of
 * Business B, and that is the kind of bug that ends a B2B SaaS.
 *
 * So the filter is not written by call sites at all. `forOrganization(id)`
 * returns a Prisma client that injects `organizationId` into the `where` of
 * every read and write, and into the `data` of every create, for every model
 * that is tenant-owned. A handler physically cannot ask for another tenant's
 * rows through it, because the value it would have to override is applied
 * *after* the arguments it supplied.
 *
 * Two limits worth stating plainly:
 *
 *  1. **Nested writes are not rewritten.** `data: { customer: { create: … } }`
 *     creates a row this extension never sees. Create tenant rows top-level,
 *     or pass `organizationId` explicitly in the nested payload. The repository
 *     helpers in src/lib/* follow the first rule.
 *  2. **Raw SQL bypasses it**, as raw SQL bypasses every Prisma-level rule.
 *     `$queryRaw` against a tenant table must carry its own filter.
 *
 * One ergonomic wrinkle, stated so it is not mistaken for a hole: Prisma's
 * query-level extensions run at runtime and cannot rewrite the *generated
 * types*, so a `create` still type-requires `organizationId`. Call sites
 * therefore pass `auth.organization.id` explicitly. That is not a weakness —
 * the extension overwrites whatever is supplied, so a handler that passed a
 * client-controlled value would still write the session's tenant — it just
 * means the compiler asks for a field the runtime would have added anyway.
 *
 * Postgres row-level security would close both holes at the database instead,
 * and the schema is shaped for it: a single `organizationId` column on every
 * tenant table is exactly what an RLS policy keys on. It is the natural next
 * step once the app runs behind a connection pooler that can set a per-request
 * session variable reliably.
 */

/**
 * Models carrying an `organizationId`, and therefore belonging to one tenant.
 *
 * `User` is absent on purpose: a person is not owned by a business — one
 * operator can run two of them — and their access comes from `Membership`.
 * `Organization` itself is absent because it is the tenant, not a row inside
 * one. `WebhookEvent` and `AuthToken` are platform-level.
 */
export const TENANT_MODELS = new Set<string>([
  Prisma.ModelName.Customer,
  Prisma.ModelName.Property,
  Prisma.ModelName.Lead,
  Prisma.ModelName.LeadActivity,
  Prisma.ModelName.Service,
  Prisma.ModelName.PricingRule,
  Prisma.ModelName.Quote,
  Prisma.ModelName.QuoteItem,
  Prisma.ModelName.Job,
  Prisma.ModelName.Appointment,
  Prisma.ModelName.Conversation,
  Prisma.ModelName.Message,
  Prisma.ModelName.Automation,
  Prisma.ModelName.AutomationRun,
  Prisma.ModelName.ReviewRequest,
  Prisma.ModelName.File,
  Prisma.ModelName.Notification,
  Prisma.ModelName.Usage,
  Prisma.ModelName.Invoice,
  Prisma.ModelName.AuditLog,
]);

/** Operations that select existing rows and therefore need a `where` filter. */
const WHERE_OPERATIONS = new Set<string>([
  'findUnique',
  'findUniqueOrThrow',
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'update',
  'updateMany',
  'updateManyAndReturn',
  'delete',
  'deleteMany',
  'count',
  'aggregate',
  'groupBy',
]);

/** Operations that insert rows and therefore need `organizationId` in `data`. */
const CREATE_OPERATIONS = new Set<string>(['create', 'createMany', 'createManyAndReturn']);

type AnyArgs = Record<string, unknown>;

function withOrgInWhere(args: AnyArgs, organizationId: string): AnyArgs {
  const existing = (args.where ?? {}) as AnyArgs;
  // Assigned last so a caller-supplied value cannot win. `findUnique` accepts
  // extra non-unique filters alongside its unique selector (Prisma's
  // extendedWhereUnique behaviour), so one rule covers every read.
  return { ...args, where: { ...existing, organizationId } };
}

function withOrgInData(args: AnyArgs, organizationId: string): AnyArgs {
  const data = args.data;

  if (Array.isArray(data)) {
    return {
      ...args,
      data: data.map((row) => ({ ...(row as AnyArgs), organizationId })),
    };
  }

  return { ...args, data: { ...((data ?? {}) as AnyArgs), organizationId } };
}

/**
 * A Prisma client locked to one organization.
 *
 * Build it once per request from the authenticated session — never from a
 * value the client sent — and use it for every tenant-owned query in that
 * request.
 */
export function forOrganization(organizationId: string) {
  if (!organizationId) {
    // A blank id would inject `organizationId: ''`, which matches nothing — a
    // silent empty dashboard rather than a leak, but still a bug worth naming.
    throw new Error('forOrganization() requires an organization id.');
  }

  return prisma.$extends({
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (!TENANT_MODELS.has(model)) {
            return query(args) as unknown;
          }

          let next = args as AnyArgs;

          if (CREATE_OPERATIONS.has(operation)) {
            next = withOrgInData(next, organizationId);
          } else if (operation === 'upsert') {
            // Both halves: the lookup must be scoped, and the row it may insert
            // must be stamped.
            next = withOrgInWhere(next, organizationId);
            next = {
              ...next,
              create: { ...((next.create ?? {}) as AnyArgs), organizationId },
            };
          } else if (WHERE_OPERATIONS.has(operation)) {
            next = withOrgInWhere(next, organizationId);
          }

          return query(next) as unknown;
        },
      },
    },
  });
}

export type TenantClient = ReturnType<typeof forOrganization>;
