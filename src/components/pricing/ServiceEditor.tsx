'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { TextField } from '@/components/ui/Field';
import { useToast } from '@/components/ui/Toast';
import { ApiError, apiRequest } from '@/lib/api-client';
import { formatCents, parseAmountToCents } from '@/lib/money';

export type EditableService = {
  id: string;
  name: string;
  description: string | null;
  basePriceCents: number;
  minimumPriceCents: number;
  unitPriceCents: number;
  unitSizeSqFt: number;
  estimatedMinutes: number;
  materialCostCents: number;
  taxable: boolean;
  active: boolean;
};

/**
 * The service catalogue.
 *
 * Each row edits in place rather than opening a modal: an owner adjusting rates
 * is usually adjusting several, and a dialog per service turns a five-minute job
 * into twenty clicks.
 */
export function ServiceEditor({
  services,
  currency,
  canEdit,
}: {
  services: EditableService[];
  currency: string;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  return (
    <div>
      <ul className="divide-y divide-slate-100 dark:divide-slate-800">
        {services.map((service) =>
          editingId === service.id ? (
            <li key={service.id} className="p-4">
              <ServiceForm
                // Keyed by id so switching which row is open gives the form a
                // fresh state rather than carrying the previous row's values.
                key={service.id}
                service={service}
                currency={currency}
                onDone={() => {
                  setEditingId(null);
                  router.refresh();
                }}
                onCancel={() => setEditingId(null)}
              />
            </li>
          ) : (
            <li key={service.id} className="flex items-start justify-between gap-3 px-4 py-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
                    {service.name}
                  </p>
                  {service.active ? null : <Badge tone="neutral">Inactive</Badge>}
                  {service.taxable ? <Badge tone="info">Taxable</Badge> : null}
                </div>

                <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                  {formatCents(service.basePriceCents, currency)} base
                  {service.unitPriceCents > 0
                    ? ` · ${formatCents(service.unitPriceCents, currency)} per extra ${service.unitSizeSqFt.toLocaleString()} sq ft`
                    : ''}
                  {service.minimumPriceCents > 0
                    ? ` · ${formatCents(service.minimumPriceCents, currency)} minimum`
                    : ''}
                  {` · ${service.estimatedMinutes} min`}
                </p>
              </div>

              {canEdit ? (
                <Button size="sm" variant="ghost" onClick={() => setEditingId(service.id)}>
                  Edit
                </Button>
              ) : null}
            </li>
          ),
        )}
      </ul>

      {canEdit ? (
        <div className="border-t border-slate-100 p-4 dark:border-slate-800">
          {adding ? (
            <ServiceForm
              currency={currency}
              onDone={() => {
                setAdding(false);
                router.refresh();
              }}
              onCancel={() => setAdding(false)}
            />
          ) : (
            <Button size="sm" variant="secondary" onClick={() => setAdding(true)}>
              Add a service
            </Button>
          )}
        </div>
      ) : (
        <p className="border-t border-slate-100 px-4 py-3 text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">
          Only an owner or admin can change pricing.
        </p>
      )}
    </div>
  );
}

/**
 * Declared at module scope, not nested inside `ServiceEditor`.
 *
 * A component defined inside another component is a *new component type* on
 * every parent render, so React unmounts and remounts it — throwing away its
 * `useState`. In practice that meant a half-typed rate vanishing the moment
 * anything above it re-rendered. Hoisting it out is the fix; the `key` on the
 * call site handles switching between rows.
 */
function ServiceForm({
  service,
  currency,
  onDone,
  onCancel,
}: {
  service?: EditableService;
  currency: string;
  onDone: () => void;
  onCancel: () => void;
}) {
  const toast = useToast();
  const isNew = service === undefined;

  const [form, setForm] = useState({
    name: service?.name ?? '',
    base: ((service?.basePriceCents ?? 0) / 100).toFixed(2),
    minimum: ((service?.minimumPriceCents ?? 0) / 100).toFixed(2),
    unitPrice: ((service?.unitPriceCents ?? 0) / 100).toFixed(2),
    unitSize: String(service?.unitSizeSqFt ?? 1000),
    minutes: String(service?.estimatedMinutes ?? 30),
    materials: ((service?.materialCostCents ?? 0) / 100).toFixed(2),
    taxable: service?.taxable ?? false,
    active: service?.active ?? true,
  });

  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  function set<K extends keyof typeof form>(key: K, next: (typeof form)[K]) {
    setForm((current) => ({ ...current, [key]: next }));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;

    const base = parseAmountToCents(form.base || '0');
    const minimum = parseAmountToCents(form.minimum || '0');
    const unitPrice = parseAmountToCents(form.unitPrice || '0');
    const materials = parseAmountToCents(form.materials || '0');

    if (base === null || minimum === null || unitPrice === null || materials === null) {
      setFieldErrors({ base: 'Enter amounts like 45 or 45.00.' });
      return;
    }

    setSubmitting(true);
    setFieldErrors({});

    const body = {
      name: form.name,
      basePriceCents: base,
      minimumPriceCents: minimum,
      unitPriceCents: unitPrice,
      unitSizeSqFt: Number.parseInt(form.unitSize, 10) || 1000,
      estimatedMinutes: Number.parseInt(form.minutes, 10) || 0,
      materialCostCents: materials,
      taxable: form.taxable,
      active: form.active,
    };

    try {
      await apiRequest(isNew ? '/api/services' : `/api/services/${service.id}`, {
        method: isNew ? 'POST' : 'PATCH',
        body,
      });
      toast.success(isNew ? 'Service added.' : 'Service updated.');
      onDone();
    } catch (error) {
      setSubmitting(false);
      if (error instanceof ApiError) {
        setFieldErrors(
          Object.keys(error.fieldErrors).length > 0 ? error.fieldErrors : { name: error.message },
        );
        return;
      }
      toast.error('Could not save that service.');
    }
  }

  async function remove() {
    if (!service) return;
    setSubmitting(true);

    try {
      await apiRequest(`/api/services/${service.id}`, { method: 'DELETE' });
      toast.success('Service deleted.');
      onDone();
    } catch (error) {
      setSubmitting(false);
      // The API refuses to delete a service that is on a quote, and explains
      // why — deactivating keeps the history intact.
      toast.error(error instanceof ApiError ? error.message : 'Could not delete that service.');
    }
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      <TextField
        label="Name"
        required
        value={form.name}
        onChange={(event) => set('name', event.target.value)}
        error={fieldErrors.name}
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          label="Base price"
          inputMode="decimal"
          value={form.base}
          onChange={(event) => set('base', event.target.value)}
          error={fieldErrors.basePriceCents ?? fieldErrors.base}
        />
        <TextField
          label="Minimum price"
          inputMode="decimal"
          hint="0 to use the workspace floor"
          value={form.minimum}
          onChange={(event) => set('minimum', event.target.value)}
          error={fieldErrors.minimumPriceCents}
        />
        <TextField
          label="Price per extra unit"
          inputMode="decimal"
          value={form.unitPrice}
          onChange={(event) => set('unitPrice', event.target.value)}
          error={fieldErrors.unitPriceCents}
        />
        <TextField
          label="Unit size (sq ft)"
          inputMode="numeric"
          value={form.unitSize}
          onChange={(event) => set('unitSize', event.target.value)}
          error={fieldErrors.unitSizeSqFt}
        />
        <TextField
          label="Labour estimate (minutes)"
          inputMode="numeric"
          value={form.minutes}
          onChange={(event) => set('minutes', event.target.value)}
          error={fieldErrors.estimatedMinutes}
        />
        <TextField
          label="Material cost"
          inputMode="decimal"
          value={form.materials}
          onChange={(event) => set('materials', event.target.value)}
          error={fieldErrors.materialCostCents}
        />
      </div>

      <div className="flex flex-wrap gap-4">
        <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
          <input
            type="checkbox"
            checked={form.taxable}
            onChange={(event) => set('taxable', event.target.checked)}
            className="size-4 rounded"
          />
          Charge sales tax
        </label>

        <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
          <input
            type="checkbox"
            checked={form.active}
            onChange={(event) => set('active', event.target.checked)}
            className="size-4 rounded"
          />
          Active
        </label>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="sm" loading={submitting}>
          {isNew ? 'Add service' : 'Save'}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel} disabled={submitting}>
          Cancel
        </Button>
        {!isNew ? (
          <Button
            type="button"
            size="sm"
            variant="danger"
            className="ml-auto"
            onClick={() => void remove()}
            disabled={submitting}
          >
            Delete
          </Button>
        ) : null}
      </div>

      <p className="text-xs text-slate-500 dark:text-slate-400">
        Prices are in {currency}. Every figure here can be overridden on an individual quote.
      </p>
    </form>
  );
}
