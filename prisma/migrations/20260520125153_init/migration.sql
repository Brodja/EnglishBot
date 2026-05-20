-- CreateTable
CREATE TABLE "users" (
    "telegramId" BIGINT NOT NULL,
    "firstName" TEXT,
    "lastName" TEXT,
    "username" TEXT,
    "googleSheetsUrl" TEXT,
    "lastSyncAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("telegramId")
);

-- CreateTable
CREATE TABLE "words" (
    "id" TEXT NOT NULL,
    "userId" BIGINT NOT NULL,
    "english" TEXT NOT NULL,
    "translation" TEXT NOT NULL,
    "passedEn" BOOLEAN NOT NULL DEFAULT false,
    "passedUk" BOOLEAN NOT NULL DEFAULT false,
    "learned" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "words_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "words_userId_learned_passedEn_idx" ON "words"("userId", "learned", "passedEn");

-- CreateIndex
CREATE INDEX "words_userId_learned_passedUk_idx" ON "words"("userId", "learned", "passedUk");

-- CreateIndex
CREATE UNIQUE INDEX "words_userId_english_key" ON "words"("userId", "english");

-- AddForeignKey
ALTER TABLE "words" ADD CONSTRAINT "words_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("telegramId") ON DELETE CASCADE ON UPDATE CASCADE;
