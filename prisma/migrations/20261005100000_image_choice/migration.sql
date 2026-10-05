-- AlterTable
ALTER TABLE "ContentItem" ADD COLUMN "imageRegenerationCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "ContentItem" ADD COLUMN "previousHeroAssetId" TEXT;

-- AlterTable
ALTER TABLE "ProductImage" ADD COLUMN "shotType" TEXT;
