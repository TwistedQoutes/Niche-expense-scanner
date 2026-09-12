import Link from 'next/link';
import { connection } from 'next/server';

import { DemoButton } from '@/components/marketing/DemoButton';
import { Button } from '@/components/ui/Button';
import { INDUSTRIES } from '@/lib/services/templates';
import { PLANS } from '@/lib/billing/plans';
import { getPublicConfig } from '@/lib/env';

/**
 * The marketing page.
 *
 * It reads no database and no session, so it stays up even when the application
 * does not — the page that sells the product should not depend on the product.
 *
 * It is **not** statically prerendered, though, and that is a deliberate trade.
 * `DEMO_MODE` decides whether the page offers a demo, and a statically rendered
 * page inlines `process.env` at build time: a deployment that switched the flag on
 * afterwards would keep serving a page with no demo button until somebody
 * happened to redeploy, with nothing to indicate why. `connection()` moves that
 * read to request time. The cost is one cheap server render — no database, no
 * session, no third-party call — which is a good price for a flag that is right.
 *
 * The argument the page makes is one thing, repeated: a missed call is a lost job.
 * Everything else on it is evidence for that.
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

const STEPS = [
  {
    step: '1',
    title: 'Capture every lead',
    body: 'Intake form, phone, or a missed call that texts back within seconds. Nothing lands in a voicemail box you will not check until Sunday.',
  },
  {
    step: '2',
    title: 'Let AI sort the pile',
    body: 'Every lead arrives scored, summarised and ranked by urgency, with a suggested reply you can send or rewrite. You work the ones worth working.',
  },
  {
    step: '3',
    title: 'Send a real quote in minutes',
    body: 'Your rates, your margin, your minimum job price. The calculator shows the maths, you adjust the number, and the customer gets a page they can accept on their phone.',
  },
  {
    step: '4',
    title: 'Follow up without lifting a finger',
    body: 'Day 2, day 5, day 10 — text and email, written to sound like you. It stops the moment they reply.',
  },
  {
    step: '5',
    title: 'Book it, do it, get reviewed',
    body: 'An accepted quote becomes a scheduled job on its own. Finish it, and the review request goes out a few hours later.',
  },
  {
    step: '6',
    title: 'Bring them back',
    body: 'Thirty days on, JobFlow asks if they are ready for the next one. Repeat work is the cheapest work you will ever win.',
  },
];

const FEATURES = [
  ['Lead pipeline', 'Drag a card from New to Won. See where every customer stands without opening a thing.'],
  ['AI qualification', 'A score out of 100, the job in one line, how urgent it is, and what to do next.'],
  ['Quote calculator', 'Labour, materials, travel, overhead and margin — transparent, and yours to override.'],
  ['Professional quotes', 'A clean public link with your logo. No account needed to accept it.'],
  ['Automatic follow-up', 'SMS and email sequences you set once and stop thinking about.'],
  ['Missed-call text back', 'The call you could not take becomes a conversation instead of a competitor.'],
  ['Unified inbox', 'Texts and emails in one thread per customer, with AI-suggested replies.'],
  ['Calendar and jobs', 'Month, week and day. Crew assignment, before-and-after photos, completion notes.'],
  ['Reviews on autopilot', 'Sent when the work is fresh, tracked through open and click.'],
  ['Analytics that matter', 'Conversion rate, quote acceptance, average job value, response time.'],
];

const FAQS = [
  {
    q: 'Do I need to change my phone number?',
    a: 'No. You connect the number you already advertise, and JobFlow handles what happens when a call goes unanswered.',
  },
  {
    q: 'Will the AI quote a price on its own?',
    a: 'Never a price you have not configured. The assistant works from your service rates and your minimums, and when it cannot answer something it hands the conversation to you rather than inventing an answer.',
  },
  {
    q: 'Can it measure a lawn from satellite imagery?',
    a: 'It shows you the property and lets you record measurements, but it does not pretend a satellite photo is a survey. Anything not measured by hand is labelled an estimate, because a quote built on a guess costs you money on the job.',
  },
  {
    q: 'What if I already use something else?',
    a: 'Bring your customers in and run both for a month. JobFlow is built to be worth keeping on the strength of the follow-up alone.',
  },
  {
    q: 'Is my customer data mine?',
    a: 'Yes. Export it whenever you like, and deleting your account deletes it.',
  },
];

export default async function LandingPage() {
  // Request time, so the flags below are this deployment's current values rather
  // than whatever was set when the image was built.
  await connection();

  const { supportEmail, trialDays, demoMode } = getPublicConfig();

  return (
    <div className="bg-white dark:bg-slate-950">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4">
        <div className="flex items-center gap-2">
          <span className="bg-brand-600 flex size-8 items-center justify-center rounded-lg text-sm font-bold text-white">
            J
          </span>
          <span className="font-semibold text-slate-900 dark:text-slate-50">JobFlow AI</span>
        </div>

        <nav className="flex items-center gap-2">
          <Link
            href="/login"
            className="rounded-lg px-3 py-2 text-sm font-medium text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white"
          >
            Sign in
          </Link>
          <Link href="/signup">
            <Button size="sm">Start free</Button>
          </Link>
        </nav>
      </header>

      {/* ── Hero ────────────────────────────────────────────────────────── */}
      <section className="mx-auto max-w-6xl px-4 pt-12 pb-16 text-center sm:pt-20">
        <p className="text-brand-700 dark:text-brand-400 text-sm font-semibold tracking-wide uppercase">
          For lawn care &amp; home services
        </p>

        <h1 className="mx-auto mt-3 max-w-3xl text-4xl font-bold tracking-tight text-slate-900 sm:text-5xl dark:text-slate-50">
          Turn Leads Into Jobs. Automatically.
        </h1>

        <p className="mx-auto mt-5 max-w-2xl text-lg text-slate-600 dark:text-slate-300">
          JobFlow AI helps local service businesses capture leads, generate quotes, follow up
          automatically, schedule jobs, and turn customers into repeat business — all from one
          simple platform.
        </p>

        <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Link href="/signup" className="w-full sm:w-auto">
            <Button size="lg" className="w-full sm:w-auto">
              Start free
            </Button>
          </Link>
          {demoMode ? (
            <DemoButton className="w-full sm:w-auto" />
          ) : (
            <Link href="#how-it-works" className="w-full sm:w-auto">
              <Button size="lg" variant="secondary" className="w-full sm:w-auto">
                Watch how it works
              </Button>
            </Link>
          )}
        </div>

        <p className="mt-4 text-sm text-slate-500 dark:text-slate-400">
          {trialDays > 0 ? `${trialDays}-day trial of everything. ` : ''}No card required.
          {demoMode ? ' The demo needs no account at all.' : ''}
        </p>
      </section>

      {/* ── Problem ─────────────────────────────────────────────────────── */}
      <section className="border-y border-slate-200 bg-slate-50 py-16 dark:border-slate-800 dark:bg-slate-900/50">
        <div className="mx-auto max-w-6xl px-4">
          <h2 className="mx-auto max-w-3xl text-center text-3xl font-bold tracking-tight text-slate-900 dark:text-slate-50">
            Stop losing customers because you were too busy to answer the phone.
          </h2>

          <div className="mt-10 grid gap-6 md:grid-cols-3">
            {PROBLEMS.map((problem) => (
              <div
                key={problem.title}
                className="rounded-2xl bg-white p-6 ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800"
              >
                <h3 className="font-semibold text-slate-900 dark:text-slate-100">
                  {problem.title}
                </h3>
                <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">{problem.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── How it works ────────────────────────────────────────────────── */}
      <section id="how-it-works" className="mx-auto max-w-6xl px-4 py-16">
        <div className="text-center">
          <h2 className="text-3xl font-bold tracking-tight text-slate-900 dark:text-slate-50">
            One system, from the first call to the next one
          </h2>
          <p className="mx-auto mt-3 max-w-2xl text-slate-600 dark:text-slate-300">
            Every step below happens whether or not you remember to do it.
          </p>
        </div>

        <ol className="mt-10 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {STEPS.map((step) => (
            <li
              key={step.step}
              className="rounded-2xl bg-white p-6 ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800"
            >
              <span className="bg-brand-600 flex size-8 items-center justify-center rounded-lg text-sm font-bold text-white">
                {step.step}
              </span>
              <h3 className="mt-4 font-semibold text-slate-900 dark:text-slate-100">
                {step.title}
              </h3>
              <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">{step.body}</p>
            </li>
          ))}
        </ol>
      </section>

      {/* ── Features ────────────────────────────────────────────────────── */}
      <section className="border-y border-slate-200 bg-slate-50 py-16 dark:border-slate-800 dark:bg-slate-900/50">
        <div className="mx-auto max-w-6xl px-4">
          <h2 className="text-center text-3xl font-bold tracking-tight text-slate-900 dark:text-slate-50">
            Everything you would otherwise do at 9pm
          </h2>

          <dl className="mt-10 grid gap-x-8 gap-y-6 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map(([title, body]) => (
              <div key={title}>
                <dt className="font-semibold text-slate-900 dark:text-slate-100">{title}</dt>
                <dd className="mt-1 text-sm text-slate-600 dark:text-slate-400">{body}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      {/* ── Industries ──────────────────────────────────────────────────── */}
      <section className="mx-auto max-w-6xl px-4 py-16 text-center">
        <h2 className="text-3xl font-bold tracking-tight text-slate-900 dark:text-slate-50">
          Built for the trades
        </h2>
        <p className="mx-auto mt-3 max-w-2xl text-slate-600 dark:text-slate-300">
          Set up for lawn care and home services first, with pricing templates for each trade.
        </p>

        <ul className="mt-8 flex flex-wrap justify-center gap-2">
          {INDUSTRIES.filter((industry) => industry.key !== 'other').map((industry) => (
            <li
              key={industry.key}
              className="rounded-full bg-slate-100 px-4 py-2 text-sm font-medium text-slate-700 dark:bg-slate-800 dark:text-slate-300"
            >
              {industry.label}
            </li>
          ))}
        </ul>
      </section>

      {/* ── Pricing ─────────────────────────────────────────────────────── */}
      <section
        id="pricing"
        className="border-y border-slate-200 bg-slate-50 py-16 dark:border-slate-800 dark:bg-slate-900/50"
      >
        <div className="mx-auto max-w-6xl px-4">
          <h2 className="text-center text-3xl font-bold tracking-tight text-slate-900 dark:text-slate-50">
            Priced like a tool, not a tax
          </h2>
          <p className="mx-auto mt-3 max-w-2xl text-center text-slate-600 dark:text-slate-300">
            One job a month covers it. Change plan or cancel whenever you like.
          </p>

          <div className="mt-10 grid gap-6 md:grid-cols-2 lg:grid-cols-4">
            {PLANS.map((plan) => (
              <div
                key={plan.tier}
                className={
                  plan.highlighted
                    ? 'ring-brand-600 relative rounded-2xl bg-white p-6 ring-2 dark:bg-slate-900'
                    : 'relative rounded-2xl bg-white p-6 ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800'
                }
              >
                {plan.highlighted ? (
                  <span className="bg-brand-600 absolute -top-3 left-6 rounded-full px-3 py-1 text-xs font-semibold text-white">
                    Most popular
                  </span>
                ) : null}

                <h3 className="font-semibold text-slate-900 dark:text-slate-100">{plan.name}</h3>

                <p className="mt-2">
                  <span className="tabular text-3xl font-bold text-slate-900 dark:text-slate-50">
                    ${plan.monthlyPriceCents / 100}
                  </span>
                  <span className="text-sm text-slate-500 dark:text-slate-400">/month</span>
                </p>

                <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">{plan.tagline}</p>

                <ul className="mt-4 space-y-2 text-sm text-slate-600 dark:text-slate-400">
                  {plan.features.map((feature) => (
                    <li key={feature} className="flex gap-2">
                      <span aria-hidden="true" className="text-brand-600 dark:text-brand-400">
                        ✓
                      </span>
                      {feature}
                    </li>
                  ))}
                </ul>

                <Link href="/signup" className="mt-6 block">
                  <Button fullWidth variant={plan.highlighted ? 'primary' : 'secondary'}>
                    {plan.monthlyPriceCents === 0 ? 'Start free' : `Choose ${plan.name}`}
                  </Button>
                </Link>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Testimonials ────────────────────────────────────────────────── */}
      <section className="mx-auto max-w-6xl px-4 py-16">
        <h2 className="text-center text-3xl font-bold tracking-tight text-slate-900 dark:text-slate-50">
          From the field
        </h2>

        <div className="mt-10 grid gap-6 md:grid-cols-3">
          {[1, 2, 3].map((slot) => (
            <figure
              key={slot}
              className="rounded-2xl border border-dashed border-slate-300 p-6 dark:border-slate-700"
            >
              {/*
                Left empty on purpose until real customers have said something
                real. Inventing a quote from a business that does not exist is
                the fastest way to lose the trust this page is trying to earn.
              */}
              <figcaption className="text-sm text-slate-400 dark:text-slate-500">
                Customer story coming soon
              </figcaption>
            </figure>
          ))}
        </div>
      </section>

      {/* ── FAQ ─────────────────────────────────────────────────────────── */}
      <section className="border-t border-slate-200 py-16 dark:border-slate-800">
        <div className="mx-auto max-w-3xl px-4">
          <h2 className="text-center text-3xl font-bold tracking-tight text-slate-900 dark:text-slate-50">
            Questions owners actually ask
          </h2>

          <dl className="mt-10 space-y-6">
            {FAQS.map((faq) => (
              <div key={faq.q}>
                <dt className="font-semibold text-slate-900 dark:text-slate-100">{faq.q}</dt>
                <dd className="mt-1 text-sm text-slate-600 dark:text-slate-400">{faq.a}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      {/* ── Final CTA ───────────────────────────────────────────────────── */}
      <section className="bg-brand-700 py-16">
        <div className="mx-auto max-w-3xl px-4 text-center">
          <h2 className="text-3xl font-bold tracking-tight text-white">
            The next call you miss does not have to cost you the job.
          </h2>
          <p className="mt-3 text-brand-100">
            Set up in about two minutes. Bring one lead through and see for yourself.
          </p>
          <Link href="/signup" className="mt-8 inline-block">
            <Button size="lg" variant="secondary">
              Start free
            </Button>
          </Link>
        </div>
      </section>

      <footer className="mx-auto max-w-6xl px-4 py-10 text-sm text-slate-500 dark:text-slate-400">
        <div className="flex flex-col items-center justify-between gap-4 sm:flex-row">
          <p>© {new Date().getFullYear()} JobFlow AI</p>
          <div className="flex gap-4">
            <Link href="/legal/terms" className="hover:text-slate-800 dark:hover:text-slate-200">
              Terms
            </Link>
            <Link href="/legal/privacy" className="hover:text-slate-800 dark:hover:text-slate-200">
              Privacy
            </Link>
            <a
              href={`mailto:${supportEmail}`}
              className="hover:text-slate-800 dark:hover:text-slate-200"
            >
              Support
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
