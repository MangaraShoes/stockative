-- AlterTable
ALTER TABLE "Shop" ADD COLUMN     "heygenApiKey" TEXT,
ADD COLUMN     "heygenAvatarId" TEXT,
ADD COLUMN     "heygenVoiceId" TEXT;

-- AlterTable
ALTER TABLE "ContentItem" ADD COLUMN     "avatarScript" TEXT,
ADD COLUMN     "avatarVideoJobId" TEXT,
ADD COLUMN     "avatarVideoStatus" TEXT,
ADD COLUMN     "avatarVideoError" TEXT,
ADD COLUMN     "avatarVideoAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "avatarVideoRequestedAt" TIMESTAMP(3),
ADD COLUMN     "requiresApproval" BOOLEAN NOT NULL DEFAULT false;
