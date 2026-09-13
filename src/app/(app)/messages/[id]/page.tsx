import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { MessageDirection, MessageStatus } from '@prisma/client';

import { ReplyBox } from '@/components/messaging/ReplyBox';
import { Badge } from '@/components/ui/Badge';
import { requireAuth } from '@/lib/auth/context';
import { formatDateTimeLabel } from '@/lib/dates';
import { hasOptedOut } from '@/lib/messaging/optout';
import { cn } from '@/lib/cn';
import { idSchema } from '@/lib/validation/common';

export const metadata: Metadata = { title: 'Conversation' };
export const dynamic = 'force-dynamic';

export default async function ConversationPage(props: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth();
  const { id } = await props.params;

  if (!idSchema.safeParse(id).success) notFound();

  const conversation = await auth.db.conversation.findUnique({
    where: { id },
    select: {
      id: true,
      channel: true,
      contact: true,
      subject: true,
      customer: { select: { id: true, firstName: true, lastName: true, tags: true } },
      lead: { select: { id: true, firstName: true, lastName: true } },
      messages: { orderBy: { createdAt: 'asc' }, take: 200 },
    },
  });

  if (!conversation) notFound();

  // Opening the thread is reading it.
  await auth.db.conversation.updateMany({ where: { id }, data: { unreadCount: 0 } });

  const person = conversation.customer ?? conversation.lead;
  const name = person
    ? [person.firstName, person.lastName].filter(Boolean).join(' ')
    : conversation.contact;
  const optedOut = conversation.customer ? hasOptedOut(conversation.customer.tags) : false;
  const timeZone = auth.organization.timezone;

  return (
    <div className="mx-auto flex min-h-full max-w-3xl flex-col gap-4 p-4 lg:p-6">
      <div>
        <Link
          href="/messages"
          className="text-sm text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
        >
          ← Back to messages
        </Link>

        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-50">{name}</h1>
          <Badge tone="neutral">{conversation.channel.toLowerCase()}</Badge>
          {optedOut ? <Badge tone="danger">Opted out</Badge> : null}
        </div>

        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          {conversation.contact}
          {conversation.customer ? (
            <>
              {' · '}
              <Link
                href={`/customers/${conversation.customer.id}`}
                className="text-brand-700 dark:text-brand-400 hover:underline"
              >
                Customer record
              </Link>
            </>
          ) : null}
          {conversation.lead ? (
            <>
              {' · '}
              <Link
                href={`/leads/${conversation.lead.id}`}
                className="text-brand-700 dark:text-brand-400 hover:underline"
              >
                Lead
              </Link>
            </>
          ) : null}
        </p>
      </div>

      <ol className="flex-1 space-y-3">
        {conversation.messages.map((message) => {
          const outbound = message.direction === MessageDirection.OUTBOUND;

          return (
            <li key={message.id} className={cn('flex', outbound ? 'justify-end' : 'justify-start')}>
              <div
                className={cn(
                  'max-w-[85%] rounded-2xl px-3.5 py-2.5',
                  outbound
                    ? 'bg-brand-600 text-white'
                    : 'bg-white text-slate-800 ring-1 ring-slate-200 dark:bg-slate-800 dark:text-slate-200 dark:ring-slate-700',
                )}
              >
                {message.subject ? (
                  <p className="mb-1 text-xs font-semibold opacity-80">{message.subject}</p>
                ) : null}

                <p className="text-sm whitespace-pre-wrap">{message.body}</p>

                <p className={cn('mt-1 text-xs', outbound ? 'text-brand-100' : 'text-slate-500 dark:text-slate-400')}>
                  {formatDateTimeLabel(message.createdAt, timeZone)}
                  {message.aiGenerated ? ' · AI draft' : ''}
                  {/* Said plainly: a QUEUED outbound message was logged, not sent,
                      because no channel is configured. Silence would read as sent. */}
                  {outbound && message.status === MessageStatus.QUEUED ? ' · not sent (no channel configured)' : ''}
                  {message.status === MessageStatus.FAILED ? ' · failed to send' : ''}
                </p>
              </div>
            </li>
          );
        })}
      </ol>

      <div className="sticky bottom-0 rounded-2xl bg-white p-4 ring-1 ring-slate-200/80 dark:bg-slate-900 dark:ring-slate-800">
        <ReplyBox
          conversationId={conversation.id}
          channel={conversation.channel}
          optedOut={optedOut}
        />
      </div>
    </div>
  );
}
