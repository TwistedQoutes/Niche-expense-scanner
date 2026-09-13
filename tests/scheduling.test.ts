import { JobStatus } from '@prisma/client';
import { describe, expect, it } from 'vitest';

import { describeConflict } from '@/lib/scheduling/repository';
import { isEmpty, minutesBetween, overlaps, type Interval } from '@/lib/scheduling/overlap';
import { canTransition, isTerminal } from '@/lib/jobs/repository';
import { createAppointmentSchema, scheduleJobSchema, updateAppointmentSchema } from '@/lib/validation/scheduling';

const at = (iso: string) => new Date(iso);
const slot = (start: string, end: string): Interval => ({ startsAt: at(start), endsAt: at(end) });

describe('whether two bookings collide', () => {
  const morning = slot('2026-09-14T09:00:00Z', '2026-09-14T10:00:00Z');

  it('lets a crew work back to back', () => {
    // The case that makes or breaks a working day: 9–10 and 10–11 must not clash,
    // or a full morning of appointments reads as five double-bookings.
    expect(overlaps(morning, slot('2026-09-14T10:00:00Z', '2026-09-14T11:00:00Z'))).toBe(false);
    expect(overlaps(slot('2026-09-14T08:00:00Z', '2026-09-14T09:00:00Z'), morning)).toBe(false);
  });

  it('catches a genuine clash whichever way round it is', () => {
    const overlapping = slot('2026-09-14T09:30:00Z', '2026-09-14T10:30:00Z');

    expect(overlaps(morning, overlapping)).toBe(true);
    expect(overlaps(overlapping, morning)).toBe(true);
  });

  it('catches one visit swallowing another', () => {
    const allDay = slot('2026-09-14T08:00:00Z', '2026-09-14T17:00:00Z');
    const inside = slot('2026-09-14T09:15:00Z', '2026-09-14T09:45:00Z');

    expect(overlaps(allDay, inside)).toBe(true);
    expect(overlaps(inside, allDay)).toBe(true);
  });

  it('catches the same slot booked twice', () => {
    expect(overlaps(morning, slot('2026-09-14T09:00:00Z', '2026-09-14T10:00:00Z'))).toBe(true);
  });

  it('leaves different days alone', () => {
    expect(overlaps(morning, slot('2026-09-15T09:00:00Z', '2026-09-15T10:00:00Z'))).toBe(false);
  });

  it('agrees with the SQL range condition it is paired with', () => {
    /*
     * `findConflicts` asks Postgres for `startsAt < newEnd AND endsAt > newStart`
     * and this function is applied to the rows that come back. If the two ever
     * disagreed, a clash would be found by one and missed by the other; this pins
     * them together over every arrangement of two intervals.
     */
    const sqlCondition = (row: Interval, candidate: Interval) =>
      row.startsAt < candidate.endsAt && row.endsAt > candidate.startsAt;

    const times = [9, 10, 11, 12];
    const intervals: Interval[] = [];
    for (const start of times) {
      for (const end of times) {
        if (end > start) {
          intervals.push(
            slot(
              `2026-09-14T${String(start).padStart(2, '0')}:00:00Z`,
              `2026-09-14T${String(end).padStart(2, '0')}:00:00Z`,
            ),
          );
        }
      }
    }

    expect(intervals.length).toBeGreaterThan(5);

    for (const a of intervals) {
      for (const b of intervals) {
        expect(sqlCondition(a, b)).toBe(overlaps(a, b));
      }
    }
  });

  it('knows a zero-length booking reserves nothing', () => {
    // It would silently never conflict, which is why validation requires at least
    // five minutes rather than relying on the overlap rule to catch it.
    const instant = slot('2026-09-14T09:00:00Z', '2026-09-14T09:00:00Z');

    expect(isEmpty(instant)).toBe(true);
    expect(overlaps(instant, morning)).toBe(false);
    expect(isEmpty(morning)).toBe(false);
  });

  it('measures a booking in minutes', () => {
    expect(minutesBetween(morning)).toBe(60);
    expect(minutesBetween(slot('2026-09-14T09:00:00Z', '2026-09-14T09:45:00Z'))).toBe(45);
  });
});

describe('what a clash message says', () => {
  it('names the job and the time in the business timezone', () => {
    const message = describeConflict(
      [{ title: 'Mowing — Dana Reply', startsAt: at('2026-09-14T13:00:00Z') }],
      'America/New_York',
    );

    expect(message).toContain('Mowing — Dana Reply');
    expect(message).toContain('9:00 AM');
    // The owner is told they can override, because sometimes two crews really do
    // work at once.
    expect(message).toContain('book it anyway');
  });

  it('counts the others without listing them all', () => {
    const clashes = [
      { title: 'First', startsAt: at('2026-09-14T13:00:00Z') },
      { title: 'Second', startsAt: at('2026-09-14T13:30:00Z') },
      { title: 'Third', startsAt: at('2026-09-14T13:45:00Z') },
    ];

    expect(describeConflict(clashes, 'UTC')).toContain('2 others');
    expect(describeConflict(clashes.slice(0, 2), 'UTC')).toContain('1 other');
    expect(describeConflict(clashes.slice(0, 2), 'UTC')).not.toContain('1 others');
  });
});

