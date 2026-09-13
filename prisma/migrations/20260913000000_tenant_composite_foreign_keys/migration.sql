-- Composite foreign keys: a cross-tenant reference becomes a row Postgres refuses.
--
-- Filtering queries was never enough on its own. The tenant client rewrites the
-- top-level `where` of the model being queried, but a foreign key is just a cuid
-- in a column: a lead created in one workspace could name another workspace's
-- `customerId`, and reading it back followed the join and returned their
-- customer's name, email, phone and the property's street address. Prisma's
-- to-one `include` takes no `where`, so that read could not be filtered at all.
--
-- So each of these 25 relations now references (organizationId, id) against a
-- composite unique on the parent, and the boundary is enforced by the database
-- rather than by every call site remembering to check.
--
-- Two things about this file are deliberate and easy to undo by accident:
--
--  1. `ON DELETE SET NULL ("<column>")` — the column list is required. Prisma
--     emits the plain form, which nulls the WHOLE key including
--     `organizationId`; since that column is NOT NULL, deleting a customer then
--     fails outright with a not-null violation instead of clearing the
--     reference. Postgres 15+ takes a column list, which clears only the
--     reference. Prisma cannot express this, but `migrate diff` reports no drift
--     against it, so the schema and this file agree.
--
--  2. The repair below runs first. A deployment that has been live already has
--     rows pointing across the boundary — that is the bug being closed — and the
--     constraints cannot be added while they exist.
--
-- scripts/check-tenant-constraints.mjs verifies (1) in CI, because a future
-- `prisma migrate dev` that regenerates one of these will drop the column list
-- and quietly break deletes.

-- ── 1. Repair existing cross-tenant references ───────────────────────────────
--
-- Nullable references are cleared. That is exactly what the application does
-- when the parent goes away, and it keeps the child row — a quote that named
-- someone else's property is still this business's quote.

UPDATE "properties" AS c SET "customerId" = NULL
WHERE c."customerId" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM "customers" AS p
    WHERE p."id" = c."customerId" AND p."organizationId" = c."organizationId"
  );

UPDATE "leads" AS c SET "customerId" = NULL
WHERE c."customerId" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM "customers" AS p
    WHERE p."id" = c."customerId" AND p."organizationId" = c."organizationId"
  );

UPDATE "leads" AS c SET "propertyId" = NULL
WHERE c."propertyId" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM "properties" AS p
    WHERE p."id" = c."propertyId" AND p."organizationId" = c."organizationId"
  );

UPDATE "pricing_rules" AS c SET "serviceId" = NULL
WHERE c."serviceId" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM "services" AS p
    WHERE p."id" = c."serviceId" AND p."organizationId" = c."organizationId"
  );

UPDATE "quotes" AS c SET "customerId" = NULL
WHERE c."customerId" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM "customers" AS p
    WHERE p."id" = c."customerId" AND p."organizationId" = c."organizationId"
  );

UPDATE "quotes" AS c SET "leadId" = NULL
WHERE c."leadId" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM "leads" AS p
    WHERE p."id" = c."leadId" AND p."organizationId" = c."organizationId"
  );

UPDATE "quotes" AS c SET "propertyId" = NULL
WHERE c."propertyId" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM "properties" AS p
    WHERE p."id" = c."propertyId" AND p."organizationId" = c."organizationId"
  );

UPDATE "quote_items" AS c SET "serviceId" = NULL
WHERE c."serviceId" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM "services" AS p
    WHERE p."id" = c."serviceId" AND p."organizationId" = c."organizationId"
  );

UPDATE "jobs" AS c SET "propertyId" = NULL
WHERE c."propertyId" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM "properties" AS p
    WHERE p."id" = c."propertyId" AND p."organizationId" = c."organizationId"
  );

UPDATE "jobs" AS c SET "quoteId" = NULL
WHERE c."quoteId" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM "quotes" AS p
    WHERE p."id" = c."quoteId" AND p."organizationId" = c."organizationId"
  );

UPDATE "jobs" AS c SET "serviceId" = NULL
WHERE c."serviceId" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM "services" AS p
    WHERE p."id" = c."serviceId" AND p."organizationId" = c."organizationId"
  );

UPDATE "appointments" AS c SET "customerId" = NULL
WHERE c."customerId" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM "customers" AS p
    WHERE p."id" = c."customerId" AND p."organizationId" = c."organizationId"
  );

