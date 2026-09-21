'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';

import { Button } from '@/components/ui/Button';
import { TextField } from '@/components/ui/Field';
import { useToast } from '@/components/ui/Toast';
import { ApiError, apiRequest } from '@/lib/api-client';
import { parseAmountToCents } from '@/lib/money';

/**
 * The workspace pricing defaults.
 *
 * Every quote starts from these, so the copy explains what each one *does*
 * rather than restating its name. The margin field in particular needs saying
 * out loud: an owner who reads "30%" as "add 30%" will under-price every job,
 * and the hint is the only place the product gets to correct that before they
 * send a quote.
 */
export function DefaultsForm({
  defaults,
  canEdit,
}: {
  defaults: {
    defaultLaborRateCents: number;
    defaultProfitMarginBps: number;
    defaultTravelFeeCents: number;
    defaultMinimumJobCents: number;
    defaultOverheadCents: number;
    defaultTaxRateBps: number;
    fuelPricePerGallonCents: number | null;
    vehicleMpgMilli: number | null;
  };
  canEdit: boolean;
}) {
  const router = useRouter();
  const toast = useToast();

  const [form, setForm] = useState({
    laborRate: (defaults.defaultLaborRateCents / 100).toFixed(2),
    margin: String(defaults.defaultProfitMarginBps / 100),
    travelFee: (defaults.defaultTravelFeeCents / 100).toFixed(2),
    minimum: (defaults.defaultMinimumJobCents / 100).toFixed(2),
    overhead: (defaults.defaultOverheadCents / 100).toFixed(2),
    taxRate: String(defaults.defaultTaxRateBps / 100),
    // Blank rather than zero when unset, because those mean different things
    // here: nobody has said, versus the truck runs on nothing.
    fuelPrice:
      defaults.fuelPricePerGallonCents === null
        ? ''
        : (defaults.fuelPricePerGallonCents / 100).toFixed(2),
    mpg: defaults.vehicleMpgMilli === null ? '' : String(defaults.vehicleMpgMilli / 1000),
  });

  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  function set<K extends keyof typeof form>(key: K, next: string) {
    setForm((current) => ({ ...current, [key]: next }));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting || !canEdit) return;

    const laborRate = parseAmountToCents(form.laborRate || '0');
    const travelFee = parseAmountToCents(form.travelFee || '0');
    const minimum = parseAmountToCents(form.minimum || '0');
    const overhead = parseAmountToCents(form.overhead || '0');
    const margin = Number.parseFloat(form.margin);
    const taxRate = Number.parseFloat(form.taxRate);

    if (
      laborRate === null ||
      travelFee === null ||
      minimum === null ||
      overhead === null ||
      !Number.isFinite(margin) ||
      !Number.isFinite(taxRate)
    ) {
      setFieldErrors({ laborRate: 'Check these values — use numbers like 35 or 35.00.' });
      return;
    }

    /*
     * Blank stays null all the way to the database. A fuel price of zero would
     * be counted as a real number and make every job look cheaper than it is;
     * null means the cost view leaves fuel out and says why.
     */
    const fuelPrice = form.fuelPrice.trim() ? parseAmountToCents(form.fuelPrice) : null;
    const mpgEntered = form.mpg.trim() ? Number.parseFloat(form.mpg) : null;

    if (form.fuelPrice.trim() && fuelPrice === null) {
      setFieldErrors({ fuelPrice: 'Enter a price like 3.89, or leave it blank.' });
      return;
    }

    if (mpgEntered !== null && (!Number.isFinite(mpgEntered) || mpgEntered <= 0)) {
      setFieldErrors({ mpg: 'Enter miles per gallon like 18.5, or leave it blank.' });
      return;
    }

    setSubmitting(true);
    setFieldErrors({});

    try {
      await apiRequest('/api/pricing/defaults', {
        method: 'PATCH',
        body: {
          defaultLaborRateCents: laborRate,
          defaultProfitMarginBps: Math.round(margin * 100),
          defaultTravelFeeCents: travelFee,
          defaultMinimumJobCents: minimum,
          defaultOverheadCents: overhead,
          defaultTaxRateBps: Math.round(taxRate * 100),
          fuelPricePerGallonCents: fuelPrice,
          vehicleMpgMilli: mpgEntered === null ? null : Math.round(mpgEntered * 1000),
        },
      });

      toast.success('Pricing defaults saved.');
      router.refresh();
    } catch (error) {
      if (error instanceof ApiError) {
        setFieldErrors(
          Object.keys(error.fieldErrors).length > 0
            ? error.fieldErrors
            : { laborRate: error.message },
        );
      } else {
        toast.error('Could not save those defaults.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-4 p-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          label="Labour rate / hour"
          inputMode="decimal"
          hint="What an hour of crew time costs you"
          disabled={!canEdit}
          value={form.laborRate}
          onChange={(event) => set('laborRate', event.target.value)}
          error={fieldErrors.defaultLaborRateCents ?? fieldErrors.laborRate}
        />

        <TextField
          label="Profit margin %"
          inputMode="decimal"
          hint="Kept as a share of the price. 30% means cost ÷ 0.70, not cost + 30%."
          disabled={!canEdit}
          value={form.margin}
          onChange={(event) => set('margin', event.target.value)}
          error={fieldErrors.defaultProfitMarginBps}
        />

        <TextField
          label="Travel fee"
          inputMode="decimal"
          hint="Flat call-out charge, before any mileage rule"
          disabled={!canEdit}
          value={form.travelFee}
          onChange={(event) => set('travelFee', event.target.value)}
          error={fieldErrors.defaultTravelFeeCents}
        />

        <TextField
          label="Minimum job price"
          inputMode="decimal"
          hint="The floor below which you will not take the work"
          disabled={!canEdit}
          value={form.minimum}
          onChange={(event) => set('minimum', event.target.value)}
          error={fieldErrors.defaultMinimumJobCents}
        />

        <TextField
          label="Overhead per job"
          inputMode="decimal"
          hint="Insurance, fuel, admin — spread across each job"
          disabled={!canEdit}
          value={form.overhead}
          onChange={(event) => set('overhead', event.target.value)}
          error={fieldErrors.defaultOverheadCents}
        />

        <TextField
          label="Sales tax %"
          inputMode="decimal"
          hint="Applied only to services you mark taxable. 0 if you do not charge it."
          disabled={!canEdit}
          value={form.taxRate}
          onChange={(event) => set('taxRate', event.target.value)}
          error={fieldErrors.defaultTaxRateBps}
        />
      </div>

      <div className="space-y-3 border-t border-slate-100 pt-4 dark:border-slate-800">
        <div>
          <h3 className="text-sm font-medium text-slate-900 dark:text-slate-100">
            What the driving costs you
          </h3>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
            Not what you charge for travel — what leaves your bank account. These two
            turn the miles on a job into the fuel bill on the job costs screen. Leave
            them blank and fuel is left out rather than counted as free.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            label="Fuel price / gallon"
            inputMode="decimal"
            placeholder="3.89"
            hint="What you last paid at the pump"
            disabled={!canEdit}
            value={form.fuelPrice}
            onChange={(event) => set('fuelPrice', event.target.value)}
            error={fieldErrors.fuelPricePerGallonCents ?? fieldErrors.fuelPrice}
          />

          <TextField
            label="Truck miles per gallon"
            inputMode="decimal"
            placeholder="18.5"
            hint="Loaded, with the trailer on — not the sticker figure"
            disabled={!canEdit}
            value={form.mpg}
            onChange={(event) => set('mpg', event.target.value)}
            error={fieldErrors.vehicleMpgMilli ?? fieldErrors.mpg}
          />
        </div>
      </div>

      {canEdit ? (
        <Button type="submit" size="sm" loading={submitting}>
          Save defaults
        </Button>
      ) : (
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Only an owner or admin can change pricing defaults.
        </p>
      )}
    </form>
  );
}
