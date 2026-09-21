import Link from 'next/link';

import { Badge } from '@/components/ui/Badge';
import { Card, CardHeader } from '@/components/ui/Card';
import { STALE_AFTER_MINUTES, type CrewWhereabouts } from '@/lib/crew/repository';
import { formatDistance, type Proximity } from '@/lib/geo/distance';

/**
 * Where everybody is, for the moment somebody asks.
 *
 * Built for one situation: a customer is on the phone asking when the crew will
 * arrive, and the person answering wants to say something true. So the line each
 * person gets is the sentence you would want to read out — who, where against
 * the job they are on, and how long ago that was known.
 *
 * The staleness is not a footnote. "Two minutes ago, at the property" and
 * "forty minutes ago, two miles out" support completely different promises to a
 * customer, and a screen that showed both as a dot on a map would make them look
 * the same. A web page cannot report a position while a phone is locked, so
 * gaps are normal rather than exceptional, and the time is shown for every
 * person every time rather than only when something looks wrong.
 */
function whereabouts(row: CrewWhereabouts): string {
  const place = describe(row.atJob, row.jobTitle);
  if (place) return place;

  const fromYard = describe(row.fromBase, 'the yard');
  if (fromYard) return fromYard;

  return 'Location shared, but there is nothing to measure it against yet.';
}

function describe(proximity: Proximity, place: string | null): string | null {
  if (!place || proximity.kind === 'unknown') return null;

  if (proximity.kind === 'at_property') return `At ${place}.`;

  if (proximity.kind === 'too_vague') {
    // The phone said "somewhere in this town". Saying so is more useful than a
    // distance that reads like a fact.
    return `Near ${place}, but the fix is too rough to say how near — the phone was only sure to within ${formatDistance(
      proximity.accuracyMetres / 0.3048,
    )}.`;
  }

  return `${formatDistance(proximity.feet)} from ${place}.`;
}

function minutesAgo(then: Date, now: Date): number {
  return Math.max(0, Math.round((now.getTime() - then.getTime()) / 60_000));
}

function howLongAgo(minutes: number): string {
  if (minutes < 1) return 'just now';
  if (minutes === 1) return 'a minute ago';
  if (minutes < 60) return `${minutes} minutes ago`;

  const hours = Math.round(minutes / 60);
  return hours === 1 ? 'an hour ago' : `${hours} hours ago`;
}

export function CrewNow({ crew, now }: { crew: CrewWhereabouts[]; now: Date }) {
  if (crew.length === 0) {
    return (
      <Card>
        <CardHeader
          title="Nobody is sharing a location"
          description="A crew member's position appears here while they are clocked in and have the app open. It is deleted when they clock out."
        />
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader
        title="Where the crew are"
        description={`Shared while clocked in, and only then. Anything older than ${STALE_AFTER_MINUTES} minutes is marked.`}
      />

      <ul className="divide-y divide-slate-100 dark:divide-slate-800">
        {crew.map((row) => {
          const ago = minutesAgo(row.recordedAt, now);

          return (
            <li key={row.userId} className="space-y-1 px-4 py-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="text-sm font-medium text-slate-900 dark:text-slate-100">
                  {row.name}
                </span>

                <span className="flex items-center gap-2">
                  {row.stale ? <Badge tone="urgent">out of date</Badge> : null}
                  <span className="text-xs text-slate-500 dark:text-slate-400">
                    {howLongAgo(ago)}
                  </span>
                </span>
              </div>

              <p className="text-sm text-slate-700 dark:text-slate-300">{whereabouts(row)}</p>

              {row.jobId ? (
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Clocked into{' '}
                  <Link href={`/jobs/${row.jobId}`} className="hover:underline">
                    {row.jobNumber ?? row.jobTitle}
                  </Link>
                  .
                </p>
              ) : null}

              {row.stale ? (
                <p className="text-xs text-amber-700 dark:text-amber-500">
                  Their phone has not reported since. Usually it is locked in a pocket —
                  it is not a sign anything is wrong.
                </p>
              ) : null}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