UPDATE "appointments" AS c SET "jobId" = NULL
WHERE c."jobId" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM "jobs" AS p
    WHERE p."id" = c."jobId" AND p."organizationId" = c."organizationId"
  );

UPDATE "appointments" AS c SET "serviceId" = NULL
WHERE c."serviceId" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM "services" AS p
    WHERE p."id" = c."serviceId" AND p."organizationId" = c."organizationId"
  );

UPDATE "conversations" AS c SET "customerId" = NULL
WHERE c."customerId" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM "customers" AS p
    WHERE p."id" = c."customerId" AND p."organizationId" = c."organizationId"
  );

UPDATE "conversations" AS c SET "leadId" = NULL
WHERE c."leadId" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM "leads" AS p
    WHERE p."id" = c."leadId" AND p."organizationId" = c."organizationId"
  );

UPDATE "review_requests" AS c SET "jobId" = NULL
WHERE c."jobId" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM "jobs" AS p
    WHERE p."id" = c."jobId" AND p."organizationId" = c."organizationId"
  );

UPDATE "files" AS c SET "leadId" = NULL
WHERE c."leadId" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM "leads" AS p
    WHERE p."id" = c."leadId" AND p."organizationId" = c."organizationId"
  );

UPDATE "files" AS c SET "jobId" = NULL
WHERE c."jobId" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM "jobs" AS p
    WHERE p."id" = c."jobId" AND p."organizationId" = c."organizationId"
  );

-- Required references cannot be cleared, so they are reported rather than
-- guessed at. These should not exist — every write path that accepts one of
-- these ids validates it — and deleting a row to make a migration pass is not a
-- decision a migration should take on someone's behalf.
DO $$
DECLARE
  offending bigint;
BEGIN
  SELECT count(*) INTO offending FROM "lead_activities" AS c
  WHERE NOT EXISTS (
    SELECT 1 FROM "leads" AS p
    WHERE p."id" = c."leadId" AND p."organizationId" = c."organizationId"
  );
  IF offending > 0 THEN
    RAISE EXCEPTION '% rows in "lead_activities" reference a "leads" in another organization via "leadId". This column is NOT NULL, so the reference cannot simply be cleared — inspect and resolve these rows by hand before migrating.', offending;
  END IF;

  SELECT count(*) INTO offending FROM "quote_items" AS c
  WHERE NOT EXISTS (
    SELECT 1 FROM "quotes" AS p
    WHERE p."id" = c."quoteId" AND p."organizationId" = c."organizationId"
  );
  IF offending > 0 THEN
    RAISE EXCEPTION '% rows in "quote_items" reference a "quotes" in another organization via "quoteId". This column is NOT NULL, so the reference cannot simply be cleared — inspect and resolve these rows by hand before migrating.', offending;
  END IF;

  SELECT count(*) INTO offending FROM "jobs" AS c
  WHERE NOT EXISTS (
    SELECT 1 FROM "customers" AS p
    WHERE p."id" = c."customerId" AND p."organizationId" = c."organizationId"
  );
  IF offending > 0 THEN
    RAISE EXCEPTION '% rows in "jobs" reference a "customers" in another organization via "customerId". This column is NOT NULL, so the reference cannot simply be cleared — inspect and resolve these rows by hand before migrating.', offending;
  END IF;

  SELECT count(*) INTO offending FROM "messages" AS c
  WHERE NOT EXISTS (
    SELECT 1 FROM "conversations" AS p
    WHERE p."id" = c."conversationId" AND p."organizationId" = c."organizationId"
  );
  IF offending > 0 THEN
    RAISE EXCEPTION '% rows in "messages" reference a "conversations" in another organization via "conversationId". This column is NOT NULL, so the reference cannot simply be cleared — inspect and resolve these rows by hand before migrating.', offending;
  END IF;

  SELECT count(*) INTO offending FROM "automation_runs" AS c
  WHERE NOT EXISTS (
    SELECT 1 FROM "automations" AS p
    WHERE p."id" = c."automationId" AND p."organizationId" = c."organizationId"
  );
  IF offending > 0 THEN
    RAISE EXCEPTION '% rows in "automation_runs" reference a "automations" in another organization via "automationId". This column is NOT NULL, so the reference cannot simply be cleared — inspect and resolve these rows by hand before migrating.', offending;
  END IF;

  SELECT count(*) INTO offending FROM "review_requests" AS c
  WHERE NOT EXISTS (
    SELECT 1 FROM "customers" AS p
    WHERE p."id" = c."customerId" AND p."organizationId" = c."organizationId"
  );
  IF offending > 0 THEN
    RAISE EXCEPTION '% rows in "review_requests" reference a "customers" in another organization via "customerId". This column is NOT NULL, so the reference cannot simply be cleared — inspect and resolve these rows by hand before migrating.', offending;
  END IF;
