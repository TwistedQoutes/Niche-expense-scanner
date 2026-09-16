'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { AddressAutocomplete } from '@/components/maps/AddressAutocomplete';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { SelectField, TextField } from '@/components/ui/Field';
import { useToast } from '@/components/ui/Toast';
import { ApiError, apiRequest } from '@/lib/api-client';

/**
 * The business's own details.
 *
 * Two fields here are not cosmetic and are labelled as such:
 *
 *  - **Timezone** decides what "9am" means on every booking. Getting it wrong puts
 *    the crew at the wrong hour.
 *  - **Review link** is where a review request sends the customer. Without it the
 *    review automation has nowhere to point and skips silently, which looks like
 *    a broken feature rather than an unset field.
 */

/**
 * A short list rather than the full IANA set.
 *
 * Six hundred zone names in a dropdown is not a choice anybody can make. These
 * cover the continental US and the places a first customer is likely to be; the
 * API accepts any zone the runtime knows, so nothing is locked out.
 */
const COMMON_TIMEZONES = [
  ['America/New_York', 'Eastern — New York'],
  ['America/Chicago', 'Central — Chicago'],
  ['America/Denver', 'Mountain — Denver'],
  ['America/Phoenix', 'Arizona — no daylight saving'],
  ['America/Los_Angeles', 'Pacific — Los Angeles'],
  ['America/Anchorage', 'Alaska — Anchorage'],
  ['Pacific/Honolulu', 'Hawaii — Honolulu'],
  ['America/Toronto', 'Eastern — Toronto'],
  ['America/Vancouver', 'Pacific — Vancouver'],
  ['Europe/London', 'UK — London'],
] as const;

export type SettingsValues = {
  name: string;
  ownerName: string;
  email: string;
  phone: string;
  website: string;
  reviewUrl: string;
  addressLine1: string;
  city: string;
  state: string;
  postalCode: string;
  timezone: string;
};

export function SettingsForm({
  initial,
  canEdit,
  mapsEnabled = false,
}: {
  initial: SettingsValues;
  canEdit: boolean;
  /** Whether this deployment can suggest addresses. */
  mapsEnabled?: boolean;
}) {
  const router = useRouter();
  const toast = useToast();

  const [values, setValues] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  function set<K extends keyof SettingsValues>(key: K, value: SettingsValues[K]) {
    setValues((current) => ({ ...current, [key]: value }));
    setFieldErrors((current) => {
      if (!(key in current)) return current;
      const next = { ...current };
      delete next[key as string];
      return next;
    });
  }

  // Included even when a zone is not on the short list, so opening this form and
  // saving cannot silently move the business to Eastern.
  const zoneOptions = COMMON_TIMEZONES.some(([zone]) => zone === values.timezone)
    ? COMMON_TIMEZONES
    : ([[values.timezone, values.timezone], ...COMMON_TIMEZONES] as const);

  async function save() {
    if (saving || !canEdit) return;

    setSaving(true);
    setError(null);
    setFieldErrors({});

    try {
      await apiRequest('/api/settings', { method: 'PATCH', body: values });
      toast.success('Settings saved.');
      router.refresh();
    } catch (caught) {
      if (caught instanceof ApiError) {
        setError(caught.message);
        setFieldErrors(caught.fieldErrors);
      } else {
        setError('Could not save those settings.');
      }
      toast.error('Nothing saved.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
      className="space-y-6"
    >
      {error ? <Alert tone="error">{error}</Alert> : null}

      <section className="space-y-3">
        <h2 className="text-sm font-medium text-slate-900 dark:text-slate-100">The business</h2>

        <div className="grid gap-3 sm:grid-cols-2">
          <TextField
            label="Business name"
            value={values.name}
            disabled={!canEdit}
            error={fieldErrors.name}
            onChange={(event) => set('name', event.target.value)}
          />
          <TextField
            label="Your name"
            value={values.ownerName}
            disabled={!canEdit}
            error={fieldErrors.ownerName}
            onChange={(event) => set('ownerName', event.target.value)}
          />
          <TextField
            label="Phone"
            value={values.phone}
            disabled={!canEdit}
            error={fieldErrors.phone}
            hint="Inbound texts and missed calls are matched to this number."
            onChange={(event) => set('phone', event.target.value)}
          />
          <TextField
            label="Email"
            type="email"
            value={values.email}
            disabled={!canEdit}
            error={fieldErrors.email}
            onChange={(event) => set('email', event.target.value)}
          />
          <TextField
            label="Website"
            value={values.website}
            disabled={!canEdit}
            error={fieldErrors.website}
            onChange={(event) => set('website', event.target.value)}
          />
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-medium text-slate-900 dark:text-slate-100">Where you work</h2>

        <div className="grid gap-3 sm:grid-cols-2">
          <AddressAutocomplete
            label="Address"
            // Read-only members see the address; they do not get to look up a
            // new one, which would spend the workspace's Maps quota.
            enabled={mapsEnabled && canEdit}
            disabled={!canEdit}
            value={values.addressLine1}
            error={fieldErrors.addressLine1}
            onChange={(value) => set('addressLine1', value)}
            onResolved={(address) => {
              // Through `set`, not straight into state: it is also what clears
              // the "this field is wrong" message the server last sent.
              if (address.addressLine1) set('addressLine1', address.addressLine1);
              if (address.city) set('city', address.city);
              if (address.state) set('state', address.state);
              if (address.postalCode) set('postalCode', address.postalCode);
            }}
          />
          <TextField
            label="Town or city"
            value={values.city}
            disabled={!canEdit}
            error={fieldErrors.city}
            onChange={(event) => set('city', event.target.value)}
          />
          <TextField
            label="State"
            value={values.state}
            disabled={!canEdit}
            error={fieldErrors.state}
            onChange={(event) => set('state', event.target.value)}
          />
          <TextField
            label="Postal code"
            value={values.postalCode}
            disabled={!canEdit}
            error={fieldErrors.postalCode}
            onChange={(event) => set('postalCode', event.target.value)}
          />
        </div>

        <SelectField
          label="Timezone"
          value={values.timezone}
          disabled={!canEdit}
          error={fieldErrors.timezone}
          hint="Every booking is in this timezone. Getting it wrong puts the crew at the wrong hour."
          onChange={(event) => set('timezone', event.target.value)}
        >
          {zoneOptions.map(([zone, label]) => (
            <option key={zone} value={zone}>
              {label}
            </option>
          ))}
        </SelectField>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-medium text-slate-900 dark:text-slate-100">Reviews</h2>

        <TextField
          label="Review link"
          value={values.reviewUrl}
          disabled={!canEdit}
          error={fieldErrors.reviewUrl}
          placeholder="https://g.page/r/..."
          hint="Where a review request sends the customer. Until this is set, review requests are skipped rather than sent with a dead link."
          onChange={(event) => set('reviewUrl', event.target.value)}
        />
      </section>

      {canEdit ? (
        <Button type="submit" loading={saving}>
          Save settings
        </Button>
      ) : (
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Only an owner or admin can change these.
        </p>
      )}
    </form>
  );
}
