import { Role } from '@prisma/client';
import { describe, expect, it } from 'vitest';

import { outranks } from '@/lib/auth/context';
import { seatLimitFor } from '@/lib/billing/plans';
import { createInviteSchema, inviteRoleSchema } from '@/lib/validation/team';

/**
 * The privilege model for managing people, and the seat limit that governs it.
 *
 * These are pure functions and schemas, tested directly. The database-touching
 * half of `src/lib/team/repository.ts` is exercised end-to-end instead (see
 * tests/e2e/team-invites.spec.ts), because what matters there — that an admin
 * cannot mint another admin through the API, that a full plan refuses — is a
 * property of the running route and not of a mock.
 */

describe('outranks', () => {
  it('lets each role act on everyone below it', () => {
    expect(outranks(Role.OWNER, Role.ADMIN)).toBe(true);
    expect(outranks(Role.OWNER, Role.STAFF)).toBe(true);
    expect(outranks(Role.ADMIN, Role.STAFF)).toBe(true);
  });

  it('refuses at the actor’s own level', () => {
    /*
     * The case the whole rule exists for. If an ADMIN could act on an ADMIN, one
     * compromised admin account could quietly reshape who else has access —
     * removing the peer who would have noticed, and adding one who will not.
     */
    expect(outranks(Role.ADMIN, Role.ADMIN)).toBe(false);
    expect(outranks(Role.OWNER, Role.OWNER)).toBe(false);
    expect(outranks(Role.STAFF, Role.STAFF)).toBe(false);
  });

  it('refuses upwards, which is the escalation it prevents', () => {
    expect(outranks(Role.STAFF, Role.ADMIN)).toBe(false);
    expect(outranks(Role.STAFF, Role.OWNER)).toBe(false);
    expect(outranks(Role.ADMIN, Role.OWNER)).toBe(false);
  });

  it('covers every pair of roles, so a new role cannot slip through untested', () => {
    const roles = Object.values(Role);
    expect(roles).toHaveLength(3);

    // Rank is a total order, so exactly one direction of each distinct pair holds.
    for (const a of roles) {
      for (const b of roles) {
        if (a === b) {
          expect(outranks(a, b)).toBe(false);
        } else {
          expect(outranks(a, b)).toBe(!outranks(b, a));
        }
      }
    }
  });
});

describe('the invite role schema', () => {
  it('accepts the two roles that can be handed out', () => {
    expect(inviteRoleSchema.parse(Role.ADMIN)).toBe(Role.ADMIN);
    expect(inviteRoleSchema.parse(Role.STAFF)).toBe(Role.STAFF);
  });

  it('refuses OWNER, because ownership is transferred and not granted', () => {
    // Belt as well as braces: the rank check would refuse this too, since nobody
    // outranks an owner. Keeping it out of the schema makes the answer "that is
    // not a role you can invite" rather than "you are not allowed".
    expect(inviteRoleSchema.safeParse(Role.OWNER).success).toBe(false);
  });

  it('defaults to crew rather than to the most powerful option', () => {
    const parsed = createInviteSchema.parse({ email: 'sam@example.test' });
    expect(parsed.role).toBe(Role.STAFF);
  });

  it('lower-cases the address, so one person cannot hold two seats', () => {
    const parsed = createInviteSchema.parse({ email: 'Sam.Okafor@Example.Test' });
    expect(parsed.email).toBe('sam.okafor@example.test');
  });

  it('refuses a malformed address before it reaches an email provider', () => {
    for (const email of ['', 'sam', 'sam@', '@example.test', 'sam@example', 'a b@example.test']) {
      expect(createInviteSchema.safeParse({ email }).success, email).toBe(false);
    }
  });
});

describe('seat limits', () => {
  it('gives every plan a seat count, with only Business unlimited', () => {
    expect(seatLimitFor('FREE')).toBe(1);
    expect(seatLimitFor('STARTER')).toBe(2);
    expect(seatLimitFor('PRO')).toBe(5);
    expect(seatLimitFor('BUSINESS')).toBeNull();
  });

  it('starts at one, so the free plan is the owner and nobody else', () => {
    // A free workspace that can invite is a free workspace that can run a crew,
    // and the seat count is the only thing standing between those two.
    expect(seatLimitFor('FREE')).toBe(1);
  });
});
