-- AlterTable
ALTER TABLE "OAuthTransaction" ADD COLUMN     "pendingAccessToken" TEXT,
ADD COLUMN     "pendingTokenExpiresAt" TIMESTAMP(3);
