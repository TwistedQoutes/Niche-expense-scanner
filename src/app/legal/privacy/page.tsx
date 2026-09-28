import type { Metadata } from 'next';

import { ContactEmail, Disclaimer, PRIVACY_LAST_UPDATED, Section } from '@/components/legal/Section';

export const metadata: Metadata = {
  title: 'Privacy Policy',
  robots: { index: true, follow: true },
};

/*
 * Every sentence here describes something the code does today. When a feature
 * changes what data goes where, this page changes in the same commit, and
 * PRIVACY_LAST_UPDATED with it. Where the product cannot yet do something a
 * reader might expect — erasing one customer from inside the app — the page
 * says so, rather than implying it.
 */
export default function PrivacyPage() {
  return (
    <>
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-50">
          Privacy Policy
        </h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Last updated {PRIVACY_LAST_UPDATED}
        </p>
      </div>

      <Section title="Two kinds of people are described here">
        <p>
          <strong>You</strong>, the business owner or team member using JobFlow, and{' '}
          <strong>your customers</strong>, whose details you put into it. For your data we are the
          controller. For your customers&rsquo; data you are the controller and we are your processor —
          we hold it to provide the service to you, and we do not use it for anything else.
        </p>
      </Section>

      <Section title="What we collect about you">
        <p>
          Your name, email address, phone number and business details; a bcrypt hash of your
          password, never the password itself; and the technical records that come with using any
          website, such as IP addresses and timestamps. Payment card details go straight to Stripe
          and never reach our servers.
        </p>
        <p>
          We set one cookie, to keep you signed in. There are no advertising or analytics trackers on
          this site.
        </p>
      </Section>

      <Section title="What you put in about your customers">
        <p>
          Names, addresses, phone numbers, email addresses, property details, job photos, quotes,
          jobs, and the texts and emails you exchange with them. You decide what to enter. Please enter
          only what you need to do the work, and tell your customers you use software to manage it.
        </p>
      </Section>

      <Section title="Where your crew is">
        <p>
          If you use clock-in, each crew member&rsquo;s phone records where it was when they clocked in
          to a job and when they clocked out. Those two points are kept on the job&rsquo;s time sheet.
          Their phone can also share its current position while they are clocked in. Only the latest
          point is kept — never a trail — and it is deleted when they clock out. Crew members can see
          on their own screen when their position is being shared, and the owner and admins see it on
          the route screen. Nothing is collected while someone is not clocked in.
        </p>
      </Section>

      <Section title="Who else handles it">
        <p>Each of these providers receives only what its job needs:</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <strong>Our database host</strong> and <strong>Vercel</strong>, which runs the app,
            hold or pass through everything described on this page.
          </li>
          <li>
            <strong>An S3-compatible storage provider</strong> holds job photos, if you upload any.
          </li>
          <li>
            <strong>Stripe</strong> takes payments, and receives your email address and card
            details.
          </li>
          <li>
            <strong>Twilio</strong> sends and receives texts, and so receives your customers&rsquo;
            phone numbers and the text of those messages.
          </li>
          <li>
            <strong>Resend</strong> sends email, and receives the recipient&rsquo;s address and the
            message.
          </li>
          <li>
            <strong>Google Maps</strong> looks up addresses and measures driving distance, and
            receives the addresses involved.
          </li>
          <li>
            <strong>OpenAI</strong> powers the AI features — see below.
          </li>
        </ul>
        <p>
          Each provider is used only when it is switched on for this service. Twilio and Resend keep
          their own records of messages they delivered, under their own policies.
        </p>
      </Section>

      <Section title="What the AI sees">
        <p>
          When the AI features are switched on for this service, a lead added in the app is scored
          automatically, and you can ask for any lead to be scored. To do that, the lead&rsquo;s name, the service
          they asked for, their description of the job, their address and where the lead came from are
          sent to OpenAI, which returns a score, a summary and a draft reply. Texts your customers
          send you are not sent to OpenAI. The AI features are on or off for the whole service; there
          is not yet a switch to turn them off for one business.
        </p>
      </Section>

      <Section title="How long we keep it">
        <p>
          Your data is kept for as long as your workspace exists. A live crew position is deleted when
          that person clocks out. Demo workspaces are deleted automatically within a few days.
        </p>
        <p>
          When the owner deletes a workspace, everything in it is deleted at once: customers,
          properties, leads, quotes, jobs, messages, time sheets, photos and the audit log. The
          subscription is cancelled, and the sign-in accounts of everyone who belonged to that
          workspace and to no other are deleted too. Copies in our database host&rsquo;s recovery
          backups expire on that host&rsquo;s schedule. Stripe keeps its own records of payments and
          invoices, as payment law requires.
        </p>
      </Section>

      <Section title="Your rights">
        <p>
          The owner of a workspace can download everything in it at any time, from Settings, as
          spreadsheets. Details can be corrected in the app by anyone with permission to edit them. The owner can delete the workspace from
          Settings; it cannot be undone.
        </p>
        <p>
          If a team member wants their own account deleted, or one of your customers asks you to erase
          them, email us: the app does not yet have a button that removes one person and everything
          that mentions them, so we do it for you. If you are in the UK or EU you also have the right
          to object to processing and to complain to your data protection authority.
        </p>
      </Section>

      <Section title="Security">
        <p>
          Data is encrypted in transit. Passwords are hashed with bcrypt. Every business&rsquo;s
          records are kept apart by a tenant boundary enforced in the data layer, and the database
          itself refuses to link one business&rsquo;s records to another&rsquo;s. Resetting your password
          signs you out on every device. No system is perfect; if we ever have a breach affecting your
          data, we will tell you.
        </p>
      </Section>

      <Section title="Contact">
        <p>
          Questions about any of this, and requests to delete an account or a customer, go to{' '}
          <ContactEmail />.
        </p>
      </Section>

      <Disclaimer />
    </>
  );
}
