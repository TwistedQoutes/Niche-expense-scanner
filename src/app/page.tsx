import {
  ArrowRight,
  CalendarCheck,
  ChevronDown,
  Check,
  Inbox,
  LineChart,
  MapPin,
  MessageSquareText,
  Route,
  ShieldCheck,
  Sparkles,
  Star,
  Timer,
} from 'lucide-react';
import Link from 'next/link';
import { connection } from 'next/server';

import { DemoButton } from '@/components/marketing/DemoButton';
import { Logo } from '@/components/marketing/Logo';
import { ProductShot } from '@/components/marketing/ProductShot';
import { MarginVisual, MissedCallVisual, QuoteVisual } from '@/components/marketing/Visuals';
import { buttonClasses } from '@/components/ui/Button';
import { PLANS } from '@/lib/billing/plans';
import { getPublicConfig } from '@/lib/env';
import { INDUSTRIES } from '@/lib/services/templates';

/**
 * The marketing page — the front door of the domain.
 *
 * It reads no database and no session, so it stays up even when the application
 * does not: the page that sells the product should not depend on the product.
 *
 * It is **not** statically prerendered, though, and that is a deliberate trade.
 * `DEMO_MODE` decides whether the page offers a demo, and a statically rendered
 * page inlines `process.env` at build time: a deployment that switched the flag on
 * afterwards would keep serving a page with no demo button until somebody
 * happened to redeploy, with nothing to indicate why. `connection()` moves that
 * read to request time. The cost is one cheap server render — no database, no
 * session, no third-party call — which is a good price for a flag that is right.
 *
 * **What makes it look expensive, and what does not.** The page shows the
 * product — drawn in the product's own components, not screenshots — and varies
 * its rhythm so no two sections share a shape; nine centred headings over nine
 * grids of identical boxes is what reads as a template. What it does not do is
 * invent proof. There are no testimonials, customer logos, star ratings or
 * "trusted by" counts, because there are none yet to show, and a made-up one is
 * the single fastest way to look like a scam to the tradesperson reading it.
 * Trust is earned instead from specifics: what the product refuses to do, stated
 * plainly, in the section that says so.
 */

const PROBLEMS = [
  {
    title: 'You were on a mower when they called',
    body: 'Most homeowners call three companies and hire whoever answers first. By the time the day is over and you call back, the job is gone.',
  },
  {
    title: 'Quotes take an evening you do not have',
    body: 'Measuring, pricing and typing up an estimate after dinner is the part of the job nobody sells you on — and the slower it goes out, the less often it lands.',
  },
  {
    title: 'Nobody follows up',
    body: 'Most quotes are never chased even once. Not because owners do not care, but because the day starts again at six and the sticky note is still on the dash.',
  },
];

const ROWS = [
  {
    eyebrow: 'Capture',
    title: 'Every missed call becomes a conversation',
    body: 'The call you could not take is answered by text within seconds, in your business’s name. The caller is already a lead in your pipeline, and their reply lands in your inbox — no voicemail to play back, no number on a sticky note.',
    points: ['Missed-call text back', 'Every lead in one pipeline, by source', 'AI score out of 100, and why'],
    visual: <MissedCallVisual />,
  },
  {
    eyebrow: 'Quote',
    title: 'A real quote in minutes, from your own rates',
    body: 'Labour, materials, measured travel, overhead and margin — the calculator shows the maths, you adjust the number, and the customer gets a clean page they can accept on their phone. Then the follow-ups run themselves until they reply.',
    points: ['Your rates, your minimums, your margin', 'Drive distance measured, not guessed', 'Day 2, day 5, day 10 follow-up — stops when they answer'],
    visual: <QuoteVisual />,
  },
  {
    eyebrow: 'Profit',
    title: 'Know which jobs actually made money',
    body: 'Hours from the crew’s clock, driving at their pay rate, fuel by the mile — against what the customer paid. The forty-minutes-away fifty-dollar mow stops hiding behind a busy calendar.',
    points: ['Per-job cost, per-person pay rates', 'Worst margin first, by job, customer and service', 'Unknown costs flagged, never counted as zero'],
    visual: <MarginVisual />,
  },
];

