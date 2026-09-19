-- AlterTable
ALTER TABLE "ContentItem" ADD COLUMN     "format" TEXT NOT NULL DEFAULT 'post',
ADD COLUMN     "videoGeneratedAt" TIMESTAMP(3),
ADD COLUMN     "videoUrl" TEXT;
