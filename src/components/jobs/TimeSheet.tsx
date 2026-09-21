import { Badge } from '@/components/ui/Badge';
import { Card, CardHeader } from '@/components/ui/Card';
import { formatDistance, type Proximity } from '@/lib/geo/distance';

/**
 * Who worked this job, for how long, and where they were when they said so.
 *
 * The hours are the point. The pins are supporting evidence, and how they are
 * worded is the whole ethical weight of this feature: the reader is somebody's
 * employer, and a line on a screen that reads as proof will be treated as proof.
 *
 * So the wording never overstates what a phone knows.
 *
 *  - A fix near the property says "at the property".
 *  - A fix far from it says how far, and nothing else. Not "not on site", which
 *    is a conclusion, and not a flag or a colour that invites one.
 *  - A fix the device was unsure about says the distance is unreliable, in
 *    words, and says how unsure. This is the case that would otherwise quietly
 *    turn a bad signal into an accusation.
 *  - No fix says no fix, and why.
 *
 * The strongest thing this screen will say about a distant pin is the distance
 * itself. Whether that means somebody was not where they said is a conversation
 * between two people, and software that pre-judges it would be wrong often
 * enough to cost somebody their job over a cell tower.
 */

export type TimeSheetEntry = {
  id: string;
  who: string;
  startedAt: Date;
  endedAt: Date | null;
  minutes: number | null;
  note: string | null;
  /** Null when the viewer is not entitled to see this person's pins. */
  startProximity: Proximity | null;
  endProximity: Proximity | null;
  startLocationNote: string | null;
  forgotten: boolean;
};

const NO_PIN: Record<string, string> = {
  denied: 'location off on their phone',
  unavailable: 'no signal for a fix',
  timeout: 'the phone was still looking',
  unsupported: 'their browser cannot do it',
  insecure: 'the site was not served securely',
};

function proximityLine(proximity: Proximity | null, locationNote: string | null): string | null {
  if (!proximity || proximity.kind === 'unknown') {
    if (locationNote) return `No location — ${NO_PIN[locationNote] ?? locationNote}.`;
    return null;
  }

  if (proximity.kind === 'at_property') return 'At the property.';

  if (proximity.kind === 'too_vague') {
    /*
     * The honest non-answer. The phone reported a radius wider than the distance
     * being measured, so the distance is not evidence of anything — saying so
     * plainly is better than printing a number that reads like one.
     */
    return `Location too rough to place — the phone was only sure to within ${formatDistance(
      proximity.accuracyMetres / 0.3048,
    )}.`;
  }

  return `${formatDistance(proximity.feet)} from the property.`;
}

function duration(minutes: number | null): string {
  if (minutes === null) return '—';
  const hours = Math.floor(minutes / 60);
  return hours > 0 ? `${hours}h ${minutes % 60}m` : `${minutes}m`;
}

function clockTime(date: Date): string {
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

export function TimeSheet({
  entries,
  totalMinutes,
}: {
  entries: TimeSheetEntry[];
  totalMinutes: number;
}) {
  if (entries.length === 0) {
    return (
      <Card>
        <CardHeader
          title="Hours on this job"
          description="Nobody has clocked in yet. The crew taps Clock in when they arrive."
        />
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader
        title="Hours on this job"
        description={`${duration(totalMinutes)} recorded across ${entries.length} ${
          entries.length === 1 ? 'entry' : 'entries'
        }.`}
      />

      <ul className="divide-y divide-slate-100 dark:divide-slate-800">
        {entries.map((entry) => {
          const startLine = proximityLine(entry.startProximity, entry.startLocationNote);
          const endLine = proximityLine(entry.endProximity, null);

          return (
            <li key={entry.id} className="space-y-1 px-4 py-3">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-sm font-medium text-slate-900 dark:text-slate-100">
                  {entry.who}
                </span>
                <span className="tabular text-sm text-slate-700 dark:text-slate-300">
                  {duration(entry.minutes)}
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                <span className="tabular">
                  {clockTime(entry.startedAt)} – {entry.endedAt ? clockTime(entry.endedAt) : 'now'}
                </span>

                {entry.endedAt === null ? (
                  <Badge tone={entry.forgotten ? 'urgent' : 'active'}>
                    {entry.forgotten ? 'still open' : 'on the clock'}
                  </Badge>
                ) : null}
              </div>

              {entry.forgotten ? (
                <p className="text-xs text-amber-700 dark:text-amber-500">
                  Open since yesterday or longer — probably a missed clock-out. These
                  hours are left out of the job&rsquo;s cost until it is closed.
                </p>
              ) : null}

              {startLine ? (
                <p className="text-xs text-slate-500 dark:text-slate-400">In: {startLine}</p>
              ) : null}
              {endLine ? (
                <p className="text-xs text-slate-500 dark:text-slate-400">Out: {endLine}</p>
              ) : null}

              {entry.note ? (
                <p className="text-xs whitespace-pre-wrap text-slate-600 dark:text-slate-300">
                  {entry.note}
                </p>
              ) : null}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
