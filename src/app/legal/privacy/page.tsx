import type { Metadata } from 'next';

import { ContactEmail, Disclaimer, LAST_UPDATED, Section } from '@/components/legal/Section';

export const metadata: Metadata = { title: 'Privacy Policy' };

/**
 * Privacy Policy.
 *
 * Written to describe what this codebase actually does, which is the only way a
 * privacy policy is worth anything. Two points are easy to get wrong and are
 * called out explicitly: text recognition runs on the device, and a retained
 * receipt image can contain a third party's details.
 */
export default function PrivacyPage() {
  return (
    <>
      <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
        Privacy Policy
      </h1>
      <p className="text-sm text-zinc-500 dark:text-zinc-400">
        Last updated {LAST_UPDATED}
      </p>

      <Section title="The short version">
        We hold your email, your expense records, and — only if you switch it on — photographs of
        your receipts. Reading the text off a receipt happens in your browser, on your own device,
        so the image does not have to be uploaded at all. We do not sell your data, we do not run
        advertising or third-party analytics, and we do not train machine-learning models on your
        receipts.
      </Section>

      <Section title="What we collect">
        <strong>Account details.</strong> Your email address, an optional studio or artist name,
        and a one-way hash of your password. We never store the password itself.
        <br />
        <br />
        <strong>Expense records.</strong> What you saved: merchant, amount, tax, date, currency,
        category, your notes, and the text that was recognised from the receipt.
        <br />
        <br />
        <strong>Receipt images — only if you opt in.</strong> Off by default. When you turn it on
        in Settings, a copy of each receipt photo is stored with the expense. Before it is
        uploaded, the image is re-encoded in your browser, which removes embedded metadata
        including any GPS location your camera recorded.
        <br />
        <br />
        <strong>Billing details.</strong> Handled by Stripe. We store a customer identifier,
        subscription status and renewal date. We never receive or store your card number.
        <br />
        <br />
        <strong>Operational logs.</strong> Ordinary server logs, which include IP addresses, used
        to keep the service running and to rate-limit abuse.
      </Section>

      <Section title="A note about other people on your receipts">
        A receipt photograph can show information that is not about you — a client&rsquo;s name on
        a deposit slip, the last four digits of a card, a delivery address. If you turn on image
        retention, you are asking us to store that too. Please consider whether you need to, and
        that you may have your own obligations to the people concerned. This is a large part of why
        the setting is off unless you deliberately enable it.
      </Section>

      <Section title="Why we are allowed to hold it">
        We process your account and expense data to perform our contract with you — providing the
        service you signed up for. We process billing data to take payment and meet tax and
        accounting obligations. We keep security logs on the basis of our legitimate interest in
        preventing abuse. Where we rely on your consent, as with receipt images, you can withdraw
        it at any time by turning the setting off.
      </Section>

      <Section title="Who else sees it">
        Only the suppliers needed to run the service: our hosting provider, our managed database
        provider, our email provider for account emails such as password resets, and Stripe for
        payments. Each processes data on our instructions. We do not sell or share your data for
        advertising. We will disclose data if the law compels us to, and will tell you unless we
        are prohibited from doing so.
      </Section>

      <Section title="How long we keep it">
        Your records stay while your account exists. Deleting your account deletes your expenses,
        your category lines and any stored receipt images. Password-reset tokens are discarded
        within a day. Billing records are retained by Stripe and by us for as long as tax law
        requires, which is typically several years, even after account deletion.
      </Section>

      <Section title="Your rights">
        You can access and export everything we hold from Settings, as a machine-readable file. You
        can correct any expense directly in the app. You can delete your account, and everything
        in it, from Settings. Depending on where you live you may also have rights to restrict or
        object to processing, or to complain to your data protection regulator. To exercise
        anything not available in the app, email <ContactEmail />.
      </Section>

      <Section title="Security">
        Passwords are hashed with bcrypt. Sessions use signed, http-only cookies and can be
        revoked from every device at once. Receipt images are stored outside the public web root
        and served only to the account that owns them. Traffic is encrypted in transit. No system
        is perfectly secure, and we will tell affected users promptly if a breach occurs that is
        likely to put them at risk.
      </Section>

      <Section title="Children">
        The service is for business use by adults and is not directed at children.
      </Section>

      <Section title="International transfers">
        Our suppliers may process data in countries other than yours, including the United States.
        Where required, transfers are covered by appropriate safeguards such as the European
        Commission&rsquo;s standard contractual clauses.
      </Section>

      <Section title="Changes">
        If we change this policy in a way that materially affects you, we will tell you by email
        before it takes effect.
      </Section>

      <Section title="Contact">
        Privacy questions or requests: <ContactEmail />
      </Section>

      <Disclaimer />
    </>
  );
}
