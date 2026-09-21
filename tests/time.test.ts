import { Role } from '@prisma/client';
import { describe, expect, it } from 'vitest';

import {
  FORGOTTEN_AFTER_MINUTES,
  entryMinutes,
  looksForgotten,
  maySeeLocationOf,
} from '@/lib/time/repository';

/**
 * The rules around the clock, without a database.
 *
 * Three small functions, each of which is the answer to a question somebody will
 * ask about their own timesheet: how long was I there, why is that entry still
 * open, and who can see where I was.
 */

const at = (iso: string) => new Date(iso);

describe('how long an entry ran', () => {
  it('is the gap between the taps', () => {
    expect(
      entryMinutes({ startedAt: at('2026-05-04T09:00:00Z'), endedAt: at('2026-05-04T10:30:00Z') }),
    ).toBe(90);
  });

  it('is unknown while somebody is still on the clock', () => {
    // Not "however long it has been so far": an open entry is not a cost yet,
    // and a figure that grew while you watched it would be reporting the time of
    // day as much as the job.
    expect(entryMinutes({ startedAt: at('2026-05-04T09:00:00Z'), endedAt: null })).toBeNull();
  });

  it('refuses an entry that ended before it started', () => {
    // A device with a wrong clock, or a correction typed in badly. Negative
    // minutes would subtract from the job's labour and make it look cheaper.
    expect(
      entryMinutes({ startedAt: at('2026-05-04T09:00:00Z'), endedAt: at('2026-05-04T08:00:00Z') }),
    ).toBeNull();
  });

  it('rounds to the nearest minute', () => {
    expect(
      entryMinutes({ startedAt: at('2026-05-04T09:00:00Z'), endedAt: at('2026-05-04T09:00:40Z') }),
    ).toBe(1);
  });
});

describe('an entry nobody closed', () => {
  const started = at('2026-05-04T08:00:00Z');

  it('is not suspicious during a long working day', () => {
    // Nine hours on a summer Saturday is a day's work, not a mistake.
    const now = new Date(started.getTime() + 9 * 60 * 60_000);

    expect(looksForgotten({ startedAt: started, endedAt: null }, now)).toBe(false);
  });

  it('is flagged once it has run past any real shift', () => {
    const now = new Date(started.getTime() + (FORGOTTEN_AFTER_MINUTES + 1) * 60_000);

    expect(looksForgotten({ startedAt: started, endedAt: null }, now)).toBe(true);
  });

  it('is never flagged once it has been closed', () => {
    // A genuinely long entry that somebody did close is a fact about the day,
    // not a data problem, however late the clock-out came.
    const entry = { startedAt: started, endedAt: at('2026-05-05T09:00:00Z') };

    expect(looksForgotten(entry, at('2026-05-06T00:00:00Z'))).toBe(false);
  });
});

describe('whose pins you may look at', () => {
  const crew = { role: Role.STAFF, userId: 'user_crew' };
  const mate = 'user_mate';

  it('lets anybody see their own', () => {
    expect(maySeeLocationOf(crew, crew.userId)).toBe(true);
  });

  it('does not let one crew member look up another', () => {
    /*
     * The line that matters. Where a colleague was at two o'clock is not a
     * colleague's business, for the same reason their hourly rate is not — and
     * a product that made it visible would be building a surveillance tool out
     * of a timesheet.
     */
    expect(maySeeLocationOf(crew, mate)).toBe(false);
  });

  it.each([[Role.OWNER], [Role.ADMIN]])('lets a %s see the crew', (role) => {
    // Running a crew means knowing where the crew was. The limit is on peers,
    // not on the people responsible for the work.
    expect(maySeeLocationOf({ role, userId: 'user_boss' }, mate)).toBe(true);
  });
});
