import { describe, expect, it } from 'vitest';

/**
 * Foreign keys are the gap the tenant client cannot close.
 *
 * `forOrganization` rewrites the top-level `where` and `data` of the model being
 * queried, which makes a guessed row id a 404. It does nothing about an id the
 * caller writes *into* their own row: a lead created in one workspace can name
 * another workspace's `customerId`, because that column is a plain cuid and
 * Postgres will point it anywhere. Reading it back is worse — Prisma's nested
 * read for a to-one relation takes no `where`, so there is nowhere to add a
 * filter even in principle, and the join follows the key.
 *
 * That was a live cross-tenant read before this helper existed: a lead carrying
 * another business's `customerId` and `propertyId` rendered their customer's
 * name and the property's street address on the lead page.
 *
 * These cases check the one thing that closes it — that each supplied id is
 * looked up through the *tenant* client, where "does it exist?" and "is it
 * mine?" are the same question.
 */

type Call = { model: string; id: unknown };

const calls: Call[] = [];

/** Ids the fake database will admit to having. Everything else is a miss. */
const OWNED = new Set(['cust_mine', 'prop_mine', 'svc_mine', 'quote_mine', 'job_mine', 'lead_mine']);

function fakeDb() {
  const model = (name: string) => ({
    findUnique: ({ where }: { where: { id: string } }) => {
      calls.push({ model: name, id: where.id });
      return Promise.resolve(OWNED.has(where.id) ? { id: where.id } : null);
    },
  });

  return {
    customer: model('customer'),
    property: model('property'),
    service: model('service'),
    quote: model('quote'),
    job: model('job'),
    lead: model('lead'),
  };
}

const { assertOwned } = await import('@/lib/db/ownership');

// The helper takes the real TenantClient; the fake implements the parts it uses.
type Db = Parameters<typeof assertOwned>[0];
const db = fakeDb() as unknown as Db;

describe('assertOwned', () => {
  it('accepts ids the tenant client can see', async () => {
    await expect(
      assertOwned(db, { customerId: 'cust_mine', propertyId: 'prop_mine' }),
    ).resolves.toBeUndefined();
  });

  it.each([
    ['customerId', 'customer'],
    ['propertyId', 'property'],
    ['serviceId', 'service'],
    ['quoteId', 'quote'],
    ['jobId', 'job'],
    ['leadId', 'lead'],
  ])('refuses a %s the tenant client cannot see', async (key, label) => {
    await expect(assertOwned(db, { [key]: 'belongs_to_someone_else' })).rejects.toMatchObject({
      code: 'not_found',
      message: `That ${label} does not exist.`,
    });
  });

  it('says "does not exist" rather than "belongs to another business"', async () => {
    // The difference between those two answers is itself a fact about another
    // business, which is why every lookup in the product reports the first.
    await expect(assertOwned(db, { customerId: 'cust_theirs' })).rejects.toMatchObject({
      message: 'That customer does not exist.',
    });
  });

  it('checks each supplied id against its own model', async () => {
    calls.length = 0;
    await assertOwned(db, {
      customerId: 'cust_mine',
      propertyId: 'prop_mine',
      serviceId: 'svc_mine',
      quoteId: 'quote_mine',
      jobId: 'job_mine',
      leadId: 'lead_mine',
    });

    expect(calls).toEqual([
      { model: 'customer', id: 'cust_mine' },
      { model: 'property', id: 'prop_mine' },
      { model: 'service', id: 'svc_mine' },
      { model: 'quote', id: 'quote_mine' },
      { model: 'job', id: 'job_mine' },
      { model: 'lead', id: 'lead_mine' },
    ]);
  });

  it('stops at the first bad id, so the message names it', async () => {
    calls.length = 0;
    await expect(
      assertOwned(db, { customerId: 'cust_theirs', propertyId: 'prop_mine' }),
    ).rejects.toMatchObject({ message: 'That customer does not exist.' });

    expect(calls).toEqual([{ model: 'customer', id: 'cust_theirs' }]);
  });

  it('skips absent, null and empty ids without a query', async () => {
    // Clearing a relation is not a reference to check, and an empty string would
    // otherwise be reported as a missing record rather than ignored.
    calls.length = 0;
    await expect(
      assertOwned(db, { customerId: null, propertyId: undefined, jobId: '' }),
    ).resolves.toBeUndefined();

    expect(calls).toEqual([]);
  });

  it('queries nothing at all when given nothing', async () => {
    calls.length = 0;
    await expect(assertOwned(db, {})).resolves.toBeUndefined();
    expect(calls).toEqual([]);
  });
});

describe('the write paths that accept relation ids', () => {
  it('all call the helper', async () => {
    /*
     * A guard against the failure mode this whole module exists for: someone adds
     * a repository function that takes a `customerId` from a request body and
     * forgets the check. Cheap to keep honest — every module that can write one of
     * these keys has to mention `assertOwned`.
     */
    const { readFile } = await import('node:fs/promises');

    const writers = [
      'src/lib/leads/repository.ts',
      'src/lib/quotes/repository.ts',
      'src/lib/jobs/repository.ts',
      'src/lib/scheduling/repository.ts',
      'src/lib/reviews/repository.ts',
      'src/app/api/leads/[id]/route.ts',
    ];

    for (const path of writers) {
      const source = await readFile(new URL(`../${path}`, import.meta.url), 'utf8');
      expect(source, `${path} writes relation ids and must check them`).toContain('assertOwned');
    }
  });
});
