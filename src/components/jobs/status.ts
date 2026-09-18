import { AppointmentStatus, JobStatus } from '@prisma/client';

import type { BadgeTone } from '@/components/ui/Badge';

/**
 * How a job's state reads to an owner.
 *
 * Kept beside the tones rather than inline in each screen so the jobs list, the
 * job detail and the calendar cannot drift into describing the same state three
 * different ways.
 */
export const JOB_STATUS_LABEL: Record<JobStatus, string> = {
  [JobStatus.SCHEDULED]: 'Needs a date',
  [JobStatus.CONFIRMED]: 'Booked',
  [JobStatus.IN_PROGRESS]: 'On site',
  [JobStatus.COMPLETED]: 'Done',
  [JobStatus.CANCELLED]: 'Cancelled',
};

export const JOB_STATUS_TONE: Record<JobStatus, BadgeTone> = {
  // Amber: it is waiting on the owner to do something.
  [JobStatus.SCHEDULED]: 'pending',
  [JobStatus.CONFIRMED]: 'info',
  [JobStatus.IN_PROGRESS]: 'active',
  [JobStatus.COMPLETED]: 'success',
  [JobStatus.CANCELLED]: 'danger',
};

/** The order the tabs appear in: the work an owner acts on first comes first. */
export const JOB_STATUS_ORDER: JobStatus[] = [
  JobStatus.SCHEDULED,
  JobStatus.CONFIRMED,
  JobStatus.IN_PROGRESS,
  JobStatus.COMPLETED,
  JobStatus.CANCELLED,
];

export const APPOINTMENT_STATUS_LABEL: Record<AppointmentStatus, string> = {
  [AppointmentStatus.SCHEDULED]: 'Scheduled',
  [AppointmentStatus.CONFIRMED]: 'Confirmed',
  [AppointmentStatus.COMPLETED]: 'Completed',
  [AppointmentStatus.CANCELLED]: 'Cancelled',
  [AppointmentStatus.NO_SHOW]: 'No show',
};

export const APPOINTMENT_STATUS_TONE: Record<AppointmentStatus, BadgeTone> = {
  [AppointmentStatus.SCHEDULED]: 'info',
  [AppointmentStatus.CONFIRMED]: 'active',
  [AppointmentStatus.COMPLETED]: 'success',
  [AppointmentStatus.CANCELLED]: 'danger',
  [AppointmentStatus.NO_SHOW]: 'urgent',
};
