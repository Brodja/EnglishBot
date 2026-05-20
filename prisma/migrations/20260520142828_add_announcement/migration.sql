-- CreateTable
CREATE TABLE "announcements" (
    "changelogId" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentBy" BIGINT NOT NULL,
    "recipients" INTEGER NOT NULL,
    "failures" INTEGER NOT NULL,

    CONSTRAINT "announcements_pkey" PRIMARY KEY ("changelogId")
);
