import { Channel } from '@prisma/client';

import { AppError, notFound, validationFailed } from '@/lib/api/errors';
import { readJsonBody, withRoute } from '@/lib/api/handler';
import { RATE_LIMITS, enforceRateLimit } from '@/lib/api/rate-limit';
import { jsonOk, toFieldErrors } from '@/lib/api/response';
import { requireAuth } from '@/lib/auth/context';
import { sendMessage } from '@/lib/messaging/send';
import { idSchema } from '@/lib/validation/common';
import { replyLengthError, sendReplySchema } from '@/lib/validation/messaging';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** A manual reply from the unified inbox. */
export const POST = withRoute(async (request, context: { params: Promise<{ id: string }> }) => {
  const auth = await requireAuth();
  enforceRateLimit(RATE_LIMITS.messaging, auth.organization.id);

  const { id } = await context.params;
  const parsedId = idSchema.safeParse(id);
  if (!parsedId.success) throw notFound('That conversation does not exist.');

  const parsed = sendReplySchema.safeParse(await readJsonBody(request));
  if (!parsed.success) throw validationFailed(toFieldErrors(parsed.error));

  const conversation = await auth.db.conversation.findUnique({
    where: { id: parsedId.data },
    select: { id: true, channel: true, contact: true, customerId: true, leadId: true, subject: true },
  });
  if (!conversation) throw notFound('That conversation does not exist.');

  const lengthProblem = replyLengthError(conversation.channel, parsed.data.body);
  if (lengthProblem) throw validationFailed({ body: lengthProblem });

  const outcome = await sendMessage(auth.db, auth.subscription, {
    organizationId: auth.organization.id,
    channel: conversation.channel,
    to: conversation.contact,
    body: parsed.data.body,
    subject: parsed.data.subject ?? conversation.subject,
    customerId: conversation.customerId,
    leadId: conversation.leadId,
  });

  if (!outcome.ok) {
    // Distinct codes so the UI can say the right thing: 403 for an opt-out or a
    // spent allowance (the owner's action is different in each case), 502 when
    // the provider itself failed.
    const code =
      outcome.reason === 'limit' || outcome.reason === 'opted_out'
        ? 'forbidden'
        : outcome.reason === 'no_contact'
          ? 'bad_request'
          : 'bad_gateway';

    throw new AppError(code, outcome.message);
  }

  // Reading the thread is what clears it; replying certainly does.
  await auth.db.conversation.update({
    where: { id: conversation.id },
    data: { unreadCount: 0 },
  });

  return jsonOk({ messageId: outcome.messageId, channel: conversation.channel as Channel }, { status: 201 });
});
