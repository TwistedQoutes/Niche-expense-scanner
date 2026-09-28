import { Check, PhoneMissed, TrendingDown } from 'lucide-react';

/**
 * Small pictures of single features, for the rows that explain them.
 *
 * The same rules as the hero shot (src/components/marketing/ProductShot.tsx):
 * drawn in the product's own visual language, showing only what the product
 * really does, with sample people and numbers — and hidden from assistive
 * technology behind one plain-language description each.
 */

function Frame({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div role="img" aria-label={label} className="pointer-events-none select-none">
      <div
        aria-hidden="true"
        className="rounded-2xl bg-white p-4 shadow-xl ring-1 shadow-slate-900/5 ring-slate-900/10 sm:p-5 dark:bg-slate-900 dark:shadow-black/30 dark:ring-white/10"
      >
        {children}
      </div>
    </div>
  );
}

/**
 * A missed call that became a conversation, and a lead, without anyone touching
 * a phone.
 *
 * It stops at what the missed-call path really does: the lead is created when
 * the call is missed, and the customer's reply lands in the inbox. The reply is
 * not fed to the AI — scoring works from the lead's own fields — so the card
 * shows no score. Drawing one here would promise a feature the product lacks.
 */
export function MissedCallVisual() {
  return (
    <Frame label="A missed call is answered with an automatic text within a minute; the caller becomes a lead in the pipeline, and their reply arrives in the inbox.">
      <div className="flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600 ring-1 ring-slate-200 dark:bg-slate-800/60 dark:text-slate-300 dark:ring-slate-700">
        <PhoneMissed className="size-3.5 text-red-500" strokeWidth={2.25} />
        Missed call · (512) 555-0143 · 2:14pm
      </div>

      <div className="mt-4 space-y-2.5 text-[13px] leading-snug">
        <div className="ml-auto max-w-[82%] rounded-2xl rounded-br-md bg-brand-600 px-3.5 py-2 text-white">
          Sorry we missed you — this is Green Acres Lawn. What can we help with?
          <p className="mt-1 text-[10.5px] text-brand-100">Sent automatically · 2:14pm</p>
        </div>
        <div className="max-w-[78%] rounded-2xl rounded-bl-md bg-slate-100 px-3.5 py-2 text-slate-800 dark:bg-slate-800 dark:text-slate-100">
          Need a quote for weekly mowing, about half an acre. This week if possible?
        </div>
      </div>

      <div className="mt-4 rounded-xl bg-brand-50/70 p-3 ring-1 ring-brand-200/80 dark:bg-brand-950/40 dark:ring-brand-900">
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold text-brand-900 dark:text-brand-100">New lead · Missed call</p>
          <span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-semibold text-brand-800 ring-1 ring-brand-200 dark:bg-slate-900 dark:text-brand-200 dark:ring-brand-900">
            In your pipeline
          </span>
        </div>
        <p className="mt-1 text-[11.5px] text-brand-900/80 dark:text-brand-100/80">
          Added at 2:14pm, before you were off the mower. Their reply is waiting in your inbox.
        </p>
      </div>
    </Frame>
  );
}

const LINES = [
  ['Weekly mowing · 0.4 acre', '$55.00'],
  ['Edging and trim', '$15.00'],
  ['Travel · 4.2 mi, measured', '$6.00'],
] as const;

/** A quote the customer opens on their phone and accepts, with the maths visible. */
export function QuoteVisual() {
  return (
    <Frame label="A quote with its line items, including measured travel, a total, and an Accept button the customer taps on their phone.">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-[11px] font-medium text-slate-400 dark:text-slate-500">Quote Q-1042</p>
          <p className="text-sm font-semibold text-slate-900 dark:text-slate-50">Dana Okafor · 14 Birch Ln</p>
        </div>
        <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-800 ring-1 ring-amber-200 dark:bg-amber-950/40 dark:text-amber-200 dark:ring-amber-900">
          Viewed 2 min ago
        </span>
      </div>

      <dl className="mt-4 divide-y divide-slate-100 text-[13px] dark:divide-slate-800">
        {LINES.map(([item, price]) => (
          <div key={item} className="flex justify-between py-2">
            <dt className="text-slate-600 dark:text-slate-300">{item}</dt>
            <dd className="tabular text-slate-900 dark:text-slate-100">{price}</dd>
          </div>
        ))}
        <div className="flex justify-between py-2.5 font-semibold">
          <dt className="text-slate-900 dark:text-slate-50">Total</dt>
          <dd className="tabular text-slate-900 dark:text-slate-50">$76.00</dd>
        </div>
      </dl>

      <div className="mt-2 flex items-center justify-center gap-1.5 rounded-xl bg-brand-600 py-2.5 text-sm font-semibold text-white">
        <Check className="size-4" strokeWidth={2.5} />
        Accept quote
      </div>
      <p className="mt-2 text-center text-[10.5px] text-slate-400 dark:text-slate-500">
        No account needed to accept · priced from your own rates
      </p>
    </Frame>
  );
}

