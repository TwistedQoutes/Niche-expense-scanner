import { describe, expect, it, vi } from 'vitest';

import { cancelRunsForLead } from '@/lib/automations/trigger';
import type { TenantClient } from '@/lib/db/tenant';

/**
 * Stopping the chase.
 *
 * "Every sequence stops the moment the customer replies" is a promise the
 * product makes on its own automations screen, and the way to break it is to
 * cancel by the wrong handle. A follow-up aimed at somebody is not necessarily
 * filed under them: the three-touch quote sequence is filed under the *quote*.
 * Cancel by lead id alone and the person who has just answered gets "just
 * checking in" two days later — which tells them, plainly, that nobody is
 * reading.
 *
 * The database is a stub here because what is being tested is which subjects get
 * cancelled, not how an update statement runs. The end-to-end suite covers the
 * whole path, from an inbound text to an empty queue.
 */

function stubClient(quoteIds: string[]) {
  const cancelled: { subjectType: string; subjectId: string }[] = [];

  const db = {
    quote: {
      findMany: vi.fn().mockResolvedValue(quoteIds.map((id) => ({ id }))),
    },
    automationRun: {
      updateMany: vi.fn().mockImplementation(({ where }: { where: Record<string, string> }) => {
        cancelled.push({ subjectType: where.subjectType!, subjectId: where.subjectId! });
        return Promise.resolve({ count: 1 });
      }),
    },
  } as unknown as TenantClient;

  return { db, cancelled };
}

describe('a lead who replies', () => {
  it('stops the quote follow-up as well as anything filed under the lead', async () => {
    const { db, cancelled } = stubClient(['quote-1', 'quote-2']);

    const count = await cancelRunsForLead(db, 'lead-1', { reason: 'customer replied' });

    expect(cancelled).toEqual([
      { subjectType: 'lead', subjectId: 'lead-1' },
      { subjectType: 'quote', subjectId: 'quote-1' },
      { subjectType: 'quote', subjectId: 'quote-2' },
    ]);
    expect(count).toBe(3);
  });

  it('looks only at quotes raised for that lead', async () => {
    const { db } = stubClient([]);

    await cancelRunsForLead(db, 'lead-1');

    // Scoped to the lead, and through the tenant client — so a quote belonging
    // to another business is not even a candidate.
    expect(db.quote.findMany).toHaveBeenCalledWith({
      where: { leadId: 'lead-1' },
      select: { id: true },
    });
  });

  it('is happy when there is nothing to stop', async () => {
    const { db, cancelled } = stubClient([]);

    await cancelRunsForLead(db, 'lead-1');

    // Still cancels by lead: a missed-call sequence is filed under the lead and
    // there may be no quote at all.
    expect(cancelled).toEqual([{ subjectType: 'lead', subjectId: 'lead-1' }]);
  });
});
