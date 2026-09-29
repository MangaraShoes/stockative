-- AlterTable
ALTER TABLE "ContentItem" ADD COLUMN     "publishAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "nextRetryAt" TIMESTAMP(3);
