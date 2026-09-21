import { Card, CardHeader } from '@/components/ui/Card';
import type { JobCost } from '@/lib/costs/engine';
import { formatCents } from '@/lib/money';

/**
 * What this job cost, and what it left.
 *
 * The number an owner is really after is the last line, and the honest way to
 * show it is with the parts above it: an owner who can see that the drive cost
 * more than the mowing can do something about it — move the job, group it with a
 * neighbour, put the price up, or let that customer go.
 *
 * Two things this screen refuses to do:
 *
 *  - **Pretend an unknown is a zero.** If nobody has set a pay rate, the labour
 *    line says so instead of reading $0.00, and the total is labelled as a
 *    partial figure. An owner who trusts a profit built on uncounted hours makes
 *    exactly the wrong decision, confidently.
 *  - **Show up for the crew.** The page only renders this for owners and admins,
 *    because the labour line on a one-person job *is* that person's wage.
 */
export function JobCostCard({ cost, currency }: { cost: JobCost; currency: string }) {
  const money = (cents: number) => formatCents(cents, currency);
  const losing = cost.profitCents < 0;

  return (
    <Card>
      <CardHeader
        title="What this job cost"
        description={
          cost.complete
            ? 'Hours, fuel and materials against what the customer was charged.'
            : 'Partial — some of the cost is not known yet.'
        }
      />

      <div className="space-y-2 p-4 pt-0 text-sm">
        <Line label="Time on the job" value={money(cost.labourCents)} />
        <Line label="Time driving" value={money(cost.travelLabourCents)} />
        <Line label="Fuel" value={money(cost.fuelCents)} />
        {cost.materialsCents > 0 ? (
          <Line label="Materials" value={money(cost.materialsCents)} />
        ) : null}

        <div className="flex items-baseline justify-between border-t border-slate-100 pt-2 dark:border-slate-800">
          <span className="text-slate-600 dark:text-slate-400">
            {cost.complete ? 'Total cost' : 'Counted so far'}
          </span>
          <span className="tabular font-medium text-slate-900 dark:text-slate-100">
            {money(cost.totalCostCents)}
          </span>
        </div>

        <div className="flex items-baseline justify-between">
          <span className="font-medium text-slate-900 dark:text-slate-100">
            {losing ? 'Lost on this job' : 'Left over'}
          </span>
          <span
            className={`tabular text-lg font-semibold ${
              losing ? 'text-red-600 dark:text-red-400' : 'text-slate-900 dark:text-slate-50'
            }`}
          >
            {money(cost.profitCents)}
            {cost.marginBps !== null ? (
              <span className="ml-1 text-xs font-normal text-slate-500 dark:text-slate-400">
                {(cost.marginBps / 100).toFixed(1)}%
              </span>
            ) : null}
          </span>
        </div>

        {cost.missing.length > 0 ? (
          <ul className="space-y-1 border-t border-slate-100 pt-2 text-xs text-amber-700 dark:border-slate-800 dark:text-amber-500">
            {cost.missing.map((entry) => (
              <li key={entry.part}>{entry.reason}</li>
            ))}
          </ul>
        ) : null}

        {losing && cost.complete ? (
          <p className="border-t border-slate-100 pt-2 text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">
            This job costs more to do than it charges. Worth checking the price, or
            whether it can be grouped with another job nearby.
          </p>
        ) : null}
      </div>
    </Card>
  );
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between">
      <span className="text-slate-600 dark:text-slate-400">{label}</span>
      <span className="tabular text-slate-800 dark:text-slate-200">{value}</span>
    </div>
  );
}