/*
 * The bento has to add up to whole rows of four, or the last row has a hole in
 * it — which is the first thing an eye finds on a grid. Eight tiles fill three
 * rows only if four of them are double width, arranged so each row sums to four:
 *
 *   [ AI ········ ][ Follow-up ][ Calendar ]
 *   [ Route ····· ][ Clock in ·············· ]
 *   [ Inbox ][ Reviews ][ Numbers ········· ]
 *
 * The wide slots go to the features that most set this apart, not to whichever
 * came first in the list.
 */
const BENTO = [
  {
    icon: Sparkles,
    title: 'AI that sorts the pile',
    body: 'A score out of 100 for every lead, the job in one line, how urgent it is, and a suggested reply you can send or rewrite.',
    wide: true,
  },
  {
    icon: MessageSquareText,
    title: 'Follow-up on autopilot',
    body: 'Text and email sequences, written to sound like you.',
  },
  {
    icon: CalendarCheck,
    title: 'Calendar and jobs',
    body: 'An accepted quote becomes a job on its own. Crews, photos, notes.',
  },
  {
    icon: Route,
    title: 'A shorter day',
    body: 'Reorder the day’s stops to cut the driving, side by side with the order you booked — nothing moves until you say so.',
    wide: true,
  },
  {
    icon: Timer,
    title: 'Clock in, per job',
    body: 'One tap on arrival, one when they leave. Each person’s hours meet their own pay rate, so a two-person job costs what a two-person job costs.',
    wide: true,
  },
  {
    icon: Inbox,
    title: 'One inbox',
    body: 'Texts and emails in a single thread per customer.',
  },
  {
    icon: Star,
    title: 'Reviews, while it’s fresh',
    body: 'The request goes out hours after the job is done.',
  },
  {
    icon: LineChart,
    title: 'The numbers that matter',
    body: 'Response time, quote acceptance, average job value, and which lead sources actually turn into work.',
    wide: true,
  },
];

const PRINCIPLES = [
  {
    title: 'The AI never invents a price',
    body: 'Prices come from your rates, through your calculator. A figure the AI puts in a draft reply is stripped out before you see it, and nothing it writes reaches a customer until you send it.',
  },
  {
    title: 'No lawn measured from space',
    body: 'A satellite photo cannot tell grass from gravel or see under a tree. The size on a quote is the one you enter; maps are used for what they measure well — the drive there.',
  },
  {
    title: 'An unknown cost is never zero',
    body: 'If a pay rate or the fuel price is missing, the profit figure says so and leaves that job out — rather than showing you a margin you did not make.',
  },
  {
    title: 'Your crew’s location is theirs off the clock',
    body: 'Live position is shared only while they are clocked in: the latest point, never a trail, deleted the moment they finish — and they can see it happening on their own screen. The pins from clocking in and out stay on the job.',
  },
];

const FAQS = [
  {
    q: 'Do I need to change my phone number?',
    a: 'Missed-call text back works on a number connected to JobFlow — a new one, or the one you already advertise, moved over. Either way your customers call and text one business number.',
  },
  {
    q: 'Will the AI quote a price on its own?',
    a: 'No. The AI scores leads and drafts replies; it does not send them. If a draft mentions a price, that figure is removed before you see it — prices come from your own rates, through the quote calculator.',
  },
  {
    q: 'Can it measure a lawn from satellite imagery?',
    a: 'No, on purpose. An area read off a satellite photo is a guess with a confident number attached, and a quote built on a guess costs you money on the job. You enter the property size; JobFlow measures the drive to it.',
  },
  {
    q: 'Does it track where my crew is?',
    a: 'Two ways, both tied to a job. Clocking in and out drops a pin on it, so you can see they were at the property. While they are on the clock their phone can share its latest position — never a trail, deleted when they clock out, and your crew can see on their own screen when it is being shared.',
  },
  {
    q: 'Do my customers need an app or an account?',
    a: 'No. A quote is a link they open on their phone and accept with one tap — nothing to download, nothing to sign up for.',
  },
  {
    q: 'Can other businesses on JobFlow see my customers?',
    a: 'No. Every query is scoped to your workspace, the database refuses to link one business’s records to another’s, and that separation has its own automated tests.',
  },
];

