#!/usr/bin/env node
/**
 * Seeds a demo account with a few months of realistic expenses.
 *
 * Run with:  npm run db:seed
 * Sign in as: demo@studio.test / tattoo-demo-2026
 *
 * Idempotent — it clears and recreates the demo user's expenses, so it is safe
 * to re-run while iterating on the dashboard. It refuses to run in production.
 */
import process from 'node:process';

import bcrypt from 'bcryptjs';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { PrismaClient } from '@prisma/client';

if (process.env.NODE_ENV === 'production') {
  console.error('[seed] refusing to seed a production database.');
  process.exit(1);
}

const DEMO_EMAIL = 'demo@studio.test';
const DEMO_PASSWORD = 'tattoo-demo-2026';

/** [daysAgo, merchant, dollars, category, notes] */
const EXPENSES = [
  [2, 'Kingpin Tattoo Supply', 143.05, 'NEEDLES', '2x Cartridge needles 3RL, gloves'],
  [3, 'Eternal Ink', 218.4, 'INK', 'Colour restock — Chukes set'],
  [5, 'Blackwork Collective', 900, 'STUDIO_RENT', 'Booth rent'],
  [6, 'Spirit Master Supply', 46.99, 'STENCIL_TRANSFER', 'Thermal paper, 100 sheets'],
  [8, 'MedSupply Direct', 62.5, 'GLOVES_PPE', 'Nitrile gloves, 4 boxes'],
  [9, 'Saniderm', 124.0, 'AFTERCARE', 'Second skin, 6in roll'],
  [12, 'TatSoul', 1249.0, 'FURNITURE', '370-S client chair'],
  [14, 'Green Soap Co', 38.75, 'STERILISATION', 'Green soap, barrier film'],
  [16, 'Square', 41.2, 'SOFTWARE_FEES', 'Card processing fees'],
  [18, 'State Health Department', 175.0, 'LICENCES_INSURANCE', 'BBP certification renewal'],
  [22, 'Cheyenne', 689.0, 'MACHINES', 'Sol Nova Unlimited'],
  [26, 'Vistaprint', 58.3, 'MARKETING', 'Business cards, 500'],
  [34, 'Philadelphia Tattoo Arts', 450.0, 'TRAVEL_CONVENTIONS', 'Convention booth deposit'],
  [38, 'Kingpin Tattoo Supply', 96.4, 'NEEDLES', 'Bugpin liners'],
  [41, 'Blackwork Collective', 900, 'STUDIO_RENT', 'Booth rent'],
  [44, 'Copic', 74.99, 'ART_SUPPLIES', 'Marker set'],
  [48, 'City Electric', 88.15, 'UTILITIES', 'Studio electricity'],
  [52, 'World Famous Ink', 156.0, 'INK', 'Lining black, 12oz x2'],
  [56, 'Painful Pleasures', 212.85, 'NEEDLES', 'Mixed supply order'],
  [70, 'Blackwork Collective', 900, 'STUDIO_RENT', 'Booth rent'],
];

const adapter = new PrismaBetterSqlite3({ url: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

/** Receipt dates are calendar days, stored at UTC midnight. */
function daysAgoUtc(days) {
  const now = new Date();
  const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  date.setUTCDate(date.getUTCDate() - days);
  return date;
}

async function main() {
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 12);

  const user = await prisma.user.upsert({
    where: { email: DEMO_EMAIL },
    update: { passwordHash },
    create: { email: DEMO_EMAIL, passwordHash, studioName: 'Ink & Iron Studio' },
  });

  await prisma.expense.deleteMany({ where: { userId: user.id } });

  await prisma.expense.createMany({
    data: EXPENSES.map(([days, merchant, dollars, category, notes], index) => ({
      userId: user.id,
      merchant,
      amountCents: Math.round(dollars * 100),
      // Roughly 8% sales tax on physical goods; services and rent have none.
      taxCents: ['STUDIO_RENT', 'SOFTWARE_FEES', 'LICENCES_INSURANCE', 'UTILITIES'].includes(category)
        ? null
        : Math.round(dollars * 100 * 0.08),
      currency: 'USD',
      spentAt: daysAgoUtc(days),
      category,
      // Alternate the source so the dashboard shows both states.
      categoryConfidence: index % 3 === 0 ? 1 : 0.82,
      categorySource: index % 3 === 0 ? 'manual' : 'auto',
      notes,
    })),
  });

  const count = await prisma.expense.count({ where: { userId: user.id } });
  console.log(`[seed] ${count} expenses for ${DEMO_EMAIL}`);
  console.log(`[seed] password: ${DEMO_PASSWORD}`);
}

main()
  .catch((error) => {
    console.error('[seed] failed:', error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
