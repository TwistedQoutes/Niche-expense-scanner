'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { Button } from '@/components/ui/Button';
import { SelectField, TextAreaField, TextField } from '@/components/ui/Field';
import { useToast } from '@/components/ui/Toast';
import { ApiError, apiRequest } from '@/lib/api-client';
import { parseAmountToCents } from '@/lib/money';

/**
 * Turning a lead into a quote.
 *
 * Deliberately short. The pricing already lives in the service catalogue, so the
 * only things this asks for are the two that vary per job — which service and how
 * big the property is — plus anything the owner wants to say about it. Everything
 * else is looked up server-side, which is also why a price cannot be posted from
 * here: the client sends quantities, the server decides what they cost.
 */
export function QuoteFromLead({
  leadId,
  customerId,
  services,
  defaultTitle,
}: {
  leadId: string;
  customerId: string | null;
  services: { id: string; name: string; unitSizeSqFt: number }[];
  defaultTitle: string | null;
}) {
  const router = useRouter();
  const toast = useToast();

  const [open, setOpen] = useState(false);
  const [serviceId, setServiceId] = useState(services[0]?.id ?? '');
  const [areaSqFt, setAreaSqFt] = useState('');
  const [override, setOverride] = useState('');
  const [summary, setSummary] = useState('');
  const [submitting, setSubmitting] = useState(false);

  if (services.length === 0) {
    return (
      <p className="text-sm text-slate-500 dark:text-slate-400">
        Add a service on the Pricing screen first, then you can quote from here.
      </p>
    );
  }

  if (!open) {
    return (
      <Button variant="secondary" fullWidth onClick={() => setOpen(true)}>
        Create a quote
      </Button>
    );
  }

  async function create() {
    if (submitting) return;
    setSubmitting(true);

    const area = areaSqFt.trim() === '' ? undefined : Number.parseInt(areaSqFt, 10);
    const overrideCents = override.trim() === '' ? null : parseAmountToCents(override);

    if (override.trim() !== '' && overrideCents === null) {
      toast.error('Enter a price like 250 or 250.00.');
      setSubmitting(false);
      return;
    }

    try {
      const result = await apiRequest<{ quote: { id: string } }>('/api/quotes', {
        method: 'POST',
        body: {
          leadId,
          customerId,
          title: defaultTitle,
          summary: summary.trim() || undefined,
          pricing: {
            serviceId,
            ...(Number.isFinite(area) ? { areaSqFt: area } : {}),
            ...(overrideCents === null ? {} : { overridePriceCents: overrideCents }),
          },
        },
      });

      toast.success('Quote drafted.');
      router.push(`/quotes/${result.quote.id}`);
      router.refresh();
    } catch (error) {
      setSubmitting(false);
      toast.error(error instanceof ApiError ? error.message : 'Could not create that quote.');
    }
  }

  const selected = services.find((service) => service.id === serviceId);

  return (
    <div className="space-y-4">
      <SelectField
        label="Service"
        value={serviceId}
        onChange={(event) => setServiceId(event.target.value)}
      >
        {services.map((service) => (
          <option key={service.id} value={service.id}>
            {service.name}
          </option>
        ))}
      </SelectField>

      <TextField
        label="Property size (sq ft)"
        inputMode="numeric"
        placeholder="3000"
        hint={
          selected
            ? `Charged per ${selected.unitSizeSqFt.toLocaleString()} sq ft beyond the first`
            : undefined
        }
        value={areaSqFt}
        onChange={(event) => setAreaSqFt(event.target.value)}
      />

      <TextField
        label="Override the price"
        inputMode="decimal"
        placeholder="Leave blank to use your calculated price"
        value={override}
        onChange={(event) => setOverride(event.target.value)}
      />

      <TextAreaField
        label="What the customer will read"
        rows={3}
        placeholder="Mow, trim and edge the front and back, with clippings removed."
        value={summary}
        onChange={(event) => setSummary(event.target.value)}
      />

      <div className="flex flex-wrap gap-2">
        <Button size="sm" loading={submitting} onClick={() => void create()}>
          Draft the quote
        </Button>
        <Button size="sm" variant="ghost" disabled={submitting} onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
