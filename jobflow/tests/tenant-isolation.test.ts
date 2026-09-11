import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The most important test in the codebase.
 *
 * Multi-tenant isolation is the one property whose failure is unrecoverable: a
 * customer list shown to the wrong business cannot be un-shown. So rather than
 * trusting that every call site remembers `where: { organizationId }`, the
 * tenant client injects it — and these cases prove the injection happens for
 * every operation shape, and that a caller cannot override it.
 *
 * Prisma is mocked at the module boundary. That is deliberate: what is under
 * test is the *arguments* the extension produces, and a real database would
 * only tell us whether the rows came back, not whether the filter was applied
 * for the right reason.
 */

/** Records the arguments each operation is finally invoked with. */
const calls: { model: string; operation: string; args: unknown }[] = [];

vi.mock('@/lib/db/client', () => {
  type Handler = (parameters: {
    model: string;
    operation: string;
    args: Record<string, unknown>;
    query: (args: Record<string, unknown>) => Promise<unknown>;
  }) => Promise<unknown>;

  const MODELS = [
    'lead',
    'customer',
    'quote',
    'job',
    'usage',
    'auditLog',
    'organization',
    'user',
    'membership',
  ];

  const OPERATIONS = [
    'findUnique',
    'findFirst',
    'findMany',
    'create',
    'createMany',
    'update',
    'updateMany',
    'upsert',
    'delete',
    'deleteMany',
    'count',
    'aggregate',
    'groupBy',
  ];

  /**
   * A stand-in for `$extends` that applies the extension exactly as Prisma
   * does: the handler is called with the caller's arguments and a `query`
   * function that represents the real operation.
   */
  function buildExtended(handler: Handler) {
    const client: Record<string, Record<string, unknown>> = {};

    for (const model of MODELS) {
      const modelName = model.charAt(0).toUpperCase() + model.slice(1);
      client[model] = {};

      for (const operation of OPERATIONS) {
        client[model]![operation] = (args: Record<string, unknown> = {}) =>
          handler({
            model: modelName,
            operation,
            args,
            query: async (finalArgs) => {
              calls.push({ model: modelName, operation, args: finalArgs });
              return null;
            },
          });
      }
    }

    return client;
  }

  return {
    prisma: {
      $extends: (extension: {
        query: { $allModels: { $allOperations: Handler } };
      }) => buildExtended(extension.query.$allModels.$allOperations),
    },
  };
});

const ORG = 'org_alpha';
const OTHER_ORG = 'org_beta';

// Imported after the mock is registered, so it binds to the fake client.
const { forOrganization, TENANT_MODELS } = await import('@/lib/db/tenant');

type AnyRecord = Record<string, unknown>;

/**
 * A loosely-typed handle on the tenant client.
 *
 * The extension supplies `organizationId` at runtime, but Prisma's *generated
 * types* still require it on a create — the query-level extension API cannot
 * rewrite input types. Real call sites therefore pass it explicitly (the
 * extension then guarantees it is the right one, which is the security
 * property; see the note in src/lib/db/tenant.ts). These cases deliberately
 * omit it, because omitting it is exactly what is being tested.
 */
type LooseClient = Record<string, Record<string, (args?: AnyRecord) => Promise<unknown>>>;

function loose(organizationId: string): LooseClient {
  return forOrganization(organizationId) as unknown as LooseClient;
}

function lastCall() {
  const call = calls.at(-1);
  if (!call) throw new Error('No query was recorded.');
  return call;
}

function lastWhere(): AnyRecord {
  return (lastCall().args as AnyRecord).where as AnyRecord;
}

function lastData(): AnyRecord {
  return (lastCall().args as AnyRecord).data as AnyRecord;
}

