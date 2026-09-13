'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { Alert } from '@/components/ui/Alert';
import { SelectField, TextField } from '@/components/ui/Field';
import { Spinner } from '@/components/ui/Spinner';
import { ApiError, apiRequest } from '@/lib/api-client';
import { cn } from '@/lib/cn';
import { formatBps, formatCents, parseAmountToCents } from '@/lib/money';
import type { PricingBreakdown } from '@/lib/pricing/engine';

type ServiceOption = {
  id: string;
  name: string;
  estimatedMinutes: number;
  unitSizeSqFt: number;
};

/**
 * The quote calculator.
 *
 * The spec asked for a transparent formula, and transparency here means the
 * owner can see *why* a number moved. So the whole derivation is rendered — cost
 * lines, the margin step, the floor, fees, discount, tax — rather than a total
 * with a tooltip.
 *
 * The arithmetic happens on the server (see /api/pricing/calculate) even though
 * the engine is pure and could run here. Labour rates, margins and pricing rules
 * are the most commercially sensitive numbers a business has; shipping them to
 * the browser so a form can do sums hands them to anyone who opens the network
 * tab, including a competitor on a free account.
 */
export function QuoteCalculator({
  services,
  currency,
  defaults,
}: {
  services: ServiceOption[];
  currency: string;
  defaults: {
    laborRateCents: number;
    profitMarginBps: number;
    travelFeeCents: number;
    minimumJobCents: number;
    overheadCents: number;
    taxRateBps: number;
  };
}) {
  const [serviceId, setServiceId] = useState('');
  const [form, setForm] = useState({
    areaSqFt: '',
    laborMinutes: '',
    laborRate: (defaults.laborRateCents / 100).toFixed(2),
    materials: '',
    equipment: '',
    travelMiles: '',
    travelFee: (defaults.travelFeeCents / 100).toFixed(2),
    overhead: (defaults.overheadCents / 100).toFixed(2),
    marginPercent: String(defaults.profitMarginBps / 100),
    minimum: (defaults.minimumJobCents / 100).toFixed(2),
    fees: '',
    discount: '',
    override: '',
  });

  const [breakdown, setBreakdown] = useState<PricingBreakdown | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  // Each keystroke would otherwise fire a request. The ref holds the in-flight
  // controller so a stale response cannot overwrite a newer one.
  const inFlight = useRef<AbortController | null>(null);

  function set<K extends keyof typeof form>(key: K, next: string) {
    setForm((current) => ({ ...current, [key]: next }));
  }

  const calculate = useCallback(async () => {
    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;

    setPending(true);
    setError(null);

    // A blank field means "not specified", which is different from zero: a blank
    // margin should fall back to the workspace default, a zero margin should
    // genuinely price at cost.
    const cents = (raw: string): number | undefined => {
      if (raw.trim() === '') return undefined;
      const parsed = parseAmountToCents(raw);
      return parsed === null ? undefined : Math.max(0, parsed);
    };
    const whole = (raw: string): number | undefined => {
      if (raw.trim() === '') return undefined;
      const parsed = Number.parseInt(raw, 10);
      return Number.isFinite(parsed) ? Math.max(0, parsed) : undefined;
    };
    const bps = (raw: string): number | undefined => {
      if (raw.trim() === '') return undefined;
      const parsed = Number.parseFloat(raw);
      return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed * 100)) : undefined;
    };

    try {
      const result = await apiRequest<{ breakdown: PricingBreakdown }>('/api/pricing/calculate', {
        method: 'POST',
        signal: controller.signal,
        body: {
          serviceId: serviceId || undefined,
          areaSqFt: whole(form.areaSqFt),
          laborMinutes: whole(form.laborMinutes),
          laborRateCents: cents(form.laborRate),
          materialCostCents: cents(form.materials),
          equipmentCostCents: cents(form.equipment),
          travelMiles: whole(form.travelMiles),
          travelFeeCents: cents(form.travelFee),
          overheadCents: cents(form.overhead),
          profitMarginBps: bps(form.marginPercent),
          minimumJobCents: cents(form.minimum),
          additionalFeesCents: cents(form.fees),
          discountCents: cents(form.discount),
          overridePriceCents: form.override.trim() === '' ? null : cents(form.override),
        },
      });

      setBreakdown(result.breakdown);
    } catch (caught) {
      // An abort is this component's own doing, not a failure to report.
      if (caught instanceof DOMException && caught.name === 'AbortError') return;
      setError(caught instanceof ApiError ? caught.message : 'Could not price that.');
    } finally {
      if (!controller.signal.aborted) setPending(false);
    }
  }, [serviceId, form]);

  // Debounced: 250ms after typing stops, which keeps the panel feeling live
  // without a request per character.
  useEffect(() => {
    const timer = setTimeout(() => void calculate(), 250);
    return () => clearTimeout(timer);
  }, [calculate]);

  const selectedService = services.find((service) => service.id === serviceId);

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <div className="space-y-4">
        <SelectField
          label="Service"
          value={serviceId}
          onChange={(event) => setServiceId(event.target.value)}
          hint="Choosing one fills in its base price, labour estimate and area rate."
        >
          <option value="">No service — price from scratch</option>
          {services.map((service) => (
            <option key={service.id} value={service.id}>
              {service.name}
            </option>
          ))}
        </SelectField>

        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            label="Property size"
            inputMode="numeric"
            placeholder="3000"
            hint={
              selectedService
                ? `Charged per ${selectedService.unitSizeSqFt.toLocaleString()} sq ft beyond the first`
                : 'Square feet'
            }
            value={form.areaSqFt}
            onChange={(event) => set('areaSqFt', event.target.value)}
          />

          <TextField
            label="Labour (minutes)"
            inputMode="numeric"
            placeholder={selectedService ? String(selectedService.estimatedMinutes) : '120'}
            value={form.laborMinutes}
            onChange={(event) => set('laborMinutes', event.target.value)}
          />

          <TextField
            label="Labour rate / hour"
            inputMode="decimal"
            value={form.laborRate}
            onChange={(event) => set('laborRate', event.target.value)}
          />

          <TextField
            label="Materials"
            inputMode="decimal"
            placeholder="0.00"
            value={form.materials}
            onChange={(event) => set('materials', event.target.value)}
          />

          <TextField
            label="Equipment"
            inputMode="decimal"
            placeholder="0.00"
            value={form.equipment}
            onChange={(event) => set('equipment', event.target.value)}
          />

          <TextField
            label="Travel distance (miles)"
            inputMode="numeric"
            placeholder="0"
            value={form.travelMiles}
            onChange={(event) => set('travelMiles', event.target.value)}
          />

          <TextField
            label="Travel fee"
            inputMode="decimal"
            value={form.travelFee}
            onChange={(event) => set('travelFee', event.target.value)}
          />

          <TextField
            label="Overhead"
            inputMode="decimal"
            value={form.overhead}
            onChange={(event) => set('overhead', event.target.value)}
          />

          <TextField
            label="Profit margin %"
            inputMode="decimal"
            hint="Kept as a share of the price, not added to cost"
            value={form.marginPercent}
            onChange={(event) => set('marginPercent', event.target.value)}
          />

          <TextField
            label="Minimum job price"
            inputMode="decimal"
            value={form.minimum}
            onChange={(event) => set('minimum', event.target.value)}
          />

          <TextField
            label="Additional fees"
            inputMode="decimal"
            placeholder="0.00"
            value={form.fees}
            onChange={(event) => set('fees', event.target.value)}
          />

          <TextField
            label="Discount"
            inputMode="decimal"
            placeholder="0.00"
            value={form.discount}
            onChange={(event) => set('discount', event.target.value)}
          />
        </div>

        <TextField
          label="Override the price"
          inputMode="decimal"
          placeholder="Leave blank to use the calculated price"
          hint="Your number wins. The panel will show what it does to your margin."
          value={form.override}
          onChange={(event) => set('override', event.target.value)}
        />
      </div>

      {/* ── The working ─────────────────────────────────────────────────── */}
      <div className="lg:sticky lg:top-20 lg:self-start">
        <div className="rounded-2xl bg-white ring-1 ring-slate-200/80 dark:bg-slate-900 dark:ring-slate-800">
          <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-4 py-3 dark:border-slate-800">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              How this price is reached
            </h3>
            {pending ? <Spinner className="size-4 text-slate-400" label="Pricing" /> : null}
          </div>

          {error ? (
            <div className="p-4">
              <Alert tone="error">{error}</Alert>
            </div>
          ) : breakdown === null ? (
            <p className="p-4 text-sm text-slate-500 dark:text-slate-400">
              Enter some numbers to see the breakdown.
            </p>
          ) : (
            <>
              <dl className="divide-y divide-slate-100 dark:divide-slate-800">
                {breakdown.lines.map((line) => (
                  <div
                    key={line.key}
                    className={cn(
                      'flex items-baseline justify-between gap-4 px-4 py-2.5',
                      line.kind === 'total' && 'bg-slate-50 dark:bg-slate-800/50',
                    )}
                  >
                    <dt className="min-w-0">
                      <span
                        className={cn(
                          'text-sm',
                          line.kind === 'total'
                            ? 'font-semibold text-slate-900 dark:text-slate-100'
                            : 'text-slate-700 dark:text-slate-300',
                        )}
                      >
                        {line.label}
                      </span>
                      {line.detail ? (
                        <span className="block text-xs text-slate-500 dark:text-slate-400">
                          {line.detail}
                        </span>
                      ) : null}
                    </dt>

                    <dd
                      className={cn(
                        'tabular shrink-0 text-sm',
                        line.kind === 'total'
                          ? 'font-semibold text-slate-900 dark:text-slate-100'
                          : line.amountCents < 0
                            ? 'text-brand-700 dark:text-brand-400'
                            : 'text-slate-700 dark:text-slate-300',
                      )}
                    >
                      {formatCents(line.amountCents, currency)}
                    </dd>
                  </div>
                ))}
              </dl>

              <div className="grid grid-cols-2 gap-3 border-t border-slate-100 p-4 dark:border-slate-800">
                <div>
                  <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Profit</p>
                  <p
                    className={cn(
                      'tabular text-lg font-semibold',
                      breakdown.profitCents < 0
                        ? 'text-red-600 dark:text-red-400'
                        : 'text-slate-900 dark:text-slate-50',
                    )}
                  >
                    {formatCents(breakdown.profitCents, currency)}
                  </p>
                </div>

                <div>
                  <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
                    Actual margin
                  </p>
                  <p
                    className={cn(
                      'tabular text-lg font-semibold',
                      breakdown.actualMarginBps < 0
                        ? 'text-red-600 dark:text-red-400'
                        : 'text-slate-900 dark:text-slate-50',
                    )}
                  >
                    {formatBps(breakdown.actualMarginBps)}
                  </p>
                  {breakdown.targetMarginBps > 0 ? (
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      target {formatBps(breakdown.targetMarginBps)}
                    </p>
                  ) : null}
                </div>
              </div>

              {breakdown.warnings.length > 0 ? (
                <div className="space-y-2 px-4 pb-4">
                  {breakdown.warnings.map((warning) => (
                    <Alert
                      key={warning}
                      tone={breakdown.profitCents < 0 ? 'error' : 'warning'}
                    >
                      {warning}
                    </Alert>
                  ))}
                </div>
              ) : null}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
