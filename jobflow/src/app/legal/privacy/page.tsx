import type { Metadata } from 'next';

import { ContactEmail, Disclaimer, LAST_UPDATED, Section } from '@/components/legal/Section';

export const metadata: Metadata = {
  title: 'Privacy Policy',
  robots: { index: true, follow: true },
};

export default function PrivacyPage() {
  return (
    <>
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-50">
          Privacy Policy
        </h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Last updated {LAST_UPDATED}
        </p>
      </div>

      <Section title="Two kinds of people are described here">
        <p>
          <strong>You</strong>, the business owner using JobFlow, and <strong>your customers</strong>,
          whose details you put into it. For your data we are the controller. For your customers&rsquo;
          data you are the controller and we are your processor — we hold it to provide the service
          to you, and we do not use it for anything else.
        </p>
      </Section>

      <Section title="What we collect about you">
        <p>
          Your name, email address, phone number and business details; a hash of your password,
          never the password itself; and basic technical records such as IP address and timestamps
          that come with using any website. Payment card details go directly to Stripe and never
          reach our servers.
        </p>
      </Section>

      <Section title="What you put in about your customers">
        <p>
          Names, addresses, phone numbers, email addresses, property details, photographs, quotes,
          jobs and message history. You decide what to enter. Please only enter what you need to do
          the work, and tell your customers you use software to manage it.
        </p>
      </Section>

      <Section title="Who else processes it">
        <p>
          We use a small number of providers, each for one purpose: a managed Postgres host for the
          database, Vercel for hosting, Stripe for payments, Resend for email, Twilio for SMS,
          OpenAI for the AI features, and Google Maps for geocoding addresses. They act on our
          instructions and are not permitted to use the data for their own purposes.
        </p>
      </Section>

      <Section title="What the AI sees">
        <p>
          When you use an AI feature, the relevant lead or message text is sent to OpenAI to produce
          a score, a summary or a draft reply. It is not used to train their models. If you would
          rather no customer data left your workspace this way, the AI features can be switched off
          in Settings and everything else keeps working.
        </p>
      </Section>

      <Section title="How long we keep it">
        <p>
          For as long as your workspace exists. Deleting your workspace deletes your customers,
          leads, quotes, jobs and messages. Backups are cycled out within 30 days, and we keep the
          minimum billing records that tax law requires.
        </p>
      </Section>

      <Section title="Your rights">
        <p>
          You can export your data at any time, correct it in the app, or delete your workspace. If
          you are in the UK or EU you also have the right to object to processing and to complain to
          your data protection authority. If one of your customers asks you to delete their record,
          you can do it yourself — you do not need us.
        </p>
      </Section>

      <Section title="Security">
        <p>
          Data is encrypted in transit. Passwords are hashed with bcrypt. Every business&rsquo;s
          records are separated by a tenant boundary enforced in the data layer rather than by
          convention, and sessions can be revoked everywhere at once from Settings. No system is
          perfect; if we ever have a breach affecting your data we will tell you.
        </p>
      </Section>

      <Section title="Contact">
        <p>
          Questions about any of this go to <ContactEmail />.
        </p>
      </Section>

      <Disclaimer />
    </>
  );
}
