import { LogoMark } from '@/components/marketing/Logo';

/**
 * A picture of the product, drawn in the product's own components.
 *
 * Not a screenshot, for three reasons. A screenshot is a bitmap: blurry on a
 * retina screen, a few hundred kilobytes on a phone, wrong the moment the real
 * UI changes, and stuck in one colour scheme. This is markup — sharp at every
 * size, a few kilobytes, in the same typeface and tokens as the app, and it
 * follows the visitor's light or dark setting.
 *
 * **What it may show.** Only things the product actually does: a pipeline, AI
 * scores, a missed call that was texted back, follow-ups on a timer, stat tiles
 * from the real dashboard. The people and numbers are samples — the 555 exchange
 * and the names say so to anybody who looks — and nothing here is presented as a
 * customer's result. A mock that showed a feature that does not exist would be
 * the landing page lying, which is a worse look than any design could make up
 * for.
 *
 * It is a picture, so it is hidden from assistive technology and takes no
 * pointer events. A screen reader gets the alt text on the wrapper instead of a
 * tour of a fake dashboard, and nobody tries to click a button that is not one.
 */

type Card = { name: string; job: string; meta: string; score?: number; tone?: 'brand' | 'amber' | 'slate' };

const COLUMNS: { title: string; count: number; cards: Card[] }[] = [
  {
    title: 'New',
    count: 4,
    cards: [
      { name: 'Dana Okafor', job: 'Weekly mow · 0.4 acre', meta: 'Missed call · texted back in 38s', tone: 'brand' },
      { name: 'Priya Shah', job: 'Spring cleanup', meta: 'Referral · 6 min ago', score: 72, tone: 'brand' },
    ],
  },
  {
    title: 'Quoted',
    count: 3,
    cards: [
      { name: 'Marcus Reed', job: 'Hedge trim · $180', meta: 'Follow-up 2 of 3 · tomorrow 9am', tone: 'amber' },
      { name: 'Hana Brooks', job: 'Mulch install · $640', meta: 'Viewed the quote twice', tone: 'amber' },
    ],
  },
  {
    title: 'Won',
    count: 5,
    cards: [
      { name: 'Elena Ruiz', job: 'Full service · $420', meta: 'Booked Thu 8:00am', tone: 'slate' },
      { name: 'Tom Achebe', job: 'Aeration · $150', meta: 'Review request queued', tone: 'slate' },
    ],
  },
];

const STATS = [
  { label: 'New leads', value: '12', delta: '+4 this week' },
  { label: 'Quotes out', value: '8', delta: '$3,140 pending' },
  { label: 'Won', value: '5', delta: '62% acceptance' },
  { label: 'Avg. reply', value: '41s', delta: 'to a missed call' },
];

const NAV = ['Dashboard', 'Leads', 'Quotes', 'Jobs', 'Calendar', 'Route', 'Profit'];

function Score({ value }: { value: number }) {
  return (
    <span className="tabular inline-flex items-center gap-1 rounded-full bg-brand-50 px-1.5 py-0.5 text-[10px] font-semibold text-brand-800 ring-1 ring-brand-200 dark:bg-brand-950/60 dark:text-brand-200 dark:ring-brand-900">
      AI {value}
    </span>
  );
}

function LeadCard({ card }: { card: Card }) {
  const accent =
    card.tone === 'brand'
      ? 'before:bg-brand-500'
      : card.tone === 'amber'
        ? 'before:bg-amber-400'
        : 'before:bg-slate-300 dark:before:bg-slate-600';

  return (
    <div
      className={`relative overflow-hidden rounded-lg bg-white p-2.5 shadow-xs ring-1 ring-slate-200 before:absolute before:inset-y-0 before:left-0 before:w-0.5 dark:bg-slate-900 dark:ring-slate-800 ${accent}`}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="truncate text-[11px] font-semibold text-slate-900 dark:text-slate-100">{card.name}</p>
        {card.score ? <Score value={card.score} /> : null}
      </div>
      <p className="mt-0.5 truncate text-[10.5px] text-slate-600 dark:text-slate-300">{card.job}</p>
      <p className="mt-1.5 truncate text-[10px] text-slate-400 dark:text-slate-500">{card.meta}</p>
    </div>
  );
}

