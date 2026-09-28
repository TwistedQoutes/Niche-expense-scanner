import { prisma } from '@/lib/db/client';
import type { TenantClient } from '@/lib/db/tenant';
import { buildArchive, omit, type Row, type Table } from '@/lib/workspace/archive';

/**
 * Everything a workspace holds, as one download.
 *
 * Every tenant table is read through the tenant client, so the organization
 * filter is applied by the same extension that guards every other query — this
 * file has no way to name another business's rows. The two reads that are not
 * tenant tables (the business itself, and team members' names) are keyed by the
 * id from the verified session.
 *
 * Complete by construction: `tests/workspace-export.test.ts` fails if a model is
 * added to TENANT_MODELS without a table here, because an export that quietly
 * leaves out a new kind of record is exactly the gap nobody notices until the
 * day they need it.
 *
 * Held in memory, then zipped. Text compresses about tenfold, so a business with
 * ten thousand leads is a download of a few megabytes; a workspace large enough
 * for that to matter would want a background job and an emailed link instead.
 */

/** Never exported: hashes of secrets, and capability tokens. */
const SECRET_KEYS = ['tokenHash', 'token', 'passwordHash'] as const;

/** The model names this export covers, checked against TENANT_MODELS in tests. */
export const EXPORTED_MODELS = [
  'Membership',
  'Invitation',
  'Subscription',
  'Customer',
  'Property',
  'Lead',
  'LeadActivity',
  'Service',
  'PricingRule',
  'Quote',
  'QuoteItem',
  'Job',
  'TimeEntry',
  'CrewPosition',
  'Appointment',
  'Conversation',
  'Message',
  'Automation',
  'AutomationRun',
  'ReviewRequest',
  'File',
  'Notification',
  'Usage',
  'Invoice',
  'AuditLog',
] as const;

const clean = (rows: Row[]): Row[] => rows.map((row) => omit(row, SECRET_KEYS));

async function readTables(db: TenantClient): Promise<Table[]> {
  const oldestFirst = { orderBy: { createdAt: 'asc' as const } };

  const [
    memberships,
    invitations,
    subscriptions,
    customers,
    properties,
    leads,
    leadActivities,
    services,
    pricingRules,
    quotes,
    quoteItems,
    jobs,
    timeEntries,
    crewPositions,
    appointments,
    conversations,
    messages,
    automations,
    automationRuns,
    reviewRequests,
    files,
    notifications,
    usage,
    invoices,
    auditLogs,
  ] = await Promise.all([
    db.membership.findMany({
      ...oldestFirst,
      include: { user: { select: { name: true, email: true, phone: true } } },
    }),
    db.invitation.findMany(oldestFirst),
    db.subscription.findMany(),
    db.customer.findMany(oldestFirst),
    db.property.findMany(oldestFirst),
    db.lead.findMany(oldestFirst),
    db.leadActivity.findMany(oldestFirst),
    db.service.findMany(oldestFirst),
    db.pricingRule.findMany(oldestFirst),
    db.quote.findMany(oldestFirst),
    db.quoteItem.findMany(oldestFirst),
    db.job.findMany(oldestFirst),
    db.timeEntry.findMany({ orderBy: { startedAt: 'asc' } }),
    db.crewPosition.findMany({ orderBy: { recordedAt: 'asc' } }),
    db.appointment.findMany(oldestFirst),
    db.conversation.findMany(oldestFirst),
    db.message.findMany(oldestFirst),
    db.automation.findMany({ ...oldestFirst, include: { steps: { orderBy: { position: 'asc' } } } }),
    db.automationRun.findMany(oldestFirst),
    db.reviewRequest.findMany(oldestFirst),
    db.file.findMany(oldestFirst),
    db.notification.findMany(oldestFirst),
    db.usage.findMany(oldestFirst),
    db.invoice.findMany(oldestFirst),
    db.auditLog.findMany(oldestFirst),
  ]);

  // A team member is a membership plus the person's name and email, flattened
  // so the spreadsheet has one row per person.
  const team = memberships.map(({ user, ...membership }) => ({
    ...membership,
    name: user.name,
    email: user.email,
    phone: user.phone,
  }));

  const automationSteps = automations.flatMap((automation) => automation.steps);
  const automationRows = automations.map(({ steps: _steps, ...automation }) => automation);

  // The storage key is an internal address in the bucket, useless outside it.
  // The download path is what works: the app's own authorised file route.
  const photos = files.map(({ storageKey: _storageKey, ...file }) => ({
    ...file,
    downloadPath: `/api/files/${file.id}`,
  }));

  return [
    { name: 'customers', description: 'the people you work for', rows: clean(customers) },
    { name: 'properties', description: 'addresses, lot and lawn sizes, access notes', rows: clean(properties) },
    { name: 'leads', description: 'every enquiry, won or not', rows: clean(leads) },
    { name: 'lead_activity', description: 'the history on each lead', rows: clean(leadActivities) },
    { name: 'quotes', description: 'every quote and its status', rows: clean(quotes) },
    { name: 'quote_items', description: 'the lines on each quote', rows: clean(quoteItems) },
    { name: 'jobs', description: 'scheduled and finished work', rows: clean(jobs) },
    { name: 'appointments', description: 'calendar bookings', rows: clean(appointments) },
    { name: 'time_entries', description: 'clock-ins and clock-outs, with their pins', rows: clean(timeEntries) },
    { name: 'crew_positions', description: 'live positions, only while clocked in', rows: clean(crewPositions) },
    { name: 'conversations', description: 'one thread per customer', rows: clean(conversations) },
    { name: 'messages', description: 'every text and email, both directions', rows: clean(messages) },
    { name: 'services', description: 'your service catalogue and prices', rows: clean(services) },
    { name: 'pricing_rules', description: 'size and distance pricing rules', rows: clean(pricingRules) },
    { name: 'automations', description: 'follow-up and reminder sequences', rows: clean(automationRows) },
    { name: 'automation_steps', description: 'the steps in each sequence', rows: clean(automationSteps) },
    { name: 'automation_runs', description: 'each time a sequence ran', rows: clean(automationRuns) },
    { name: 'review_requests', description: 'review asks and whether they were opened', rows: clean(reviewRequests) },
    { name: 'photos', description: 'job photos, with a link to download each', rows: clean(photos) },
    { name: 'team', description: 'who can sign in, their role and pay rate', rows: clean(team) },
    { name: 'invitations', description: 'teammates invited', rows: clean(invitations) },
    { name: 'subscription', description: 'your plan', rows: clean(subscriptions) },
    { name: 'invoices', description: 'what you have been billed', rows: clean(invoices) },
    { name: 'usage', description: 'monthly usage counts', rows: clean(usage) },
    { name: 'notifications', description: 'in-app notifications', rows: clean(notifications) },
    { name: 'audit_log', description: 'who changed what, and when', rows: clean(auditLogs) },
  ];
}

export async function exportWorkspace(input: {
  organizationId: string;
  db: TenantClient;
  now?: Date;
}): Promise<{ fileName: string; bytes: Uint8Array; tables: number; rows: number }> {
  const exportedAt = input.now ?? new Date();

  const business = await prisma.organization.findUniqueOrThrow({ where: { id: input.organizationId } });
  const tables = await readTables(input.db);

  const bytes = buildArchive({
    businessName: business.name,
    exportedAt,
    business: business as unknown as Row,
    tables,
  });

  const day = exportedAt.toISOString().slice(0, 10);
  return {
    fileName: `jobflow-${business.slug}-${day}.zip`,
    bytes,
    tables: tables.length,
    rows: tables.reduce((total, table) => total + table.rows.length, 0),
  };
}
