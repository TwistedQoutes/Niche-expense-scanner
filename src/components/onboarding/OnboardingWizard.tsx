'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { SelectField, TextField } from '@/components/ui/Field';
import { useToast } from '@/components/ui/Toast';
import { ApiError, apiRequest } from '@/lib/api-client';
import { centsToDecimalString, parseAmountToCents } from '@/lib/money';
import { INDUSTRIES } from '@/lib/services/templates';
import type { OnboardingState } from '@/lib/onboarding/repository';
import { ONBOARDING_STEPS } from '@/lib/validation/onboarding';

/**
 * Four questions, then out.
 *
 * Deliberately short. Every extra step is a chance for somebody who signed up at
 * 7am between jobs to close the tab, and none of these is unanswerable later —
 * the wizard writes the same fields Settings does, so a skipped question is a
 * field to fill in, not a broken workspace.
 *
 * Which is why **Skip is always available**. A setup flow that will not let you
 * past is how a product loses the customer it just acquired.
 */

const TIMEZONES = [
  ['America/New_York', 'Eastern — New York'],
  ['America/Chicago', 'Central — Chicago'],
  ['America/Denver', 'Mountain — Denver'],
  ['America/Phoenix', 'Arizona — no daylight saving'],
  ['America/Los_Angeles', 'Pacific — Los Angeles'],
  ['America/Anchorage', 'Alaska — Anchorage'],
  ['Pacific/Honolulu', 'Hawaii — Honolulu'],
  ['America/Toronto', 'Eastern — Toronto'],
  ['America/Vancouver', 'Pacific — Vancouver'],
] as const;

