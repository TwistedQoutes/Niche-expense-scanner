-- Clocking in and out of a job, with the pin the phone had at the time.
--
-- One table. A row is opened by a tap on "clock in" and closed by a tap on
-- "clock out", per person per job — which is the part a job record could not
-- express: `jobs.startedAt`/`completedAt` is one span for the whole job, so two
-- crew for an hour looked like one paid hour, and a job that ran over two
-- mornings looked like it ran overnight.
--
-- Every location column is nullable, and that is the design rather than
-- laziness. A crew member who declines the permission still clocks in; the time
-- is the record, the pin is corroboration, and an app that refuses to let
-- somebody start work because their phone said no is an app they stop using.
-- `startLocationNote` says which kind of nothing it was — denied, unavailable,
-- timed out, unsupported — because "they turned it off" and "we never asked" are
-- different facts.
--
-- `startAccuracyMetres` is not decoration. A pin 400 feet from the house with a
-- 10-metre radius says something; the same 400 feet with a 1,500-metre radius
-- says nothing at all, and the difference between those two is the difference
-- between a fair question and an unfair accusation. Nothing in this product is
-- allowed to show the distance without it.

-- CreateTable
CREATE TABLE "time_entries" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "startLatitude" DOUBLE PRECISION,
    "startLongitude" DOUBLE PRECISION,
    "startAccuracyMetres" INTEGER,
    "startLocationNote" TEXT,
    "endLatitude" DOUBLE PRECISION,
    "endLongitude" DOUBLE PRECISION,
    "endAccuracyMetres" INTEGER,
    "endLocationNote" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "time_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "time_entries_organizationId_jobId_idx" ON "time_entries"("organizationId", "jobId");

-- CreateIndex
CREATE INDEX "time_entries_organizationId_userId_startedAt_idx" ON "time_entries"("organizationId", "userId", "startedAt");

-- One open entry per person, enforced by Postgres rather than by the application.
--
-- Not a nicety. The failure it prevents is ordinary: a crew member taps "clock
-- in", the connection is poor on a suburban street, nothing appears to happen,
-- they tap again. Checked in application code that is two reads returning "no
-- open entry" and two writes, and the job is then billed for two people who are
-- one person. Postgres refuses the second row regardless of how the two requests
-- interleave.
--
-- Scoped to the person rather than to the job on purpose: being clocked into two
-- jobs at once is the same impossibility as being clocked into one twice, and
-- catching it is how somebody discovers they never clocked out of this morning's
-- job before driving to the afternoon's.
--
-- Prisma cannot express a partial index, so it is written here by hand — and
-- because a later `prisma migrate dev` would see an index the schema does not
-- mention and offer to drop it, `npm run db:check-constraints` asserts it still
-- exists. Losing it fails a deploy instead of quietly doubling a timesheet.
CREATE UNIQUE INDEX "time_entries_one_open_per_person"
    ON "time_entries" ("organizationId", "userId")
    WHERE "endedAt" IS NULL;

-- AddForeignKey
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- The composite key, as everywhere else: (organizationId, jobId) rather than
-- jobId alone, so the database itself refuses an entry pointing at another
-- business's job. See the note at the top of schema.prisma.
-- AddForeignKey
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_organizationId_jobId_fkey" FOREIGN KEY ("organizationId", "jobId") REFERENCES "jobs"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