describe('which way a job can move', () => {
  it('follows the working order', () => {
    expect(canTransition(JobStatus.SCHEDULED, JobStatus.CONFIRMED)).toBe(true);
    expect(canTransition(JobStatus.CONFIRMED, JobStatus.IN_PROGRESS)).toBe(true);
    expect(canTransition(JobStatus.IN_PROGRESS, JobStatus.COMPLETED)).toBe(true);
  });

  it('can be cancelled from anywhere before it is finished', () => {
    expect(canTransition(JobStatus.SCHEDULED, JobStatus.CANCELLED)).toBe(true);
    expect(canTransition(JobStatus.CONFIRMED, JobStatus.CANCELLED)).toBe(true);
    expect(canTransition(JobStatus.IN_PROGRESS, JobStatus.CANCELLED)).toBe(true);
  });

  it('will not let a finished job move again', () => {
    // Re-completing would increment lifetime value a second time, and re-fire the
    // review request. Neither is recoverable by looking at the job later.
    for (const status of Object.values(JobStatus)) {
      expect(canTransition(JobStatus.COMPLETED, status)).toBe(false);
      expect(canTransition(JobStatus.CANCELLED, status)).toBe(false);
    }

    expect(isTerminal(JobStatus.COMPLETED)).toBe(true);
    expect(isTerminal(JobStatus.CANCELLED)).toBe(true);
    expect(isTerminal(JobStatus.IN_PROGRESS)).toBe(false);
  });

  it('will not complete a job straight from scheduled', () => {
    // There is no evidence anybody did the work: the job was never even confirmed.
    expect(canTransition(JobStatus.SCHEDULED, JobStatus.COMPLETED)).toBe(false);
  });

  it('never lets a job move to the state it is already in', () => {
    for (const status of Object.values(JobStatus)) {
      expect(canTransition(status, status)).toBe(false);
    }
  });
});

describe('what the scheduling form will accept', () => {
  const valid = { title: 'Mow the front lawn', date: '2026-09-14', time: '09:00' };

  it('takes a date and a time of day, not an instant', () => {
    const parsed = createAppointmentSchema.safeParse(valid);

    expect(parsed.success).toBe(true);
    // An hour unless told otherwise, which is the common visit.
    expect(parsed.data?.durationMinutes).toBe(60);
    // Overriding a clash is opt-in.
    expect(parsed.data?.allowConflict).toBe(false);
  });

  it('refuses a time that is not a time', () => {
    for (const time of ['9:00', '25:00', '09:60', '', 'morning', '09:00:00']) {
      expect(createAppointmentSchema.safeParse({ ...valid, time }).success).toBe(false);
    }
  });

  it('refuses a date the picker would never produce', () => {
    for (const date of ['14/09/2026', '2026-9-14', 'tomorrow', '']) {
      expect(createAppointmentSchema.safeParse({ ...valid, date }).success).toBe(false);
    }
  });

  it('refuses a visit of no length, and one longer than a working day', () => {
    expect(createAppointmentSchema.safeParse({ ...valid, durationMinutes: 0 }).success).toBe(false);
    expect(createAppointmentSchema.safeParse({ ...valid, durationMinutes: -60 }).success).toBe(false);
    expect(createAppointmentSchema.safeParse({ ...valid, durationMinutes: 4800 }).success).toBe(false);
    expect(createAppointmentSchema.safeParse({ ...valid, durationMinutes: 720 }).success).toBe(true);
  });

  it('will not take half a reschedule', () => {
    // A date without a time would book midnight, silently.
    expect(updateAppointmentSchema.safeParse({ date: '2026-09-15' }).success).toBe(false);
    expect(updateAppointmentSchema.safeParse({ time: '11:00' }).success).toBe(false);
    expect(updateAppointmentSchema.safeParse({ date: '2026-09-15', time: '11:00' }).success).toBe(true);
  });

  it('refuses an update with nothing in it', () => {
    expect(updateAppointmentSchema.safeParse({}).success).toBe(false);
  });

  it('lets a job be booked and assigned in one call', () => {
    const parsed = scheduleJobSchema.safeParse({
      date: '2026-09-14',
      time: '09:00',
      durationMinutes: 90,
      assignedUserId: null,
    });

    expect(parsed.success).toBe(true);
    expect(parsed.data?.durationMinutes).toBe(90);
  });
});
