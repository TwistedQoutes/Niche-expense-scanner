import type { Metadata } from 'next';

import { ContactEmail, Disclaimer, LAST_UPDATED, Section } from '@/components/legal/Section';

export const metadata: Metadata = { title: 'Terms of Service' };

/**
 * Terms of Service.
 *
 * A plain-language starting point, not a substitute for a lawyer. It is written
 * to be honest about the two things that actually create risk for this product:
 * it is not a tax adviser, and the OCR is not guaranteed to be right.
 */
export default function TermsPage() {
  return (
    <>
      <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
        Terms of Service
      </h1>
      <p className="text-sm text-zinc-500 dark:text-zinc-400">
        Last updated {LAST_UPDATED}
      </p>

      <Section title="1. What this service is">
        Niche Expense Scanner is a tool for recording business expenses. You photograph a receipt,
        the text is read on your own device, and the result is saved to your account and
        categorised. That is the whole of what we provide.
      </Section>

      <Section title="2. It is not tax advice">
        The categories we suggest, including the IRS Schedule&nbsp;C lines shown in exports, are
        general information to save you time. They are <strong>not</strong> tax, accounting or
        legal advice, and we are not your accountant. Whether a particular expense is deductible,
        and on which line it belongs, depends on facts we do not know. Check anything that matters
        with a qualified professional before filing.
      </Section>

      <Section title="3. Accuracy is your responsibility">
        Text recognition is automated and imperfect: totals, dates and merchant names can be read
        wrongly, especially from faded or creased receipts. That is why every scanned value is
        shown to you in an editable form before it is saved. <strong>You are responsible for
        checking that what is saved matches your receipt.</strong> We do not warrant that
        extracted data is accurate or complete.
      </Section>

      <Section title="4. Your account">
        You need an accurate email address, you are responsible for keeping your password secret,
        and you are responsible for activity under your account. Tell us promptly if you think
        someone else has access. You must be old enough to enter a contract where you live, and you
        may not use the service for anything unlawful, or attempt to break, overload or reverse
        engineer it.
      </Section>

      <Section title="5. Your data belongs to you">
        You keep all rights to the expenses, receipts and images you put into the service. We store
        and process them only to provide the service to you. You can export everything at any time
        from Settings, and deleting your account removes it. We do not sell your data, and we do
        not use it to train machine-learning models.
      </Section>

      <Section title="6. Subscriptions, trials and refunds">
        New accounts get a free trial. After it ends you can still view, edit, export and delete
        everything you have already recorded — we will never lock you out of your own records — but
        recording new expenses requires an active subscription.
        <br />
        <br />
        Subscriptions renew automatically until cancelled. You can cancel any time from the billing
        portal in Settings, without contacting us; access continues to the end of the period you
        have paid for. Payments are handled by Stripe, and we never see your card details. If
        something has gone wrong, email us and we will deal with it fairly.
      </Section>

      <Section title="7. Availability">
        We will make reasonable efforts to keep the service running, but it is provided &ldquo;as
        is&rdquo; and we do not promise uninterrupted or error-free operation. We may change or
        discontinue features. If we discontinue the service entirely, we will give you reasonable
        notice and time to export your data.
      </Section>

      <Section title="8. Limits on our liability">
        To the fullest extent the law allows, we are not liable for indirect or consequential loss,
        or for lost profits, revenue or data. Our total liability for any claim is limited to the
        greater of the amount you paid us in the twelve months before the claim, or twenty US
        dollars. Nothing here limits liability that cannot lawfully be limited.
      </Section>

      <Section title="9. Ending the agreement">
        You may stop using the service and delete your account at any time. We may suspend or end
        your account if you materially breach these terms, or if we are required to by law. On
        termination your right to use the service ends; your export rights up to that point do not.
      </Section>

      <Section title="10. Changes to these terms">
        We may update these terms. If a change materially reduces your rights, we will tell you by
        email before it takes effect. Continuing to use the service after that means you accept the
        change.
      </Section>

      <Section title="11. Contact">
        Questions about these terms: <ContactEmail />
      </Section>

      <Disclaimer />
    </>
  );
}
