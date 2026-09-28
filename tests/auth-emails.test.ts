import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * What the account emails say, and to whom.
 *
 * The end-to-end suite runs with no email provider, so the email half of a
 * teammate reset is checked here: that it goes to the teammate's own address,
 * says who sent it and from which business, and carries a working reset link.
 */

const sent: { to: string; subject: string; text: string }[] = [];

vi.mock('@/lib/email', () => ({
  sendEmail: vi.fn(async (message: { to: string; subject: string; text: string }) => {
    sent.push(message);
    return { delivered: true, driver: 'test' };
  }),
  emailEnabled: () => true,
}));

vi.mock('@/lib/auth/tokens', () => ({
  issueToken: vi.fn(async () => ({ token: 'tok_abc/123', expiresAt: new Date('2026-09-28T13:00:00Z') })),
}));

const { issuePasswordResetLink, sendPasswordResetEmail, sendVerificationEmail } = await import(
  '@/lib/auth/emails'
);

beforeEach(() => {
  sent.length = 0;
});

describe('a password reset sent by an owner', () => {
  it('goes to the teammate, names who sent it and for which business', async () => {
    await sendPasswordResetEmail('user_1', 'sam@crew.test', {
      name: 'Dana Owner',
      organizationName: 'Green Acres Lawn',
    });

    expect(sent).toHaveLength(1);
    expect(sent[0]!.to).toBe('sam@crew.test');
    expect(sent[0]!.text).toContain('Dana Owner at Green Acres Lawn sent you a link');
    expect(sent[0]!.text).toContain('/reset-password?token=tok_abc%2F123');
    expect(sent[0]!.text).toContain('signs you out on every device');
  });

  it('keeps the self-service wording when nobody else asked', async () => {
    await sendPasswordResetEmail('user_1', 'sam@crew.test');
    expect(sent[0]!.text).toContain('Someone asked to reset the password for this email address.');
  });
});

describe('a reset link handed to the owner', () => {
  it('is an absolute URL with the token encoded', async () => {
    const { link } = await issuePasswordResetLink('user_1');
    expect(link).toMatch(/^https?:\/\/.+\/reset-password\?token=tok_abc%2F123$/);
    expect(sent).toHaveLength(0);
  });
});

describe('the confirmation email', () => {
  it('says what confirming does, and no more', async () => {
    await sendVerificationEmail('user_1', 'owner@business.test');
    const text = sent[0]!.text;
    expect(text).toContain('/verify-email?token=');
    // Neither of these depends on confirming, so neither is promised.
    expect(text).not.toMatch(/recover this account/i);
    expect(text).not.toMatch(/reply to/i);
  });
});
