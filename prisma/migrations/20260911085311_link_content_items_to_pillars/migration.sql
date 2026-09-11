-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_ContentItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shopId" TEXT NOT NULL,
    "productId" TEXT,
    "contentPillarId" TEXT,
    "platform" TEXT NOT NULL,
    "commercialObjective" TEXT NOT NULL,
    "decisionBrief" JSONB,
    "captionText" TEXT,
    "hashtags" TEXT,
    "cta" TEXT,
    "creativeAssetId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "scheduledAt" DATETIME,
    "publishedAt" DATETIME,
    "externalPostId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ContentItem_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ContentItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "ProductCache" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "ContentItem_contentPillarId_fkey" FOREIGN KEY ("contentPillarId") REFERENCES "ContentPillar" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "ContentItem_creativeAssetId_fkey" FOREIGN KEY ("creativeAssetId") REFERENCES "CreativeAsset" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_ContentItem" ("captionText", "commercialObjective", "createdAt", "creativeAssetId", "cta", "decisionBrief", "externalPostId", "hashtags", "id", "platform", "productId", "publishedAt", "scheduledAt", "shopId", "status", "updatedAt") SELECT "captionText", "commercialObjective", "createdAt", "creativeAssetId", "cta", "decisionBrief", "externalPostId", "hashtags", "id", "platform", "productId", "publishedAt", "scheduledAt", "shopId", "status", "updatedAt" FROM "ContentItem";
DROP TABLE "ContentItem";
ALTER TABLE "new_ContentItem" RENAME TO "ContentItem";
CREATE INDEX "ContentItem_shopId_idx" ON "ContentItem"("shopId");
CREATE INDEX "ContentItem_status_idx" ON "ContentItem"("status");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
