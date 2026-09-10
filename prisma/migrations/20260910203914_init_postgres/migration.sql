-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "studioName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "storeReceiptImages" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expenses" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "merchant" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "taxCents" INTEGER,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "spentAt" TIMESTAMP(3) NOT NULL,
    "category" TEXT,
    "categoryConfidence" DOUBLE PRECISION,
    "categorySource" TEXT,
    "notes" TEXT,
    "rawText" TEXT,
    "imageKey" TEXT,
    "imageMimeType" TEXT,
    "imageBytes" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "expenses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expense_lines" (
    "id" TEXT NOT NULL,
    "expenseId" TEXT NOT NULL,
    "label" TEXT,
    "amountCents" INTEGER NOT NULL,
    "category" TEXT NOT NULL,
    "categoryConfidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "categorySource" TEXT NOT NULL DEFAULT 'auto',
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "expense_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "expenses_userId_spentAt_idx" ON "expenses"("userId", "spentAt");

-- CreateIndex
CREATE INDEX "expense_lines_expenseId_idx" ON "expense_lines"("expenseId");

-- CreateIndex
CREATE INDEX "expense_lines_category_idx" ON "expense_lines"("category");

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense_lines" ADD CONSTRAINT "expense_lines_expenseId_fkey" FOREIGN KEY ("expenseId") REFERENCES "expenses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
