import { DevicePlatform } from '@prisma/client';
import { z } from 'zod';

/**
 * What a phone may tell the server about itself.
 *
 * The token is the only thing that matters and the only thing accepted. No
 * device name, no model, no OS version: none of it would change what the server
 * does, and a device inventory is a thing to defend rather than an asset.
 */

/**
 * FCM registration tokens are opaque and have grown over the years — the old
 * ones were about 150 characters, current ones run past 160, and Google has
 * never promised a length. The bound exists to stop an unbounded string
 * reaching the database, not to validate the format, so it is generous.
 */
export const registerDeviceSchema = z.object({
  token: z
    .string()
    .trim()
    .min(32, 'That does not look like a push token.')
    .max(512, 'That push token is too long.')
    // Printable ASCII without whitespace. FCM tokens are URL-safe base64 with
    // separators; this rejects control characters and anything multi-line
    // before it is ever concatenated into a request to Google.
    .regex(/^[A-Za-z0-9_:.~+/=-]+$/, 'That does not look like a push token.'),
  platform: z.enum([DevicePlatform.IOS, DevicePlatform.ANDROID]),
});

export const forgetDeviceSchema = z.object({
  token: z.string().trim().min(1).max(512),
});

export type RegisterDeviceInput = z.infer<typeof registerDeviceSchema>;