/**
 * Margin by job — a diverging bar, because the data has a sign.
 *
 * Built to the house chart rules (and the colours checked with the palette
 * validator, not by eye): one zero baseline; gains extend right in brand-600,
 * which passes on both the white and the slate-900 card; the loss extends left
 * in red-600 / red-500, one step apart per theme because the lighter pair fell
 * outside the dark lightness band. Bars are 10px with a 4px rounded data end and
 * a square baseline. Values sit at the bar tips in text colours, never the bar
 * colour. A loss is a status, so it carries a word and an icon, not colour alone.
 *
 * One measure, so no legend: the heading names it. No hover layer either, and
 * that is deliberate — this is a picture of a chart inside a picture of the
 * product, and a tooltip on an illustration would invite somebody to interact
 * with data that is not theirs.
 */
const MARGINS = [
  { job: 'Full service', price: '$420', value: 62 },
  { job: 'Weekly mow', price: '$55', value: 48 },
  { job: 'Hedge trim', price: '$180', value: 31 },
  { job: 'Big garden, out of town', price: '$50', value: -24 },
];

const MOST_NEGATIVE = Math.abs(Math.min(...MARGINS.map((row) => row.value)));
const MOST_POSITIVE = Math.max(...MARGINS.map((row) => row.value));
/** Where zero sits across the track, so the widest bar on each side just fits. */
const ZERO = (MOST_NEGATIVE / (MOST_NEGATIVE + MOST_POSITIVE)) * 100;
const UNIT = 100 / (MOST_NEGATIVE + MOST_POSITIVE);

export function MarginVisual() {
  return (
    <Frame label="Margin by job for the week: a full service kept 62%, a weekly mow 48%, a hedge trim 31%, and a small job far out of town lost 24%.">
      <p className="text-sm font-semibold text-slate-900 dark:text-slate-50">Margin by job · last 7 days</p>
      <p className="mt-0.5 text-[11.5px] text-slate-500 dark:text-slate-400">
        What each job kept after hours, driving and fuel.
      </p>

      <div className="mt-5 space-y-3.5">
        {MARGINS.map((row) => {
          const width = Math.abs(row.value) * UNIT;
          const loss = row.value < 0;

          return (
            <div key={row.job}>
              <div className="flex items-center justify-between gap-2">
                <p className="truncate text-[12px] text-slate-700 dark:text-slate-300">
                  {row.job} <span className="text-slate-400 dark:text-slate-500">· {row.price}</span>
                </p>
                {loss ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-1.5 py-0.5 text-[10.5px] font-semibold text-red-700 ring-1 ring-red-200 dark:bg-red-950/50 dark:text-red-300 dark:ring-red-900">
                    <TrendingDown className="size-3" strokeWidth={2.5} />
                    Loss
                  </span>
                ) : null}
              </div>

              {/* Horizontal padding is the room the tip labels need at either extreme. */}
              <div className="px-10">
                <div className="relative mt-1.5 h-4">
                  <div
                    className="absolute inset-y-0 w-px bg-slate-200 dark:bg-slate-700"
                    style={{ left: `${ZERO}%` }}
                  />
                  <div
                    className={`absolute top-1/2 h-2.5 -translate-y-1/2 ${
                      loss
                        ? 'rounded-l-[4px] bg-red-600 dark:bg-red-500'
                        : 'rounded-r-[4px] bg-brand-600'
                    }`}
                    style={
                      loss
                        ? { right: `${100 - ZERO}%`, width: `${width}%` }
                        : { left: `${ZERO}%`, width: `${width}%` }
                    }
                  />
                  <span
                    className="tabular absolute top-1/2 -translate-y-1/2 text-[11px] font-medium text-slate-700 dark:text-slate-200"
                    style={
                      loss
                        ? { right: `calc(${100 - ZERO + width}% + 6px)` }
                        : { left: `calc(${ZERO + width}% + 6px)` }
                    }
                  >
                    {loss ? '−' : '+'}
                    {Math.abs(row.value)}%
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </Frame>
  );
}
