-- AlterTable
ALTER TABLE "Shop" ADD COLUMN "publishingPausedAt" TIMESTAMP(3),
ADD COLUMN "requireApproval" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "postingScheduleMode" TEXT NOT NULL DEFAULT 'auto',
ADD COLUMN "customPostingSchedule" JSONB,
ADD COLUMN "notificationEmail" TEXT,
ADD COLUMN "notifyWeeklyPlan" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "notifyPublishFailed" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "notifyPublished" BOOLEAN NOT NULL DEFAULT false;
