import { AppointmentStatus, JobStatus } from '@prisma/client';
import { z } from 'zod';

import {
  centsSchema,
  dateOnlySchema,
  idSchema,
  multiLineText,
  singleLineText,
} from '@/lib/validation/common';

/**
 * Scheduling input.
 *
 * Times arrive as a **date plus a time of day**, not as an ISO instant, because
 * the business means a wall-clock time in its own timezone. Converting them is
 * the server's job (`parseLocalDateTime`), so a browser in another zone cannot
 * shift a booking by sending its own idea of the same moment.
 */

const timeOfDaySchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use the time picker to choose a time.');

/**
 * How long a visit takes.
 *
 * Capped at a working day: a typo of 4800 for 480 would otherwise block a crew's
 * calendar for weeks and read as a bug in the calendar rather than in the number.
 */
const durationMinutesSchema = z
  .number()
  .int('Use a whole number of minutes.')
  .min(5, 'A visit needs at least five minutes.')
  .max(12 * 60, 'Longer than a working day — split it into two visits.');

/**
 * The fields a visit has, with **no defaults**.
 *
 * Defaults live on the create schema alone. `.partial()` does not strip a
 * `.default()`, so a base carrying them would make an empty PATCH body parse to
 * `{ durationMinutes: 60 }` — and an update that sets a duration nobody asked for
 * silently resizes the appointment. A caller sending `{}` must come out of
 * validation with `{}`.
 */
const appointmentFieldsSchema = z.object({
  title: singleLineText(160, 'That title is too long.').pipe(
    z.string().min(2, 'What is this visit for?'),
  ),
  date: dateOnlySchema,
  time: timeOfDaySchema,
  durationMinutes: durationMinutesSchema,
  customerId: idSchema.optional(),
  jobId: idSchema.optional(),
  serviceId: idSchema.optional(),
  addressLine1: singleLineText(200).optional(),
  city: singleLineText(80).optional(),
  state: singleLineText(40).optional(),
  postalCode: singleLineText(12).optional(),
  estimatedRevenueCents: centsSchema.optional(),
  notes: multiLineText(2000).optional(),
  /**
   * Book it anyway, over a clash.
   *
   * Explicit rather than a silent allow: a double-booking is sometimes real (two
   * crews, one van each) and sometimes a mistake, and only the owner knows which.
   * The API refuses the first attempt and names what it collided with.
   */
  allowConflict: z.boolean(),
});

export const createAppointmentSchema = appointmentFieldsSchema.extend({
  durationMinutes: durationMinutesSchema.default(60),
  allowConflict: z.boolean().default(false),
});

export const updateAppointmentSchema = appointmentFieldsSchema
  .partial()
  .extend({ status: z.nativeEnum(AppointmentStatus).optional() })
  .refine((value) => Object.keys(value).length > 0, 'Nothing to change.')
  .refine(
    (value) => (value.date === undefined) === (value.time === undefined),
    'Change the date and the time together.',
  );

export const createJobSchema = z.object({
  customerId: idSchema,
  title: singleLineText(160, 'That title is too long.').pipe(
    z.string().min(2, 'What is the job?'),
  ),
  description: multiLineText(4000).optional(),
  serviceId: idSchema.optional(),
  propertyId: idSchema.optional(),
  quoteId: idSchema.optional(),
  priceCents: centsSchema.default(0),
  notes: multiLineText(4000).optional(),
});

export const updateJobSchema = z
  .object({
    title: singleLineText(160).pipe(z.string().min(2, 'What is the job?')),
    description: multiLineText(4000),
    priceCents: centsSchema,
    assignedUserId: idSchema.nullable(),
    notes: multiLineText(4000),
  })
  .partial()
  .refine((value) => Object.keys(value).length > 0, 'Nothing to change.');

/**
 * Putting a job on the calendar.
 *
 * One call books the visit and stamps the job, because the two going out of step —
 * a job that says Tuesday and an appointment that says Wednesday — is the kind of
 * inconsistency a crew discovers at a customer's gate.
 */
export const scheduleJobSchema = z.object({
  date: dateOnlySchema,
  time: timeOfDaySchema,
  durationMinutes: durationMinutesSchema.default(60),
  assignedUserId: idSchema.nullable().optional(),
  allowConflict: z.boolean().default(false),
});

export const completeJobSchema = z.object({
  completionNotes: multiLineText(4000).optional(),
  /**
   * What the job actually came to.
   *
   * A lawn that turned out to be twice the size is a different price from the one
   * quoted, and lifetime value has to reflect what was charged rather than what
   * was estimated. Omitted means the agreed price stands.
   */
  finalPriceCents: centsSchema.optional(),
  /** Days until this customer is due again, for the reactivation sequence. */
  nextServiceDays: z
    .number()
    .int('Use a whole number of days.')
    .min(1, 'At least a day.')
    .max(365 * 2, 'More than two years out is not a reminder.')
    .optional(),
});

export const cancelJobSchema = z.object({
  reason: singleLineText(300, 'Keep the reason short.').optional(),
});

export const jobStatusQuerySchema = z.object({
  status: z.nativeEnum(JobStatus).optional(),
  customerId: idSchema.optional(),
  cursor: idSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

/** The calendar's range: a week by default, or a single day. */
export const calendarQuerySchema = z.object({
  date: dateOnlySchema.optional(),
  view: z.enum(['day', 'week']).default('week'),
});
