'use client';

import { LeadSource } from '@prisma/client';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';

import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { SelectField, TextAreaField, TextField } from '@/components/ui/Field';
import { useToast } from '@/components/ui/Toast';
import { ApiError, apiRequest } from '@/lib/api-client';
import { parseAmountToCents } from '@/lib/money';

const SOURCE_LABELS: Record<LeadSource, string> = {
  [LeadSource.WEBSITE]: 'Website',
  [LeadSource.PHONE_CALL]: 'Phone call',
  [LeadSource.MISSED_CALL]: 'Missed call',
  [LeadSource.SMS]: 'Text message',
  [LeadSource.EMAIL]: 'Email',
  [LeadSource.REFERRAL]: 'Referral',
  [LeadSource.GOOGLE]: 'Google',
  [LeadSource.FACEBOOK]: 'Facebook',
  [LeadSource.WALK_IN]: 'Walk-in',
  [LeadSource.REPEAT_CUSTOMER]: 'Repeat customer',
  [LeadSource.MANUAL]: 'Added by hand',
  [LeadSource.OTHER]: 'Other',
};

export function NewLeadForm() {
  const router = useRouter();
  const toast = useToast();

  const [form, setForm] = useState({
    firstName: '',
    lastName: '',
    phone: '',
    email: '',
    addressLine1: '',
    city: '',
    state: '',
    postalCode: '',
    source: LeadSource.PHONE_CALL as LeadSource,
    serviceRequested: '',
    description: '',
    estimatedValue: '',
  });

  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function set<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;

    setSubmitting(true);
    setFieldErrors({});
    setFormError(null);

    // Parsed in the browser so "1,250" or "$1250" become cents before they are
    // sent. The API only ever accepts integer cents — see src/lib/money.ts.
    const estimatedValueCents = form.estimatedValue.trim()
      ? parseAmountToCents(form.estimatedValue)
      : null;

    if (form.estimatedValue.trim() && estimatedValueCents === null) {
      setFieldErrors({ estimatedValue: 'Enter an amount like 250 or 1,250.00.' });
      setSubmitting(false);
      return;
    }

    try {
      const { lead } = await apiRequest<{ lead: { id: string } }>('/api/leads', {
        method: 'POST',
        body: {
          firstName: form.firstName,
          lastName: form.lastName || undefined,
          phone: form.phone || undefined,
          email: form.email || undefined,
          addressLine1: form.addressLine1 || undefined,
          city: form.city || undefined,
          state: form.state || undefined,
          postalCode: form.postalCode || undefined,
          source: form.source,
          serviceRequested: form.serviceRequested || undefined,
          description: form.description || undefined,
          estimatedValueCents,
        },
      });

      toast.success('Lead added.');
      router.replace(`/leads/${lead.id}`);
      router.refresh();
    } catch (error) {
      setSubmitting(false);

      if (error instanceof ApiError) {
        setFieldErrors(error.fieldErrors);
        if (Object.keys(error.fieldErrors).length === 0) setFormError(error.message);
        return;
      }

      setFormError('Something went wrong. Please try again.');
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-5">
      {formError ? <Alert tone="error">{formError}</Alert> : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          label="First name"
          required
          value={form.firstName}
          onChange={(event) => set('firstName', event.target.value)}
          error={fieldErrors.firstName}
        />
        <TextField
          label="Last name"
          value={form.lastName}
          onChange={(event) => set('lastName', event.target.value)}
          error={fieldErrors.lastName}
        />
        <TextField
          label="Phone"
          type="tel"
          inputMode="tel"
          value={form.phone}
          onChange={(event) => set('phone', event.target.value)}
          error={fieldErrors.phone}
        />
        <TextField
          label="Email"
          type="email"
          inputMode="email"
          autoCapitalize="none"
          spellCheck={false}
          value={form.email}
          onChange={(event) => set('email', event.target.value)}
          error={fieldErrors.email}
        />
      </div>

      <p className="text-xs text-slate-500 dark:text-slate-400">
        A phone number or an email is enough to get started — the rest can wait.
      </p>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <TextField
            label="Property address"
            value={form.addressLine1}
            onChange={(event) => set('addressLine1', event.target.value)}
            error={fieldErrors.addressLine1}
          />
        </div>
        <TextField
          label="City"
          value={form.city}
          onChange={(event) => set('city', event.target.value)}
          error={fieldErrors.city}
        />
        <div className="grid grid-cols-2 gap-4">
          <TextField
            label="State"
            value={form.state}
            onChange={(event) => set('state', event.target.value)}
            error={fieldErrors.state}
          />
          <TextField
            label="ZIP"
            inputMode="numeric"
            value={form.postalCode}
            onChange={(event) => set('postalCode', event.target.value)}
            error={fieldErrors.postalCode}
          />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField
          label="Where did they come from?"
          value={form.source}
          onChange={(event) => set('source', event.target.value as LeadSource)}
          error={fieldErrors.source}
        >
          {Object.values(LeadSource).map((source) => (
            <option key={source} value={source}>
              {SOURCE_LABELS[source]}
            </option>
          ))}
        </SelectField>

        <TextField
          label="Service requested"
          placeholder="Lawn mowing"
          value={form.serviceRequested}
          onChange={(event) => set('serviceRequested', event.target.value)}
          error={fieldErrors.serviceRequested}
        />
      </div>

      <TextField
        label="Estimated value"
        inputMode="decimal"
        placeholder="250"
        hint="A rough number is fine. It only feeds the pipeline totals."
        value={form.estimatedValue}
        onChange={(event) => set('estimatedValue', event.target.value)}
        error={fieldErrors.estimatedValue}
      />

      <TextAreaField
        label="What do they need?"
        rows={4}
        value={form.description}
        onChange={(event) => set('description', event.target.value)}
        error={fieldErrors.description}
      />

      <Button type="submit" size="lg" loading={submitting}>
        Add lead
      </Button>
    </form>
  );
}