END $$;

-- ── 2. Replace each single-column foreign key with its composite form ────────

-- DropForeignKey
ALTER TABLE "appointments" DROP CONSTRAINT "appointments_customerId_fkey";

-- DropForeignKey
ALTER TABLE "appointments" DROP CONSTRAINT "appointments_jobId_fkey";

-- DropForeignKey
ALTER TABLE "appointments" DROP CONSTRAINT "appointments_serviceId_fkey";

-- DropForeignKey
ALTER TABLE "automation_runs" DROP CONSTRAINT "automation_runs_automationId_fkey";

-- DropForeignKey
ALTER TABLE "conversations" DROP CONSTRAINT "conversations_customerId_fkey";

-- DropForeignKey
ALTER TABLE "conversations" DROP CONSTRAINT "conversations_leadId_fkey";

-- DropForeignKey
ALTER TABLE "files" DROP CONSTRAINT "files_jobId_fkey";

-- DropForeignKey
ALTER TABLE "files" DROP CONSTRAINT "files_leadId_fkey";

-- DropForeignKey
ALTER TABLE "jobs" DROP CONSTRAINT "jobs_customerId_fkey";

-- DropForeignKey
ALTER TABLE "jobs" DROP CONSTRAINT "jobs_propertyId_fkey";

-- DropForeignKey
ALTER TABLE "jobs" DROP CONSTRAINT "jobs_quoteId_fkey";

-- DropForeignKey
ALTER TABLE "jobs" DROP CONSTRAINT "jobs_serviceId_fkey";

-- DropForeignKey
ALTER TABLE "lead_activities" DROP CONSTRAINT "lead_activities_leadId_fkey";

-- DropForeignKey
ALTER TABLE "leads" DROP CONSTRAINT "leads_customerId_fkey";

-- DropForeignKey
ALTER TABLE "leads" DROP CONSTRAINT "leads_propertyId_fkey";

-- DropForeignKey
ALTER TABLE "messages" DROP CONSTRAINT "messages_conversationId_fkey";

-- DropForeignKey
ALTER TABLE "pricing_rules" DROP CONSTRAINT "pricing_rules_serviceId_fkey";

-- DropForeignKey
ALTER TABLE "properties" DROP CONSTRAINT "properties_customerId_fkey";

-- DropForeignKey
ALTER TABLE "quote_items" DROP CONSTRAINT "quote_items_quoteId_fkey";

-- DropForeignKey
ALTER TABLE "quote_items" DROP CONSTRAINT "quote_items_serviceId_fkey";

-- DropForeignKey
ALTER TABLE "quotes" DROP CONSTRAINT "quotes_customerId_fkey";

-- DropForeignKey
ALTER TABLE "quotes" DROP CONSTRAINT "quotes_leadId_fkey";

-- DropForeignKey
ALTER TABLE "quotes" DROP CONSTRAINT "quotes_propertyId_fkey";

-- DropForeignKey
ALTER TABLE "review_requests" DROP CONSTRAINT "review_requests_customerId_fkey";

-- DropForeignKey
ALTER TABLE "review_requests" DROP CONSTRAINT "review_requests_jobId_fkey";