export function OnboardingWizard({ initial }: { initial: OnboardingState }) {
  const router = useRouter();
  const toast = useToast();

  const [index, setIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [note, setNote] = useState<string | null>(null);

  const [industry, setIndustryValue] = useState(initial.industry);
  const [phone, setPhone] = useState(initial.phone ?? '');
  const [timezone, setTimezone] = useState(initial.timezone);
  const [city, setCity] = useState(initial.city ?? '');
  const [state, setState] = useState(initial.state ?? '');
  const [laborRate, setLaborRate] = useState(centsToDecimalString(initial.defaultLaborRateCents));
  const [margin, setMargin] = useState(String(Math.round(initial.defaultProfitMarginBps / 100)));
  const [minimum, setMinimum] = useState(centsToDecimalString(initial.defaultMinimumJobCents));
  const [reviewUrl, setReviewUrl] = useState(initial.reviewUrl ?? '');

  const step = ONBOARDING_STEPS[index]!;
  const isLast = index === ONBOARDING_STEPS.length - 1;

  async function send(body: Record<string, unknown>): Promise<boolean> {
    setBusy(true);
    setError(null);
    setFieldErrors({});

    try {
      const result = await apiRequest<{ keptExisting?: boolean; installed?: number }>(
        '/api/onboarding',
        { method: 'POST', body },
      );

      // The trade step can decline to replace a catalogue the owner has already
      // worked on. Saying so beats appearing to do nothing.
      if (result.keptExisting) {
        setNote('Your trade is updated. Your existing services were left alone — they have been edited or used on a quote.');
      } else if (result.installed) {
        setNote(`${result.installed} starter services added for that trade.`);
      } else {
        setNote(null);
      }

      return true;
    } catch (caught) {
      if (caught instanceof ApiError) {
        setError(caught.message);
        setFieldErrors(caught.fieldErrors);
      } else {
        setError('Could not save that.');
      }
      return false;
    } finally {
      setBusy(false);
    }
  }

  function bodyForStep(): Record<string, unknown> | string {
    switch (step.key) {
      case 'trade':
        return { step: 'trade', industry };

      case 'business':
        return { step: 'business', phone, timezone, city, state };

      case 'pricing': {
        const rate = parseAmountToCents(laborRate);
        const floor = parseAmountToCents(minimum);
        const marginPercent = Number(margin);

        if (rate === null) return 'That hourly rate is not a number.';
        if (floor === null) return 'That minimum is not a number.';
        if (!Number.isFinite(marginPercent)) return 'That margin is not a number.';

        return {
          step: 'pricing',
          defaultLaborRateCents: rate,
          defaultProfitMarginBps: Math.round(marginPercent * 100),
          defaultMinimumJobCents: floor,
        };
      }

      case 'reviews':
        return { step: 'reviews', reviewUrl };
    }
  }

  async function next() {
    if (busy) return;

    const body = bodyForStep();
    if (typeof body === 'string') {
      setError(body);
      return;
    }

    if (!(await send(body))) return;

    if (isLast) {
      await send({ step: 'finish' });
      toast.success('You are set up.');
      router.push('/dashboard');
      router.refresh();
      return;
    }

    setIndex(index + 1);
  }

  async function finishEarly() {
    if (busy) return;

    // Whatever they have answered so far stands; the rest lives in Settings.
    await send({ step: 'finish' });
    router.push('/dashboard');
    router.refresh();
  }

  return (
    <div className="mx-auto w-full max-w-xl space-y-5">
      <ol className="flex flex-wrap gap-1.5" aria-label="Setup progress">
        {ONBOARDING_STEPS.map((entry, position) => (
          <li key={entry.key} className="flex-1">
            <span
              aria-current={position === index ? 'step' : undefined}
              className={
                position <= index
                  ? 'bg-brand-600 dark:bg-brand-500 block h-1 rounded-full'
                  : 'block h-1 rounded-full bg-slate-200 dark:bg-slate-700'
              }
            />
            <span className="sr-only">
              {entry.label}
              {position === index ? ' (current step)' : ''}
            </span>
          </li>
        ))}
      </ol>

      <div>
        <p className="text-xs font-medium tracking-wide text-slate-400 uppercase dark:text-slate-500">
          Step {index + 1} of {ONBOARDING_STEPS.length}
        </p>
        <h1 className="mt-1 text-xl font-semibold text-slate-900 dark:text-slate-50">
          {step.label}
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">{step.blurb}</p>
      </div>

      {error ? <Alert tone="error">{error}</Alert> : null}
      {note ? <Alert tone="info">{note}</Alert> : null}

      <form
        onSubmit={(event) => {
          event.preventDefault();
          void next();
        }}
        className="space-y-4"
      >
        {step.key === 'trade' ? (
          <SelectField
            label="What do you do?"
            value={industry}
            onChange={(event) => setIndustryValue(event.target.value)}
            error={fieldErrors.industry}
            hint="This sets up starter services and prices you can change later."
          >
            {INDUSTRIES.map((entry) => (
              <option key={entry.key} value={entry.key}>
                {entry.label}
              </option>
            ))}
          </SelectField>
        ) : null}

        {step.key === 'business' ? (
          <>
            <TextField
              label="Your business phone"
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              error={fieldErrors.phone}
              hint="Texts and missed calls to this number become leads."
            />
            <SelectField
              label="Timezone"
              value={timezone}
              onChange={(event) => setTimezone(event.target.value)}
              error={fieldErrors.timezone}
              hint="Every booking is read in this timezone. Getting it wrong puts the crew at the wrong hour."
            >
              {TIMEZONES.some(([zone]) => zone === timezone) ? null : (
                <option value={timezone}>{timezone}</option>
              )}
              {TIMEZONES.map(([zone, zoneLabel]) => (
                <option key={zone} value={zone}>
                  {zoneLabel}
                </option>
              ))}
            </SelectField>
            <div className="grid gap-3 sm:grid-cols-2">
              <TextField
                label="Town or city"
                value={city}
                onChange={(event) => setCity(event.target.value)}
                error={fieldErrors.city}
              />
              <TextField
                label="State"
                value={state}
                onChange={(event) => setState(event.target.value)}
                error={fieldErrors.state}
              />
            </div>
          </>
        ) : null}

        {step.key === 'pricing' ? (
          <>
            <TextField
              label="Your hourly rate"
              value={laborRate}
              onChange={(event) => setLaborRate(event.target.value)}
              error={fieldErrors.defaultLaborRateCents}
              hint="What an hour of your time costs, before profit."
            />
            <TextField
              label="Profit margin (%)"
              type="number"
              min={0}
              max={95}
              value={margin}
              onChange={(event) => setMargin(event.target.value)}
              error={fieldErrors.defaultProfitMarginBps}
              hint="Margin, not markup: a 30% margin on $70 of cost is a $100 price."
            />
            <TextField
              label="Smallest job you will take"
              value={minimum}
              onChange={(event) => setMinimum(event.target.value)}
              error={fieldErrors.defaultMinimumJobCents}
              hint="No quote comes out below this, however small the job."
            />
          </>
        ) : null}

        {step.key === 'reviews' ? (
          <TextField
            label="Your review link"
            value={reviewUrl}
            onChange={(event) => setReviewUrl(event.target.value)}
            error={fieldErrors.reviewUrl}
            placeholder="https://g.page/r/..."
            hint="Leave it blank for now if you do not have one — review requests stay off until it is set."
          />
        ) : null}

        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" loading={busy}>
            {isLast ? 'Finish setup' : 'Continue'}
          </Button>

          {index > 0 ? (
            <Button type="button" variant="ghost" onClick={() => setIndex(index - 1)}>
              Back
            </Button>
          ) : null}

          <button
            type="button"
            onClick={() => void finishEarly()}
            className="ml-auto text-sm text-slate-500 underline-offset-2 hover:underline dark:text-slate-400"
          >
            Skip — I will do this later
          </button>
        </div>
      </form>
    </div>
  );
}
