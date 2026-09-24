import type { Metadata } from 'next';
import Link from 'next/link';

import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { requireAuth } from '@/lib/auth/context';
import { formatRelative } from '@/lib/dates';
import { smsEnabled } from '@/lib/sms';
import { emailEnabled } from '@/lib/email';

export const metadata: Metadata = { title: 'Messages' };
export const dynamic = 'force-dynamic';

export default async function MessagesPage() {
  const auth = await requireAuth();

  const conversations = await auth.db.conversation.findMany({
    where: { archived: false },
    orderBy: [{ lastMessageAt: 'desc' }, { createdAt: 'desc' }],
    take: 100,
    select: {
      id: true,
      channel: true,
      contact: true,
      subject: true,
      lastMessageAt: true,
      unreadCount: true,
      customer: { select: { firstName: true, lastName: true } },
      lead: { select: { firstName: true, lastName: true } },
      messages: {
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: { body: true, direction: true },
      },
    },
  });

  const channelsOff = !smsEnabled() && !emailEnabled();

  return (
    <div className="space-y-4 p-4 lg:p-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900 dark:text-slate-50">Messages</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Every text and email, one thread per customer.
        </p>
      </div>

      {channelsOff ? (
        <p className="rounded-xl bg-slate-100 px-4 py-3 text-sm text-slate-600 dark:bg-slate-800 dark:text-slate-300">
          No messaging channel is configured yet, so replies are written to the server log instead
          of sent. Add Twilio or Resend credentials to turn real delivery on.
        </p>
      ) : null}

      <div className="overflow-hidden rounded-2xl bg-white ring-1 ring-slate-200/80 dark:bg-slate-900 dark:ring-slate-800">
        {conversations.length === 0 ? (
          <EmptyState
            title="No conversations yet"
            description="A text from a customer, or a reply to a quote, starts a thread here."
          />
        ) : (
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {conversations.map((conversation) => {
              const person = conversation.customer ?? conversation.lead;
              const name = person
                ? [person.firstName, person.lastName].filter(Boolean).join(' ')
                : conversation.contact;
              const latest = conversation.messages[0];

              return (
                <li key={conversation.id}>
                  <Link
                    href={`/messages/${conversation.id}`}
                    className="flex items-start justify-between gap-3 px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-800/60"
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="truncate text-sm font-medium text-slate-900 dark:text-slate-100">
                          {name}
                        </p>
                        <Badge tone="neutral">{conversation.channel.toLowerCase()}</Badge>
                        {conversation.unreadCount > 0 ? (
                          <Badge tone="urgent">{conversation.unreadCount} new</Badge>
                        ) : null}
                      </div>

                      {latest ? (
                        <p className="mt-0.5 truncate text-xs text-slate-500 dark:text-slate-400">
                          {latest.direction === 'OUTBOUND' ? 'You: ' : ''}
                          {latest.body}
                        </p>
                      ) : null}
                    </div>

                    <span className="shrink-0 text-xs text-slate-500 dark:text-slate-400">
                      {conversation.lastMessageAt ? formatRelative(conversation.lastMessageAt) : ''}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
