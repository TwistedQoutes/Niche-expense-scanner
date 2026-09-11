import bcrypt from 'bcryptjs';

/**
 * bcrypt cost factor. 12 is a reasonable 2020s default: ~250ms per hash on
 * commodity hardware, which is slow enough to make offline cracking expensive
 * and fast enough that login latency stays invisible.
 */
const COST = 12;

/**
 * A pre-computed hash used to burn the same CPU time when an email does not
 * exist, so response timing does not reveal which accounts are registered.
 */
const DUMMY_HASH = '$2a$12$C6UzMDM.H6dfI/f/IKcEe.iyKpBNJ0/S3f0a4Zg1LTfAbG5wKZVom';

export function hashPassword(plaintext: string): Promise<string> {
  return bcrypt.hash(plaintext, COST);
}

export function verifyPassword(plaintext: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plaintext, hash);
}

/** Equalises timing for the "no such user" branch of a login. */
export async function burnPasswordTiming(plaintext: string): Promise<void> {
  await bcrypt.compare(plaintext, DUMMY_HASH);
}
