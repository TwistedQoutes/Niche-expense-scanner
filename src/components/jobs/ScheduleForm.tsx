'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { SelectField, TextField } from '@/components/ui/Field';
import { useToast } from '@/components/ui/Toast';
import { ApiError, apiRequest } from '@/lib/api-client';

/**
 * Putting a job in the diary.
 *
 * The date and time are sent as the business's own wall clock — `2026-09-14` and
 * `09:00` — never as an instant. A browser in another timezone converting them
 * first is how a 9am job ends up booked at 4am, so the conversion is the server's
 * alone.
 *
 * A clash does not block: the API refuses once, says what it collided with, and
 * this offers to book it anyway. Two crews with a van each is a real thing, and
 * only the owner knows whether this is that or a mistake.
 */
export function ScheduleForm({
  jobId,
  defaultDate,
  defaultTime,
  defaultDurationMinutes,
  teammates,
  assignedUserId,
  rescheduling,
}: {
  jobId: string;
  defaultDate: string;
  defaultTime: string;
  defaultDurationMinutes: number;
  teammates: { id: string; name: string | null }[];
  assignedUserId: string | null;
  rescheduling: boolean;
}) {
  const router = useRouter();
  const toast = useToast();

  const [date, setDate] = useState(defaultDate);
  const [time, setTime] = useState(defaultTime);
  const [durationMinutes, setDurationMinutes] = useState(String(defaultDurationMinutes));
  const [assignee, setAssignee] = useState(assignedUserId ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [clash, setClash] = useState<string | null>(null);

  async function book(allowConflict: boolean) {
    if (saving) return;

    setSaving(true);
    setError(null);

    try {
      await apiRequest(`/api/jobs/${jobId}/schedule`, {
        method: 'POST',
        body: {
          date,
          time,
          durationMinutes: Number(durationMinutes),
          assignedUserId: assignee === '' ? null : assignee,
          allowConflict,
        },
      });

      setClash(null);
      toast.success(rescheduling ? 'Job moved.' : 'Job booked in.');
      router.refresh();
    } catch (caught) {
      if (caught instanceof ApiError && caught.code === 'conflict') {
        // Not an error to fix — a decision to confirm.
        setClash(caught.message);
      } else {
        setError(caught instanceof ApiError ? caught.message : 'Could not book that.');
        toast.error('Not booked.');
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void book(false);
      }}
      className="space-y-3"
    >
      {error ? <Alert tone="error">{error}</Alert> : null}

      {clash ? (
        <Alert tone="warning" title="That time is already taken">
          <p>{clash}</p>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            className="mt-2"
            loading={saving}
            onClick={() => void book(true)}
          >
            Book it anyway
          </Button>
        </Alert>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2">
        <TextField
          label="Date"
          type="date"
          required
          value={date}
          onChange={(event) => {
            setDate(event.target.value);
            setClash(null);
          }}
        />
        <TextField
          label="Start time"
          type="time"
          required
          value={time}
          onChange={(event) => {
            setTime(event.target.value);
            setClash(null);
          }}
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <SelectField
          label="How long"
          value={durationMinutes}
          onChange={(event) => {
            setDurationMinutes(event.target.value);
            setClash(null);
          }}
        >
          <option value="30">30 minutes</option>
          <option value="45">45 minutes</option>
          <option value="60">1 hour</option>
          <option value="90">1.5 hours</option>
          <option value="120">2 hours</option>
          <option value="180">3 hours</option>
          <option value="240">4 hours</option>
          <option value="480">All day</option>
        </SelectField>

        <SelectField
          label="Who is going"
          value={assignee}
          onChange={(event) => {
            setAssignee(event.target.value);
            setClash(null);
          }}
          hint="Leave unassigned to reserve the slot itself."
        >
          <option value="">Unassigned</option>
          {teammates.map((teammate) => (
            <option key={teammate.id} value={teammate.id}>
              {teammate.name ?? 'Teammate'}
            </option>
          ))}
        </SelectField>
      </div>

      <Button type="submit" loading={saving}>
        {rescheduling ? 'Move the job' : 'Book it in'}
      </Button>
    </form>
  );
}