describe('forOrganization', () => {
  beforeEach(() => {
    calls.length = 0;
  });

  it('refuses to build a client without an organization id', () => {
    // A blank id would inject `organizationId: ''`, which silently matches
    // nothing — an empty dashboard with no error to explain it.
    expect(() => forOrganization('')).toThrow(/requires an organization id/i);
  });

  describe('reads', () => {
    const readOperations = [
      'findUnique',
      'findFirst',
      'findMany',
      'count',
      'aggregate',
      'groupBy',
    ] as const;

    it.each(readOperations)('scopes %s', async (operation) => {
      const db = loose(ORG);

      await db.lead![operation]!({ where: { status: 'NEW' } });

      expect(lastWhere()).toEqual({ status: 'NEW', organizationId: ORG });
    });

    it('adds a where clause when the caller supplies none', async () => {
      const db = forOrganization(ORG);
      await db.lead.findMany();

      expect(lastWhere()).toEqual({ organizationId: ORG });
    });

    it('scopes a findUnique by primary key', async () => {
      // The row is addressed by id, which is globally unique — so without the
      // extra filter, one guessed id reads another business's lead.
      const db = forOrganization(ORG);
      await db.lead.findUnique({ where: { id: 'lead_123' } });

      expect(lastWhere()).toEqual({ id: 'lead_123', organizationId: ORG });
    });
  });

  describe('writes', () => {
    it('stamps organizationId onto a create', async () => {
      const db = loose(ORG);
      await db.lead!.create!({ data: { firstName: 'Dana' } });

      expect(lastData()).toEqual({ firstName: 'Dana', organizationId: ORG });
    });

    it('stamps every row of a createMany', async () => {
      const db = loose(ORG);
      await db.lead!.createMany!({
        data: [{ firstName: 'Dana' }, { firstName: 'Ravi' }],
      });

      expect(lastCall().args).toEqual({
        data: [
          { firstName: 'Dana', organizationId: ORG },
          { firstName: 'Ravi', organizationId: ORG },
        ],
      });
    });

    it('scopes update, delete and their bulk forms', async () => {
      const db = loose(ORG);

      await db.lead!.update!({ where: { id: 'lead_1' }, data: { status: 'WON' } });
      expect(lastWhere()).toEqual({ id: 'lead_1', organizationId: ORG });

      await db.lead!.delete!({ where: { id: 'lead_1' } });
      expect(lastWhere()).toEqual({ id: 'lead_1', organizationId: ORG });

      await db.lead!.deleteMany!({ where: { status: 'LOST' } });
      expect(lastWhere()).toEqual({ status: 'LOST', organizationId: ORG });
    });

    it('scopes both halves of an upsert', async () => {
      // An upsert can insert. Scoping only the lookup would let a miss create a
      // row with no tenant, or with one the caller chose.
      const db = loose(ORG);

      await db.usage!.upsert!({
        where: { id: 'usage_1' },
        update: { count: 2 },
        create: { metric: 'LEADS', count: 1 },
      });

      const args = lastCall().args as AnyRecord;
      expect(args.where).toEqual({ id: 'usage_1', organizationId: ORG });
      expect(args.create).toEqual({ metric: 'LEADS', count: 1, organizationId: ORG });
    });
  });

  describe('cross-tenant access', () => {
    it('overrides an organizationId the caller tries to supply in a read', async () => {
      const db = forOrganization(ORG);

      // The attack this whole design exists to stop: a handler that passes a
      // client-controlled id straight through to the query.
      await db.customer.findMany({ where: { organizationId: OTHER_ORG } });

      expect(lastWhere()).toEqual({ organizationId: ORG });
    });

    it('overrides an organizationId the caller tries to supply in a create', async () => {
      const db = loose(ORG);

      await db.customer!.create!({
        data: { firstName: 'Mallory', organizationId: OTHER_ORG },
      });

      expect(lastData()).toEqual({ firstName: 'Mallory', organizationId: ORG });
    });

    it('gives two clients genuinely different scopes', async () => {
      await forOrganization(ORG).lead.findMany();
      await forOrganization(OTHER_ORG).lead.findMany();

      expect((calls[0]!.args as AnyRecord).where).toEqual({ organizationId: ORG });
      expect((calls[1]!.args as AnyRecord).where).toEqual({ organizationId: OTHER_ORG });
    });
  });

  describe('non-tenant models', () => {
    it('leaves User untouched', async () => {
      // A person is not owned by a business — one operator can run two — so
      // filtering users by organization would break the workspace switcher and
      // lock people out of their own accounts.
      const db = forOrganization(ORG);
      await db.user.findUnique({ where: { email: 'dana@example.com' } });

      expect(lastWhere()).toEqual({ email: 'dana@example.com' });
    });

    it('leaves Organization untouched', async () => {
      // Organization is the tenant, not a row inside one. Injecting
      // `organizationId` here would look for a column that does not exist.
      const db = forOrganization(ORG);
      await db.organization.findUnique({ where: { id: ORG } });

      expect(lastWhere()).toEqual({ id: ORG });
    });

    it('leaves Membership untouched', async () => {
      const db = forOrganization(ORG);
      await db.membership.findMany({ where: { userId: 'user_1' } });

      expect(lastWhere()).toEqual({ userId: 'user_1' });
    });
  });

  describe('the model list', () => {
    it('covers every model that carries an organizationId', () => {
      // A model added to the schema with an `organizationId` but forgotten
      // here would be completely unscoped — the exact bug this guards.
      for (const model of [
        'Customer',
        'Property',
        'Lead',
        'LeadActivity',
        'Service',
        'PricingRule',
        'Quote',
        'QuoteItem',
        'Job',
        'Appointment',
        'Conversation',
        'Message',
        'Automation',
        'AutomationRun',
        'ReviewRequest',
        'File',
        'Notification',
        'Usage',
        'Invoice',
        'AuditLog',
      ]) {
        expect(TENANT_MODELS.has(model)).toBe(true);
      }
    });

    it('excludes the models that have no organizationId column', () => {
      for (const model of ['User', 'Organization', 'Membership', 'AuthToken', 'WebhookEvent']) {
        expect(TENANT_MODELS.has(model)).toBe(false);
      }
    });
  });
});
