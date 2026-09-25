-- AlterTable
ALTER TABLE "GenerationLog" ADD COLUMN     "regenerationReason" TEXT;

-- AlterTable
ALTER TABLE "Shop" ADD COLUMN     "customPostsPerMonth" INTEGER,
ADD COLUMN     "customReelsPerMonth" INTEGER,
ADD COLUMN     "imageStylePreference" TEXT,
ALTER COLUMN "plan" SET DEFAULT 'basic';
