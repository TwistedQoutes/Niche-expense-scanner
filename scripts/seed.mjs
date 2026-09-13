/**
 * Seeds a local database with a workspace you can actually log into.
 *
 * It drives the application's own demo endpoint rather than reimplementing
 * provisioning: the seed and the product then cannot drift, and whatever the demo
 * is tested to produce is exactly what a developer gets. The only thing added
 * afterwards is a password, because the demo deliberately issues one nobody knows.
 *
 *   npm run dev                 # in one terminal, with DEMO_MODE=on
 *   npm run db:seed             # in another
 *
 * Prints the credentials at the end. They are development credentials for a
 * throwaway workspace on your own machine; do not point this at anything real.
 */
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';

const APP_URL = process.env.APP_URL ?? 'http://localhost:3000';
const EMAIL = process.env.SEED_EMAIL ?? 'owner@example.test';
const PASSWORD = process.env.SEED_PASSWORD ?? 'DevPassword1!';

async function main() {
  console.info(`→ asking ${APP_URL} for a seeded workspace…`);

  let response;
  try {
    response = await fetch(`${APP_URL}/api/demo`, { method: 'POST' });
  } catch {
    throw new Error(
      `Could not reach ${APP_URL}. Start the app first (npm run dev), and make sure DEMO_MODE=on is set.`,
    );
  }

  if (response.status === 501) {
    throw new Error('DEMO_MODE is not "on", so there is nothing to seed from. Set it in .env and restart.');
  }

  if (!response.ok) {
    throw new Error(`The demo endpoint answered ${response.status}. Check the server log.`);
  }

  const { organizationId } = await response.json();
  const prisma = new PrismaClient();

  try {
    const membership = await prisma.membership.findFirst({
      where: { organizationId },
      select: { userId: true },
    });

    if (!membership) throw new Error('The seeded workspace has no owner, which should be impossible.');

    /*
     * The demo issues a random password nobody is told, because its only way in
     * is a session cookie. A developer needs to sign back in, so one is set here —
     * and the throwaway address is replaced with something typeable.
     */
    await prisma.user.update({
      where: { id: membership.userId },
      data: {
        email: EMAIL,
        passwordHash: await bcrypt.hash(PASSWORD, 12),
        name: 'Local developer',
        emailVerifiedAt: new Date(),
      },
    });

    // No longer a demo: it is this developer's workspace now, and it should not be
    // swept away by the daily cleanup halfway through an afternoon's work.
    await prisma.organization.update({
      where: { id: organizationId },
      data: { isDemo: false, name: 'Green Thumb Lawn Care (local)' },
    });

    console.info('\n✓ Seeded.\n');
    console.info(`   ${APP_URL}/login`);
    console.info(`   email:    ${EMAIL}`);
    console.info(`   password: ${PASSWORD}\n`);
    console.info('   Development credentials for your own machine. Never reuse them anywhere real.\n');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(`\n✗ ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