-- CreateIndex
CREATE UNIQUE INDEX "automations_organizationId_id_key" ON "automations"("organizationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "conversations_organizationId_id_key" ON "conversations"("organizationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "customers_organizationId_id_key" ON "customers"("organizationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "jobs_organizationId_id_key" ON "jobs"("organizationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "leads_organizationId_id_key" ON "leads"("organizationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "properties_organizationId_id_key" ON "properties"("organizationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "quotes_organizationId_id_key" ON "quotes"("organizationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "services_organizationId_id_key" ON "services"("organizationId", "id");

-- AddForeignKey
ALTER TABLE "properties" ADD CONSTRAINT "properties_organizationId_customerId_fkey" FOREIGN KEY ("organizationId", "customerId") REFERENCES "customers"("organizationId", "id") ON DELETE SET NULL ("customerId") ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_organizationId_customerId_fkey" FOREIGN KEY ("organizationId", "customerId") REFERENCES "customers"("organizationId", "id") ON DELETE SET NULL ("customerId") ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_organizationId_propertyId_fkey" FOREIGN KEY ("organizationId", "propertyId") REFERENCES "properties"("organizationId", "id") ON DELETE SET NULL ("propertyId") ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_activities" ADD CONSTRAINT "lead_activities_organizationId_leadId_fkey" FOREIGN KEY ("organizationId", "leadId") REFERENCES "leads"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pricing_rules" ADD CONSTRAINT "pricing_rules_organizationId_serviceId_fkey" FOREIGN KEY ("organizationId", "serviceId") REFERENCES "services"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_organizationId_customerId_fkey" FOREIGN KEY ("organizationId", "customerId") REFERENCES "customers"("organizationId", "id") ON DELETE SET NULL ("customerId") ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_organizationId_leadId_fkey" FOREIGN KEY ("organizationId", "leadId") REFERENCES "leads"("organizationId", "id") ON DELETE SET NULL ("leadId") ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_organizationId_propertyId_fkey" FOREIGN KEY ("organizationId", "propertyId") REFERENCES "properties"("organizationId", "id") ON DELETE SET NULL ("propertyId") ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quote_items" ADD CONSTRAINT "quote_items_organizationId_quoteId_fkey" FOREIGN KEY ("organizationId", "quoteId") REFERENCES "quotes"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quote_items" ADD CONSTRAINT "quote_items_organizationId_serviceId_fkey" FOREIGN KEY ("organizationId", "serviceId") REFERENCES "services"("organizationId", "id") ON DELETE SET NULL ("serviceId") ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_organizationId_customerId_fkey" FOREIGN KEY ("organizationId", "customerId") REFERENCES "customers"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_organizationId_propertyId_fkey" FOREIGN KEY ("organizationId", "propertyId") REFERENCES "properties"("organizationId", "id") ON DELETE SET NULL ("propertyId") ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_organizationId_quoteId_fkey" FOREIGN KEY ("organizationId", "quoteId") REFERENCES "quotes"("organizationId", "id") ON DELETE SET NULL ("quoteId") ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_organizationId_serviceId_fkey" FOREIGN KEY ("organizationId", "serviceId") REFERENCES "services"("organizationId", "id") ON DELETE SET NULL ("serviceId") ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_organizationId_customerId_fkey" FOREIGN KEY ("organizationId", "customerId") REFERENCES "customers"("organizationId", "id") ON DELETE SET NULL ("customerId") ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_organizationId_jobId_fkey" FOREIGN KEY ("organizationId", "jobId") REFERENCES "jobs"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_organizationId_serviceId_fkey" FOREIGN KEY ("organizationId", "serviceId") REFERENCES "services"("organizationId", "id") ON DELETE SET NULL ("serviceId") ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_organizationId_customerId_fkey" FOREIGN KEY ("organizationId", "customerId") REFERENCES "customers"("organizationId", "id") ON DELETE SET NULL ("customerId") ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_organizationId_leadId_fkey" FOREIGN KEY ("organizationId", "leadId") REFERENCES "leads"("organizationId", "id") ON DELETE SET NULL ("leadId") ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_organizationId_conversationId_fkey" FOREIGN KEY ("organizationId", "conversationId") REFERENCES "conversations"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_runs" ADD CONSTRAINT "automation_runs_organizationId_automationId_fkey" FOREIGN KEY ("organizationId", "automationId") REFERENCES "automations"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_requests" ADD CONSTRAINT "review_requests_organizationId_customerId_fkey" FOREIGN KEY ("organizationId", "customerId") REFERENCES "customers"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_requests" ADD CONSTRAINT "review_requests_organizationId_jobId_fkey" FOREIGN KEY ("organizationId", "jobId") REFERENCES "jobs"("organizationId", "id") ON DELETE SET NULL ("jobId") ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "files" ADD CONSTRAINT "files_organizationId_leadId_fkey" FOREIGN KEY ("organizationId", "leadId") REFERENCES "leads"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "files" ADD CONSTRAINT "files_organizationId_jobId_fkey" FOREIGN KEY ("organizationId", "jobId") REFERENCES "jobs"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

