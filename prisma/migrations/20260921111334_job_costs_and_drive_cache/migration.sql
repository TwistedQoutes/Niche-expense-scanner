-- What a job costs, as opposed to what it was sold for.
--
-- Four columns and no new tables, because the data is nearly all here already:
-- a job records when it started and finished, a property records where it is,
-- and the pricing engine already knows what the customer was charged. What was
-- missing was the other half of the arithmetic — what the business pays.
--
--  * memberships.hourlyRateCents      what this person is paid, per hour. On the
--                                     membership, not the user: one person can
--                                     work for two businesses at two rates.
--  * organizations.fuel…/vehicleMpg…  pump price and economy, so miles become
--                                     money without anybody keeping receipts.
--  * properties.drive…                the measured road distance from the shop,
--                                     kept because Google bills per request and
--                                     a road does not move between quotes.
--
-- Every column is nullable on purpose. Null means "nobody has said", and the
-- cost view leaves that part out and says so, rather than counting it as zero —
-- an unpriced hour counted as free is profit that is not there.

-- AlterTable
ALTER TABLE "memberships" ADD COLUMN     "hourlyRateCents" INTEGER;

-- AlterTable
ALTER TABLE "organizations" ADD COLUMN     "fuelPricePerGallonCents" INTEGER,
ADD COLUMN     "vehicleMpgMilli" INTEGER;

-- AlterTable
ALTER TABLE "properties" ADD COLUMN     "driveMeasuredAt" TIMESTAMP(3),
ADD COLUMN     "driveMeasuredFrom" TEXT,
ADD COLUMN     "driveMilesFromBase" INTEGER,
ADD COLUMN     "driveMinutesFromBase" INTEGER;