export function ProductShot() {
  return (
    <div
      role="img"
      aria-label="The JobFlow dashboard: this week's leads, quotes and wins, and a pipeline of customers moving from new to won."
      className="pointer-events-none select-none"
    >
      <div
        aria-hidden="true"
        className="overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 shadow-slate-900/10 ring-slate-900/10 dark:bg-slate-900 dark:shadow-black/40 dark:ring-white/10"
      >
        {/* Window chrome. */}
        <div className="flex items-center gap-2 border-b border-slate-200/80 bg-slate-50/80 px-4 py-2.5 dark:border-slate-800 dark:bg-slate-900">
          <span className="size-2.5 rounded-full bg-slate-300 dark:bg-slate-700" />
          <span className="size-2.5 rounded-full bg-slate-300 dark:bg-slate-700" />
          <span className="size-2.5 rounded-full bg-slate-300 dark:bg-slate-700" />
          <span className="ml-3 hidden rounded-md bg-white px-3 py-0.5 text-[10.5px] text-slate-400 ring-1 ring-slate-200 sm:block dark:bg-slate-800 dark:text-slate-500 dark:ring-slate-700">
            Pipeline — JobFlow
          </span>
        </div>

        <div className="flex">
          {/* Sidebar — the real navigation, abbreviated. */}
          <div className="hidden w-40 shrink-0 border-r border-slate-200/80 bg-white p-3 md:block dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center gap-2 px-1.5 pb-3">
              <LogoMark className="size-5" />
              <span className="text-[11px] font-semibold text-slate-900 dark:text-slate-100">Green Acres</span>
            </div>
            {NAV.map((item) => (
              <div
                key={item}
                className={`rounded-md px-2 py-1.5 text-[11px] font-medium ${
                  item === 'Leads'
                    ? 'bg-brand-50 text-brand-800 dark:bg-brand-950/60 dark:text-brand-200'
                    : 'text-slate-500 dark:text-slate-400'
                }`}
              >
                {item}
              </div>
            ))}
          </div>

          <div className="min-w-0 flex-1 bg-slate-50/60 p-3 sm:p-4 dark:bg-slate-950/40">
            <div className="flex items-baseline justify-between">
              <p className="text-[13px] font-semibold tracking-tight text-slate-900 dark:text-slate-50">
                Good morning, Sam
              </p>
              <p className="text-[10.5px] text-slate-400 dark:text-slate-500">This week</p>
            </div>

            {/* The KPI row from the real dashboard: a value, and the one line that says what it means. */}
            <div className="mt-3 grid grid-cols-2 gap-2 lg:grid-cols-4">
              {STATS.map((stat) => (
                <div
                  key={stat.label}
                  className="rounded-lg bg-white p-2.5 ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800"
                >
                  <p className="text-[10px] font-medium text-slate-500 dark:text-slate-400">{stat.label}</p>
                  <p className="tabular mt-0.5 text-lg font-semibold tracking-tight text-slate-900 dark:text-slate-50">
                    {stat.value}
                  </p>
                  <p className="text-[10px] text-slate-400 dark:text-slate-500">{stat.delta}</p>
                </div>
              ))}
            </div>

            <div className="mt-3 grid gap-2 sm:grid-cols-3">
              {COLUMNS.map((column, index) => (
                <div
                  key={column.title}
                  // Only the first column on a phone: three squeezed columns at
                  // 390px is a picture of clutter, not of a pipeline.
                  className={`space-y-1.5 ${index > 0 ? 'hidden sm:block' : ''}`}
                >
                  <div className="flex items-center justify-between px-0.5">
                    <p className="text-[10.5px] font-semibold text-slate-600 dark:text-slate-300">{column.title}</p>
                    <span className="tabular text-[10px] text-slate-400 dark:text-slate-500">{column.count}</span>
                  </div>
                  {column.cards.map((card) => (
                    <LeadCard key={card.name} card={card} />
                  ))}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
