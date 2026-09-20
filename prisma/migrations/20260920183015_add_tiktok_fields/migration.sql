-- AlterTable
ALTER TABLE "ContentItem" ADD COLUMN     "tiktokExternalPostId" TEXT;

-- AlterTable
ALTER TABLE "SocialAccount" ADD COLUMN     "tiktokOpenId" TEXT,
ADD COLUMN     "tiktokUsername" TEXT;
