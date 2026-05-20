-- 1) Add new columns (defaults so existing rows stay valid)
ALTER TABLE "words"
  ADD COLUMN "learnedEn"     BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "learnedUk"     BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "reviewCountEn" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "reviewCountUk" INTEGER NOT NULL DEFAULT 0;

-- 2) Backfill: existing "learned = true" rows map to EN direction only.
--    UK direction starts fresh so user can re-practice "translation -> english".
UPDATE "words" SET "learnedEn" = "learned" WHERE "learned" = true;

-- 3) Drop old indexes that reference "learned"
DROP INDEX "words_userId_learned_passedEn_idx";
DROP INDEX "words_userId_learned_passedUk_idx";

-- 4) Drop old column
ALTER TABLE "words" DROP COLUMN "learned";

-- 5) New indexes
CREATE INDEX "words_userId_learnedEn_passedEn_idx"      ON "words" ("userId", "learnedEn", "passedEn");
CREATE INDEX "words_userId_learnedUk_passedUk_idx"      ON "words" ("userId", "learnedUk", "passedUk");
CREATE INDEX "words_userId_learnedEn_reviewCountEn_idx" ON "words" ("userId", "learnedEn", "reviewCountEn");
CREATE INDEX "words_userId_learnedUk_reviewCountUk_idx" ON "words" ("userId", "learnedUk", "reviewCountUk");
