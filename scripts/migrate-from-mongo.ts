/**
 * One-off migration: copy users + learnedWords from old MongoDB to PostgreSQL (Prisma).
 *
 * Usage:
 *   MONGO_URI_LEGACY="mongodb://..." npx ts-node scripts/migrate-from-mongo.ts
 *   MONGO_URI_LEGACY="mongodb://..." npx ts-node scripts/migrate-from-mongo.ts --dry-run
 *
 * What it does:
 *   - Connects to old Mongo, reads `users` collection.
 *   - For each user upserts row in Postgres (telegramId, firstName, lastName, username, googleSheetsUrl).
 *   - For each entry in user.learnedWords creates a Word row with learned=true,
 *     translation='' (placeholder — will be filled by next Google Sheets sync).
 *
 * Idempotent: Word is upserted by unique (userId, english). Re-runs are safe.
 *
 * After running: tell users to press "🔄 Синхронізувати" to populate translations.
 */

import 'dotenv/config';
import mongoose from 'mongoose';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

interface LegacyUser {
  telegramId: number;
  firstName?: string;
  lastName?: string;
  username?: string;
  googleSheetsUrl?: string;
  learnedWords?: string[];
}

async function main() {
  const mongoUri = process.env.MONGO_URI_LEGACY;
  if (!mongoUri) {
    console.error('❌ MONGO_URI_LEGACY env var is required');
    process.exit(1);
  }

  const dryRun = process.argv.includes('--dry-run');
  if (dryRun) console.log('🟡 DRY RUN — нічого не пишемо в Postgres');

  // --- Connect Mongo ---
  console.log('🔌 Connecting to legacy Mongo...');
  await mongoose.connect(mongoUri);
  const usersColl = mongoose.connection.db.collection<LegacyUser>('users');

  // --- Connect Postgres ---
  console.log('🔌 Connecting to Postgres...');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
  await prisma.$connect();

  let userCount = 0;
  let wordCount = 0;
  let skippedWords = 0;

  try {
    const cursor = usersColl.find({});
    while (await cursor.hasNext()) {
      const u = await cursor.next();
      if (!u || typeof u.telegramId !== 'number') continue;

      const telegramId = BigInt(u.telegramId);
      const learned = (u.learnedWords ?? []).map((w) => w.toLowerCase().trim()).filter(Boolean);

      console.log(
        `👤 ${u.telegramId} (${u.firstName ?? '?'} ${u.username ? '@' + u.username : ''}) — ${learned.length} learned`,
      );
      userCount++;

      if (dryRun) {
        wordCount += learned.length;
        continue;
      }

      await prisma.user.upsert({
        where: { telegramId },
        create: {
          telegramId,
          firstName: u.firstName,
          lastName: u.lastName,
          username: u.username,
          googleSheetsUrl: u.googleSheetsUrl,
        },
        update: {
          firstName: u.firstName,
          lastName: u.lastName,
          username: u.username,
          googleSheetsUrl: u.googleSheetsUrl,
        },
      });

      for (const english of learned) {
        try {
          await prisma.word.upsert({
            where: { userId_english: { userId: telegramId, english } },
            create: {
              userId: telegramId,
              english,
              translation: '',
              learned: true,
            },
            update: { learned: true },
          });
          wordCount++;
        } catch (e) {
          console.warn(`  ⚠️  skip "${english}":`, (e as Error).message);
          skippedWords++;
        }
      }
    }
  } finally {
    await mongoose.disconnect();
    await prisma.$disconnect();
    await pool.end();
  }

  console.log('');
  console.log(`✅ Done. Users: ${userCount}, learned words: ${wordCount}, skipped: ${skippedWords}`);
  if (wordCount > 0) {
    console.log(
      '💡 Translations are empty. Ask users to press "🔄 Синхронізувати" to fill them from Google Sheets.',
    );
  }
}

main().catch((err) => {
  console.error('❌ Migration failed:', err);
  process.exit(1);
});
