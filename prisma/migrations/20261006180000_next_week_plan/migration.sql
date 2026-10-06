-- AlterTable
ALTER TABLE "Shop" ADD COLUMN "nextWeekObjectives" JSONB,
ADD COLUMN "nextWeekPlanConfirmedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "ContentItem" ADD COLUMN "objectiveSource" TEXT;
