import { Check, PartyPopper } from 'lucide-react';

import { MissedCallVisual } from '@/components/marketing/Visuals';

/**
 * The half of the sign-in screen that is not the form.
 *
 * The same promise as the home page, in the same words, so arriving here from
 * "Start free" feels like the next room rather than a different building: the
 * headline, the grid texture, the missed-call picture. A quote-accepted card
 * lands on top of it a moment after the page does — the product's best moment,
 * shown rather than claimed.
 *
 * The same rules as the home page, too. Sample people and numbers only (Dana
 * and Q-1042 are the ones on the home page's quote), and nothing here the
 * product does not do: accepting a quote really does create the job
 * (src/app/api/public/quotes/[publicId]/respond/route.ts).
 *
 * Wide screens only. On a phone the form is the page, and a decorative panel
 * above it would push the fields below the fold.
 */

const POINTS = [
  'Missed calls texted back in seconds',
  'Quotes priced from your own rates',
  'Follow-up that stops when they reply',
];

export function AuthShowcase() {
  return (
    <aside className="relative isolate m-3 hidden flex-col justify-between overflow-hidden rounded-3xl bg-slate-950 p-10 text-white ring-1 ring-white/5 lg:flex xl:p-14">
      {/* Texture and light, as on the home page's dark band. */}
      <div aria-hidden="true" className="hero-grid absolute inset-0 -z-10 [--grid-line:rgb(255_255_255/0.06)]" />
      <div
        aria-hidden="true"
        className="absolute -top-32 -right-24 -z-10 size-[34rem] rounded-full bg-brand-500/25 blur-3xl"
      />
      <div
        aria-hidden="true"
        className="absolute -bottom-40 -left-24 -z-10 size-[28rem] rounded-full bg-emerald-400/10 blur-3xl"
      />

      <div className="animate-rise">
        <p className="inline-flex items-center gap-2 rounded-full bg-white/5 px-3 py-1 text-xs font-medium text-slate-300 ring-1 ring-white/10">
          <span className="size-1.5 rounded-full bg-brand-400" />
          For lawn care &amp; home services
        </p>
        <p className="mt-6 text-4xl leading-[1.05] font-semibold tracking-[-0.04em] xl:text-5xl">
          Turn leads into jobs.
          <br />
          <span className="animate-sheen bg-linear-to-r from-brand-300 via-emerald-100 to-brand-300 bg-size-[200%_auto] bg-clip-text text-transparent">
            Automatically.
          </span>
        </p>
      </div>

      {/* The stage: the missed call drifting, the accepted quote landing on it. */}
      <div className="relative mx-auto my-10 w-full max-w-md">
        <div className="animate-float [--tilt:-1.5deg]">
          <MissedCallVisual />
        </div>

        <div
          aria-hidden="true"
          className="animate-pop absolute -right-4 -bottom-7 flex items-center gap-3 rounded-2xl bg-white/95 py-3 pr-5 pl-3 text-slate-900 shadow-2xl ring-1 shadow-black/40 ring-black/5 backdrop-blur xl:-right-10"
          style={{ animationDelay: '900ms' }}
        >
          <span className="grid size-10 place-items-center rounded-full bg-brand-600 text-white">
            <PartyPopper className="size-5" strokeWidth={2} />
          </span>
          <span>
            <span className="block text-sm font-semibold">Quote accepted — job created</span>
            <span className="tabular block text-xs text-slate-500">Dana Okafor · Q-1042 · $76.00</span>
          </span>
        </div>
      </div>

      <ul className="animate-rise space-y-2.5 text-sm text-slate-300" style={{ animationDelay: '250ms' }}>
        {POINTS.map((point) => (
          <li key={point} className="flex items-center gap-2.5">
            <span className="grid size-5 place-items-center rounded-full bg-brand-500/15 text-brand-300 ring-1 ring-brand-400/30">
              <Check className="size-3" strokeWidth={3} aria-hidden="true" />
            </span>
            {point}
          </li>
        ))}
      </ul>
    </aside>
  );
}
