import { Channel } from '@prisma/client';
import { z } from 'zod';

import { idSchema, multiLineText, singleLineText } from '@/lib/validation/common';
import { MAX_SMS_LENGTH } from '@/lib/sms';

/**
 * A manual reply from the inbox.
 *
 * The SMS length cap is enforced here rather than only at the provider, so an
 * owner is told before they hit send — a message split into four billed segments
 * because a schema let it through is a surprise on an invoice.
 */
export const sendReplySchema = z
  .object({
    body: multiLineText(4000, 'That message is too long.').pipe(
      z.string().min(1, 'Write something first.'),
    ),
    subject: singleLineText(200).optional(),
  })
  .refine((value) => value.body.length > 0, 'Write something first.');

export function replyLengthError(channel: Channel, body: string): string | null {
  if (channel === Channel.SMS && body.length > MAX_SMS_LENGTH) {
    return `Texts are limited to ${MAX_SMS_LENGTH} characters. That one is ${body.length}.`;
  }
  return null;
}

export const updateAutomationSchema = z
  .object({
    enabled: z.boolean(),
    name: singleLineText(120).pipe(z.string().min(2, 'Give the automation a name.')),
  })
  .partial()
  .refine((value) => Object.keys(value).length > 0, 'Nothing to update.');

export const updateAutomationStepSchema = z.object({
  stepId: idSchema,
  /** Delay before this step fires, in minutes. Zero means immediately. */
  delayMinutes: z
    .number()
    .int('Use a whole number of minutes.')
    .min(0, 'A delay cannot be negative.')
    .max(60 * 24 * 365, 'A year is longer than any follow-up should wait.'),
  template: multiLineText(2000, 'That message is too long.').optional(),
  subject: singleLineText(200).optional(),
});

export const listConversationsQuerySchema = z.object({
  archived: z
    .union([z.literal('true'), z.literal('false')])
    .optional()
    .transform((value) => value === 'true'),
  cursor: idSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
