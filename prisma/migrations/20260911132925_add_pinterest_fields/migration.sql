-- AlterTable
ALTER TABLE "SocialAccount" ADD COLUMN "pinterestUserId" TEXT;
ALTER TABLE "SocialAccount" ADD COLUMN "pinterestUsername" TEXT;
ALTER TABLE "SocialAccount" ADD COLUMN "refreshToken" TEXT;

-- CreateTable
CREATE TABLE "PinterestBoard" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shopId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "pinterestBoardId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PinterestBoard_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "PinterestBoard_shopId_idx" ON "PinterestBoard"("shopId");

-- CreateIndex
CREATE UNIQUE INDEX "PinterestBoard_shopId_category_key" ON "PinterestBoard"("shopId", "category");
