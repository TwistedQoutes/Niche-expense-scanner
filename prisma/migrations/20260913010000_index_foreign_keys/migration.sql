-- Index every foreign key.
--
-- Postgres does not create an index for a foreign key, and these columns are read
-- two ways that both need one.
--
-- Relations are traversed on read. The analytics funnel asks "which leads have an
-- accepted quote?", which Prisma compiles to a correlated EXISTS over the
-- (organizationId, leadId) pair — and with 12,000 leads and 8,000 quotes in one
-- workspace that count took 224ms, because every candidate lead re-scanned the
-- quotes table. With the index it takes 22ms, and the analytics page as a whole
-- went from 294ms to 146ms. The composite foreign keys added in the previous
-- migration make this sharper, not different: the correlation is now on a
-- two-column key, so a single-column index would not serve it either.
--
-- And every referential action does a lookup. Deleting a customer has to find the
-- rows that point at them before it can cascade or clear the reference; on an
-- unindexed key that is a sequential scan per delete, per table.
--
-- The three single-column ones (audit_logs.actorUserId, jobs.assignedUserId,
-- notifications.userId) reference `users` rather than a tenant table. Nothing in
-- the product deletes a user except the demo sweep, so they earn their place on
-- the delete path rather than on any read.


-- CreateIndex
CREATE INDEX "appointments_organizationId_customerId_idx" ON "appointments"("organizationId", "customerId");

-- CreateIndex
CREATE INDEX "appointments_organizationId_serviceId_idx" ON "appointments"("organizationId", "serviceId");

-- CreateIndex
CREATE INDEX "audit_logs_actorUserId_idx" ON "audit_logs"("actorUserId");

-- CreateIndex
CREATE INDEX "automation_runs_organizationId_automationId_idx" ON "automation_runs"("organizationId", "automationId");

-- CreateIndex
CREATE INDEX "conversations_organizationId_customerId_idx" ON "conversations"("organizationId", "customerId");

-- CreateIndex
CREATE INDEX "conversations_organizationId_leadId_idx" ON "conversations"("organizationId", "leadId");

-- CreateIndex
CREATE INDEX "jobs_organizationId_quoteId_idx" ON "jobs"("organizationId", "quoteId");

-- CreateIndex
CREATE INDEX "jobs_organizationId_propertyId_idx" ON "jobs"("organizationId", "propertyId");

-- CreateIndex
CREATE INDEX "jobs_organizationId_serviceId_idx" ON "jobs"("organizationId", "serviceId");

-- CreateIndex
CREATE INDEX "jobs_assignedUserId_idx" ON "jobs"("assignedUserId");

-- CreateIndex
CREATE INDEX "leads_organizationId_customerId_idx" ON "leads"("organizationId", "customerId");

-- CreateIndex
CREATE INDEX "leads_organizationId_propertyId_idx" ON "leads"("organizationId", "propertyId");

-- CreateIndex
CREATE INDEX "notifications_userId_idx" ON "notifications"("userId");

-- CreateIndex
CREATE INDEX "quote_items_organizationId_serviceId_idx" ON "quote_items"("organizationId", "serviceId");

-- CreateIndex
CREATE INDEX "quotes_organizationId_leadId_idx" ON "quotes"("organizationId", "leadId");

-- CreateIndex
CREATE INDEX "quotes_organizationId_propertyId_idx" ON "quotes"("organizationId", "propertyId");

-- CreateIndex
CREATE INDEX "review_requests_organizationId_jobId_idx" ON "review_requests"("organizationId", "jobId");

