-- Where the crew are right now, and only right now.
--
-- One table, one row per person per workspace, overwritten in place. The design
-- is almost entirely about what it refuses to be able to do.
--
-- There is no history. A position replaces the previous position, so this table
-- can answer "where is Sam now?" and cannot answer "where was Sam at two o'clock
-- last Thursday". The second question is the one a feature like this quietly
-- grows into, and the absence of an append-only table is what makes it
-- unanswerable rather than merely discouraged. The unique index on
-- (organizationId, userId) is what holds that: even a future caller that forgot
-- and used create() instead of upsert() would be refused a second row.
--
-- There is no position outside work. Rows are written only while the person has
-- an open time entry, and clocking out deletes theirs. The application enforces
-- the first half and the second is a delete in the same code path as the
-- clock-out, so an ordinary working day leaves nothing behind at the end of it.
--
-- `accuracyMetres` rides along with the coordinates because a position without
-- it is not a fact — the same rule the clock-in pins follow. A fix good to 1.5km
-- is the phone saying "somewhere in this town", and a screen that drew a dot for
-- it would be inventing a certainty the hardware never offered.

-- CreateTable
CREATE TABLE "crew_positions" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "accuracyMetres" INTEGER,
    "jobId" TEXT,
    -- When the phone took the reading, not when the row was written: a pocket
    -- wakes up and posts a fix a minute old, and calling that "just now" would
    -- overstate what is known.
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crew_positions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "crew_positions_organizationId_recordedAt_idx" ON "crew_positions"("organizationId", "recordedAt");

-- The row that makes a trail impossible.
-- CreateIndex
CREATE UNIQUE INDEX "crew_positions_organizationId_userId_key" ON "crew_positions"("organizationId", "userId");

-- AddForeignKey
ALTER TABLE "crew_positions" ADD CONSTRAINT "crew_positions_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crew_positions" ADD CONSTRAINT "crew_positions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
