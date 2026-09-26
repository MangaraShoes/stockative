-- AlterTable
ALTER TABLE "ContentItem" ADD COLUMN     "youtubeExternalPostId" TEXT;

-- AlterTable
ALTER TABLE "SocialAccount" ADD COLUMN     "youtubeChannelId" TEXT,
ADD COLUMN     "youtubeChannelTitle" TEXT;
