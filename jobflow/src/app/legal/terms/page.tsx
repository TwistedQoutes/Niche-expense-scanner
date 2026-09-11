import type { Metadata } from 'next';

import { ContactEmail, Disclaimer, LAST_UPDATED, Section } from '@/components/legal/Section';

export const metadata: Metadata = {
  title: 'Terms of Service',
  robots: { index: true, follow: true },
};

export default function TermsPage() {
  return (
    <>
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-50">
          Terms of Service
        </h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Last updated {LAST_UPDATED}
        </p>
      </div>

      <Section title="What JobFlow AI is">
        <p>
          JobFlow AI is software for managing leads, quotes and jobs. You use it to run your
          business; we do not perform any of the services you sell, we are not party to the
          agreements you make with your customers, and we are not responsible for the work you
          carry out.
        </p>
      </Section>

      <Section title="Your account">
        <p>
          You are responsible for keeping your password safe and for everything done through your
          account. Tell us promptly if you think someone else has access. You must be old enough to
          enter a contract where you live, and the details you give us during setup must be
          accurate — quotes you send carry them.
        </p>
      </Section>

      <Section title="Your data is yours">
        <p>
          You own the customer records, quotes, jobs and messages you put into JobFlow. We store and
          process them to provide the service to you. You can export them at any time, and deleting
          your workspace deletes them.
        </p>
      </Section>

      <Section title="Pricing and quotes are yours too">
        <p>
          The quote calculator applies the rates, margins and minimums you configure. The numbers it
          produces are estimates based on what you enter — checking that a price is right for a job
          is your judgement, not ours, and we are not liable for a job that turns out to cost more
          than you quoted.
        </p>
      </Section>

      <Section title="What the AI does and does not do">
        <p>
          The AI features summarise leads, score them and draft messages. They can be wrong. They
          will not quote a price you have not configured, make legal or safety claims on your
          behalf, or commit you to a time slot that is not on your calendar — but you should read
          what they write before it goes to a customer, because it goes out under your name.
        </p>
      </Section>

      <Section title="Messaging and consent">
        <p>
          If you send SMS or email through JobFlow, you are the sender. You are responsible for
          having permission to contact those people and for complying with the rules that apply to
          you — in the United States that includes the TCPA and CAN-SPAM, and it means honouring
          opt-outs. We will suspend an account being used to send unsolicited messages.
        </p>
      </Section>

      <Section title="Payment">
        <p>
          Paid plans are billed monthly in advance through Stripe and renew until cancelled. You can
          change or cancel your plan at any time; cancelling stops the next renewal and you keep
          access until the end of the period you have paid for. We do not give partial refunds for
          time already elapsed unless the law where you live says otherwise.
        </p>
      </Section>

      <Section title="Availability">
        <p>
          We work to keep JobFlow running but do not promise it will never be unavailable. Planned
          maintenance, a failure at a provider we depend on, or a fault of our own can interrupt it.
          Keep your own record of anything you cannot afford to lose.
        </p>
      </Section>

      <Section title="Acceptable use">
        <p>
          Do not use JobFlow to break the law, to send messages to people who have not agreed to
          hear from you, to store data you have no right to hold, or to attack the service or other
          customers of it. We may suspend an account that does.
        </p>
      </Section>

      <Section title="Liability">
        <p>
          To the extent the law allows, our total liability to you is limited to what you paid us in
          the twelve months before the claim, and we are not liable for lost profits, lost business
          or lost data. Nothing here limits liability that cannot legally be limited.
        </p>
      </Section>

      <Section title="Changes and contact">
        <p>
          We may update these terms; material changes will be announced in the app before they take
          effect, and continuing to use JobFlow after that means you accept them. Questions go to{' '}
          <ContactEmail />.
        </p>
      </Section>

      <Disclaimer />
    </>
  );
}
