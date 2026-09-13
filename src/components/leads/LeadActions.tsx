'use client';

import { LeadStatus } from '@prisma/client';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';

import { Button } from '@/components/ui/Button';
import { TextAreaField } from '@/components/ui/Field';
import { useToast } from '@/components/ui/Toast';
import { ApiError, apiRequest } from '@/lib/api-client';
import { PIPELINE } from '@/lib/leads/pipeline';

/**
 * The three things you do to a lead from its own page: move it, note what
 * happened, or turn it into a customer.
 *
 * Kept together in one client component so the page itself stays a server
 * component and the whole lead record never has to cross the boundary.
 */
export function LeadActions({
  leadId,
  status,
  converted,
}: {
  leadId: string;
  status: LeadStatus;
  converted: boolean;
}) {
  const router = useRouter();
  const toast = useToast();

  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<null | 'status' | 'note' | 'convert'>(null);

  async function changeStatus(next: LeadStatus) {
    if (next === status) return;
    setBusy('status');

    try {
      await apiRequest(`/api/leads/${leadId}/move`, {
        method: 'PATCH',
        body: { status: next },
      });
      toast.success('Stage updated.');
      router.refresh();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'Could not update that.');
    } finally {
      setBusy(null);
    }
  }

  async function addNote(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !note.trim()) return;

    setBusy('note');
    try {
      await apiRequest(`/api/leads/${leadId}/notes`, { method: 'POST', body: { note } });
      setNote('');
      router.refresh();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'Could not save that note.');
    } finally {
      setBusy(null);
    }
  }

  async function convert() {
    setBusy('convert');
    try {
      const result = await apiRequest<{ customerId: string }>(`/api/leads/${leadId}/convert`, {
        method: 'POST',
        body: { createProperty: true },
      });
      toast.success('Converted to a customer.');
      router.push(`/customers/${result.customerId}`);
      router.refresh();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'Could not convert that lead.');
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4">
      <label className="block">
        <span className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300">
          Stage
        </span>
        <select
          value={status}
          disabled={busy !== null}
          onChange={(event) => void changeStatus(event.target.value as LeadStatus)}
          className="w-full rounded-xl bg-white px-3.5 py-2.5 text-base text-slate-900 ring-1 ring-slate-200 disabled:opacity-60 dark:bg-slate-900 dark:text-slate-100 dark:ring-slate-800"
        >
          {PIPELINE.map((column) => (
            <option key={column.status} value={column.status}>
              {column.label}
            </option>
          ))}
        </select>
      </label>

      {converted ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Already converted to a customer.
        </p>
      ) : (
        <Button
          variant="secondary"
          fullWidth
          loading={busy === 'convert'}
          disabled={busy !== null}
          onClick={() => void convert()}
        >
          Convert to customer
        </Button>
      )}

      <form onSubmit={addNote} className="space-y-2">
        <TextAreaField
          label="Add a note"
          rows={3}
          placeholder="Called, no answer. Trying again Thursday."
          value={note}
          onChange={(event) => setNote(event.target.value)}
        />
        <Button
          type="submit"
          size="sm"
          variant="secondary"
          loading={busy === 'note'}
          disabled={busy !== null || note.trim().length === 0}
        >
          Save note
        </Button>
      </form>
    </div>
  );
}