function SectionHeading({
  eyebrow,
  title,
  body,
  align = 'center',
}: {
  eyebrow: string;
  title: string;
  body?: string;
  align?: 'center' | 'left';
}) {
  return (
    <div className={align === 'center' ? 'mx-auto max-w-2xl text-center' : 'max-w-2xl'}>
      <p className="text-sm font-semibold text-brand-700 dark:text-brand-400">{eyebrow}</p>
      <h2 className="mt-2 text-3xl font-semibold tracking-[-0.025em] text-balance text-slate-900 sm:text-4xl dark:text-slate-50">
        {title}
      </h2>
      {body ? (
        <p className="mt-4 text-lg text-pretty text-slate-600 dark:text-slate-300">{body}</p>
      ) : null}
    </div>
  );
}

export default async function LandingPage() {
  // Request time, so the flags below are this deployment's current values rather
  // than whatever was set when the image was built.
  await connection();

  const { supportEmail, trialDays, demoMode } = getPublicConfig();

  const assurances = [
    trialDays > 0 ? `${trialDays}-day Pro trial` : null,
    'No card required',
    'Cancel anytime',
  ].filter(Boolean);

  return (
    <div className="bg-white dark:bg-slate-950">
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-40 border-b border-slate-200/70 bg-white/80 backdrop-blur-lg dark:border-slate-800/70 dark:bg-slate-950/75">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4">
          <Link href="/" aria-label="JobFlow AI home">
            <Logo />
          </Link>

          <nav aria-label="Site" className="flex items-center gap-1">
            <div className="mr-2 hidden items-center gap-1 md:flex">
              {[
                ['How it works', '#how-it-works'],
                ['Pricing', '#pricing'],
                ['Questions', '#questions'],
              ].map(([label, href]) => (
                <a
                  key={href}
                  href={href}
                  className="rounded-lg px-3 py-2 text-sm font-medium text-slate-600 transition-colors duration-150 ease-out hover:text-slate-900 dark:text-slate-300 dark:hover:text-white"
                >
                  {label}
                </a>
              ))}
            </div>
            <Link
              href="/login"
              className="rounded-lg px-3 py-2 text-sm font-medium text-slate-600 transition-colors duration-150 ease-out hover:text-slate-900 dark:text-slate-300 dark:hover:text-white"
            >
              Sign in
            </Link>
            <Link href="/signup" className={buttonClasses({ size: 'sm' })}>
              Start free
            </Link>
          </nav>
        </div>
      </header>

      <main>
        {/* ── Hero ──────────────────────────────────────────────────────── */}
        <section className="relative isolate overflow-hidden">
          <div aria-hidden="true" className="hero-grid absolute inset-0 -z-10" />
          <div
            aria-hidden="true"
            className="absolute top-40 left-1/2 -z-10 h-[28rem] w-[56rem] -translate-x-1/2 rounded-full bg-brand-400/15 blur-3xl dark:bg-brand-500/10"
          />

          <div className="mx-auto max-w-6xl px-4 pt-16 pb-20 sm:pt-24">
            <div className="mx-auto max-w-4xl text-center">
              <p className="inline-flex items-center gap-2 rounded-full bg-white/70 px-3 py-1 text-xs font-medium text-slate-600 ring-1 ring-slate-200 backdrop-blur dark:bg-slate-900/60 dark:text-slate-300 dark:ring-slate-800">
                <span className="size-1.5 rounded-full bg-brand-500" />
                For lawn care &amp; home services
              </p>

              {/*
                * Two lines on anything wider than a phone: the statement, then the
                * payoff on its own. Left to text-balance, the break fell after
                * "into", which strands "jobs." beside the word that is supposed
                * to land alone.
                */}
              <h1 className="mt-6 text-5xl font-semibold tracking-[-0.04em] text-balance text-slate-900 sm:text-6xl lg:text-7xl dark:text-slate-50">
                Turn leads into jobs.
                <br className="hidden sm:block" />{' '}
                <span className="text-brand-600 dark:text-brand-400">Automatically.</span>
              </h1>

              <p className="mx-auto mt-6 max-w-2xl text-lg text-balance text-slate-600 sm:text-xl dark:text-slate-300">
                JobFlow texts back the calls you miss, gets your quote out while they are still
                interested, chases it until they reply, and tells you which jobs actually made
                money.
              </p>

              <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
                <Link
                  href="/signup"
                  className={buttonClasses({ size: 'lg', className: 'w-full shadow-lg shadow-brand-600/20 sm:w-auto' })}
                >
                  Start free
                  <ArrowRight className="size-4" strokeWidth={2.25} />
                </Link>
                {demoMode ? (
                  <DemoButton className="w-full sm:w-auto" />
                ) : (
                  <a
                    href="#how-it-works"
                    className={buttonClasses({ size: 'lg', variant: 'secondary', className: 'w-full sm:w-auto' })}
                  >
                    See how it works
                  </a>
                )}
              </div>

              <ul className="mt-6 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-sm text-slate-500 dark:text-slate-400">
                {assurances.map((line) => (
                  <li key={line} className="flex items-center gap-1.5">
                    <Check className="size-4 text-brand-600 dark:text-brand-400" strokeWidth={2.5} />
                    {line}
                  </li>
                ))}
                {demoMode ? <li>The demo needs no account at all</li> : null}
              </ul>
            </div>

            <div className="mx-auto mt-16 max-w-5xl">
              <ProductShot />
            </div>
          </div>
        </section>

        {/* ── Who it is for ─────────────────────────────────────────────── */}
        <section aria-label="Trades" className="border-y border-slate-200/70 bg-slate-50/60 py-8 dark:border-slate-800/70 dark:bg-slate-900/30">
          <div className="mx-auto max-w-6xl px-4">
            <p className="text-center text-sm font-medium text-slate-500 dark:text-slate-400">
              Set up for the trades, with pricing templates for each
            </p>
            <ul className="mt-4 flex flex-wrap justify-center gap-x-8 gap-y-3">
              {INDUSTRIES.filter((industry) => industry.key !== 'other').map((industry) => (
                <li
                  key={industry.key}
                  className="text-[15px] font-semibold tracking-tight text-slate-400 dark:text-slate-500"
                >
                  {industry.label}
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* ── The problem ───────────────────────────────────────────────── */}
        <section className="mx-auto max-w-6xl px-4 py-24">
          <div className="grid gap-12 lg:grid-cols-[1fr_1.4fr] lg:gap-16">
            <div>
              <p className="text-sm font-semibold text-brand-700 dark:text-brand-400">The problem</p>
              <h2 className="mt-2 text-3xl font-semibold tracking-[-0.025em] text-balance text-slate-900 sm:text-4xl dark:text-slate-50">
                Stop losing customers because you were too busy to answer the phone.
              </h2>
            </div>

            <dl className="space-y-8">
              {PROBLEMS.map((problem, index) => (
                <div key={problem.title} className="flex gap-5">
                  <span className="tabular flex size-9 shrink-0 items-center justify-center rounded-full bg-slate-100 text-sm font-semibold text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                    {index + 1}
                  </span>
                  <div>
                    <dt className="text-lg font-semibold text-slate-900 dark:text-slate-100">{problem.title}</dt>
                    <dd className="mt-1.5 text-pretty text-slate-600 dark:text-slate-400">{problem.body}</dd>
                  </div>
                </div>
              ))}
            </dl>
          </div>
        </section>

        {/* ── How it works: three rows, alternating ─────────────────────── */}
        <section id="how-it-works" className="scroll-mt-20 bg-slate-50/60 py-24 dark:bg-slate-900/30">
          <div className="mx-auto max-w-6xl px-4">
            <SectionHeading
              eyebrow="How it works"
              title="One system, from the first call to the next one"
              body="Every step below happens whether or not you remember to do it."
            />

            <div className="mt-20 space-y-24">
              {ROWS.map((row, index) => (
                <div
                  key={row.title}
                  className="grid items-center gap-10 lg:grid-cols-2 lg:gap-16"
                >
                  <div className={index % 2 === 1 ? 'lg:order-2' : ''}>
                    <p className="text-sm font-semibold text-brand-700 dark:text-brand-400">{row.eyebrow}</p>
                    <h3 className="mt-2 text-2xl font-semibold tracking-[-0.02em] text-balance text-slate-900 sm:text-3xl dark:text-slate-50">
                      {row.title}
                    </h3>
                    <p className="mt-4 text-pretty text-slate-600 dark:text-slate-300">{row.body}</p>
                    <ul className="mt-6 space-y-2.5">
                      {row.points.map((point) => (
                        <li key={point} className="flex items-start gap-2.5 text-sm text-slate-700 dark:text-slate-300">
                          <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-brand-100 dark:bg-brand-950">
                            <Check className="size-3 text-brand-700 dark:text-brand-300" strokeWidth={3} />
                          </span>
                          {point}
                        </li>
                      ))}
                    </ul>
                  </div>

                  <div className={`mx-auto w-full max-w-md ${index % 2 === 1 ? 'lg:order-1' : ''}`}>
                    {row.visual}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── Everything else: a bento ──────────────────────────────────── */}
        <section className="mx-auto max-w-6xl px-4 py-24">
          <SectionHeading
            eyebrow="And the rest of the day"
            title="Everything you would otherwise do at 9pm"
          />

          <div className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {BENTO.map((item) => (
              <div
                key={item.title}
                className={`group rounded-2xl bg-white p-6 ring-1 ring-slate-200/80 transition-[box-shadow,border-color] duration-150 ease-out hover:shadow-md hover:ring-slate-300 dark:bg-slate-900 dark:ring-slate-800 dark:hover:ring-slate-700 ${
                  item.wide ? 'lg:col-span-2' : ''
                }`}
              >
                <span className="flex size-10 items-center justify-center rounded-xl bg-brand-50 ring-1 ring-brand-100 dark:bg-brand-950/60 dark:ring-brand-900">
                  <item.icon className="size-5 text-brand-700 dark:text-brand-300" strokeWidth={2} />
                </span>
                <h3 className="mt-5 font-semibold text-slate-900 dark:text-slate-100">{item.title}</h3>
                <p className="mt-1.5 text-sm text-pretty text-slate-600 dark:text-slate-400">{item.body}</p>
              </div>
            ))}
          </div>
        </section>

        {/* ── Honest by design ──────────────────────────────────────────── */}
        <section className="bg-slate-950 py-24 text-white">
          <div className="mx-auto max-w-6xl px-4">
            <div className="max-w-2xl">
              <p className="flex items-center gap-2 text-sm font-semibold text-brand-400">
                <ShieldCheck className="size-4" strokeWidth={2.25} />
                Honest by design
              </p>
              <h2 className="mt-3 text-3xl font-semibold tracking-[-0.025em] text-balance sm:text-4xl">
                Software that tells you what it does not know.
              </h2>
              <p className="mt-4 text-lg text-pretty text-slate-300">
                A tool that makes your business look better than it is will cost you money the
                first time you act on it. These are rules JobFlow follows in code, not promises in
                a brochure.
              </p>
            </div>

            <dl className="mt-14 grid gap-x-10 gap-y-10 sm:grid-cols-2">
              {PRINCIPLES.map((principle) => (
                <div key={principle.title} className="border-t border-white/10 pt-6">
                  <dt className="text-lg font-semibold">{principle.title}</dt>
                  <dd className="mt-2 text-pretty text-slate-400">{principle.body}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        {/* ── Pricing ───────────────────────────────────────────────────── */}
        <section id="pricing" className="scroll-mt-20 mx-auto max-w-6xl px-4 py-24">
          <SectionHeading
            eyebrow="Pricing"
            title="Priced like a tool, not a tax"
            body="One job a month covers it. Change plan or cancel whenever you like."
          />

          <div className="mt-14 grid gap-5 md:grid-cols-2 lg:grid-cols-4">
            {PLANS.map((plan) => (
              <div
                key={plan.tier}
                className={`relative flex flex-col rounded-2xl p-6 ${
                  plan.highlighted
                    ? 'bg-white shadow-xl ring-2 shadow-brand-900/10 ring-brand-600 dark:bg-slate-900'
                    : 'bg-white ring-1 ring-slate-200/80 dark:bg-slate-900 dark:ring-slate-800'
                }`}
              >
                {plan.highlighted ? (
                  <span className="absolute -top-3 left-6 rounded-full bg-brand-600 px-3 py-1 text-xs font-semibold text-white">
                    Most popular
                  </span>
                ) : null}

                <h3 className="font-semibold text-slate-900 dark:text-slate-100">{plan.name}</h3>
                <p className="mt-1 min-h-10 text-sm text-pretty text-slate-500 dark:text-slate-400">{plan.tagline}</p>

                <p className="mt-5 flex items-baseline gap-1">
                  <span className="tabular text-4xl font-semibold tracking-[-0.03em] text-slate-900 dark:text-slate-50">
                    ${plan.monthlyPriceCents / 100}
                  </span>
                  <span className="text-sm text-slate-500 dark:text-slate-400">/month</span>
                </p>

                <Link
                  href="/signup"
                  className={buttonClasses({
                    variant: plan.highlighted ? 'primary' : 'secondary',
                    fullWidth: true,
                    className: 'mt-6',
                  })}
                >
                  {plan.monthlyPriceCents === 0 ? 'Start free' : `Choose ${plan.name}`}
                </Link>

                <ul className="mt-6 space-y-2.5 border-t border-slate-100 pt-6 text-sm text-slate-600 dark:border-slate-800 dark:text-slate-400">
                  {plan.features.map((feature) => (
                    <li key={feature} className="flex gap-2.5">
                      <Check
                        aria-hidden="true"
                        className="mt-0.5 size-4 shrink-0 text-brand-600 dark:text-brand-400"
                        strokeWidth={2.5}
                      />
                      {feature}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>

        {/* ── Questions ─────────────────────────────────────────────────── */}
        <section id="questions" className="scroll-mt-20 border-t border-slate-200/70 py-24 dark:border-slate-800/70">
          <div className="mx-auto grid max-w-6xl gap-12 px-4 lg:grid-cols-[1fr_1.6fr]">
            <div>
              <p className="text-sm font-semibold text-brand-700 dark:text-brand-400">Questions</p>
              <h2 className="mt-2 text-3xl font-semibold tracking-[-0.025em] text-balance text-slate-900 sm:text-4xl dark:text-slate-50">
                Questions owners actually ask
              </h2>
              <p className="mt-4 text-slate-600 dark:text-slate-300">
                Something else?{' '}
                <a
                  href={`mailto:${supportEmail}`}
                  className="font-medium text-brand-700 underline-offset-4 hover:underline dark:text-brand-400"
                >
                  Email us
                </a>
                .
              </p>
            </div>

            {/*
              * Native <details>: open and closed without a line of JavaScript,
              * keyboard-operable, and searchable with the browser's find — which
              * a hand-built accordion would break.
              */}
            <div className="divide-y divide-slate-200/80 border-y border-slate-200/80 dark:divide-slate-800 dark:border-slate-800">
              {FAQS.map((faq) => (
                <details key={faq.q} className="group py-5">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-left font-semibold text-slate-900 [&::-webkit-details-marker]:hidden dark:text-slate-100">
                    {faq.q}
                    <ChevronDown
                      aria-hidden="true"
                      className="size-5 shrink-0 text-slate-400 transition-transform duration-150 ease-out group-open:rotate-180"
                    />
                  </summary>
                  <p className="mt-3 pr-9 text-pretty text-slate-600 dark:text-slate-400">{faq.a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        {/* ── Final call ────────────────────────────────────────────────── */}
        <section className="px-4 pb-24">
          <div className="relative isolate mx-auto max-w-6xl overflow-hidden rounded-3xl bg-brand-700 px-6 py-16 text-center sm:px-16 sm:py-20 dark:bg-brand-800">
            <div aria-hidden="true" className="hero-grid absolute inset-0 -z-10 opacity-40 [--grid-line:rgb(255_255_255/0.12)]" />
            <div
              aria-hidden="true"
              className="absolute -top-24 left-1/2 -z-10 h-72 w-[40rem] -translate-x-1/2 rounded-full bg-brand-400/40 blur-3xl"
            />

            <h2 className="mx-auto max-w-2xl text-3xl font-semibold tracking-[-0.025em] text-balance text-white sm:text-4xl">
              The next call you miss does not have to cost you the job.
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-lg text-brand-100">
              Four questions to set up. Bring one lead through and see for yourself.
            </p>

            <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Link
                href="/signup"
                className={buttonClasses({
                  size: 'lg',
                  variant: 'secondary',
                  className: 'w-full ring-0 sm:w-auto dark:bg-white dark:text-slate-900 dark:hover:bg-slate-100',
                })}
              >
                Start free
                <ArrowRight className="size-4" strokeWidth={2.25} />
              </Link>
              <a
                href="#pricing"
                className="w-full rounded-xl px-5 py-3 text-base font-medium text-white/90 transition-colors duration-150 ease-out hover:text-white sm:w-auto"
              >
                See pricing
              </a>
            </div>
          </div>
        </section>
      </main>

      {/* ── Footer ────────────────────────────────────────────────────────── */}
      <footer className="border-t border-slate-200/70 dark:border-slate-800/70">
        <div className="mx-auto grid max-w-6xl gap-10 px-4 py-14 sm:grid-cols-[2fr_1fr_1fr]">
          <div>
            <Logo />
            <p className="mt-4 max-w-xs text-sm text-pretty text-slate-500 dark:text-slate-400">
              Lead capture, quoting, follow-up, scheduling and job costing for lawn care and home
              service businesses.
            </p>
            <p className="mt-4 flex items-center gap-1.5 text-sm text-slate-500 dark:text-slate-400">
              <MapPin className="size-4" strokeWidth={2} />
              Built for crews in the field
            </p>
          </div>

          <div>
            <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">Product</p>
            <ul className="mt-4 space-y-2.5 text-sm">
              {[
                ['How it works', '#how-it-works'],
                ['Pricing', '#pricing'],
                ['Questions', '#questions'],
              ].map(([label, href]) => (
                <li key={href}>
                  <a href={href} className="text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100">
                    {label}
                  </a>
                </li>
              ))}
              <li>
                <Link href="/login" className="text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100">
                  Sign in
                </Link>
              </li>
            </ul>
          </div>

          <div>
            <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">Company</p>
            <ul className="mt-4 space-y-2.5 text-sm">
              <li>
                <Link href="/legal/terms" className="text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100">
                  Terms
                </Link>
              </li>
              <li>
                <Link href="/legal/privacy" className="text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100">
                  Privacy
                </Link>
              </li>
              <li>
                <a href={`mailto:${supportEmail}`} className="text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100">
                  Support
                </a>
              </li>
            </ul>
          </div>
        </div>

        <div className="border-t border-slate-200/70 dark:border-slate-800/70">
          <p className="mx-auto max-w-6xl px-4 py-6 text-sm text-slate-400 dark:text-slate-500">
            © {new Date().getFullYear()} JobFlow AI
          </p>
        </div>
      </footer>
    </div>
  );
}
