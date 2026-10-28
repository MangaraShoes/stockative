-- AlterTable
ALTER TABLE "Shop" ADD COLUMN "ignoredSocialPlatforms" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN "socialReminderSentAt" TIMESTAMP(3);
