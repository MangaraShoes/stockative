-- CreateTable
CREATE TABLE "ProductImage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "productId" TEXT NOT NULL,
    "shopifyImageId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProductImage_productId_fkey" FOREIGN KEY ("productId") REFERENCES "ProductCache" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ContentItemImage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "contentItemId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "productImageId" TEXT,
    "creativeAssetId" TEXT,
    CONSTRAINT "ContentItemImage_contentItemId_fkey" FOREIGN KEY ("contentItemId") REFERENCES "ContentItem" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ContentItemImage_productImageId_fkey" FOREIGN KEY ("productImageId") REFERENCES "ProductImage" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "ContentItemImage_creativeAssetId_fkey" FOREIGN KEY ("creativeAssetId") REFERENCES "CreativeAsset" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "ProductImage_productId_idx" ON "ProductImage"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductImage_productId_shopifyImageId_key" ON "ProductImage"("productId", "shopifyImageId");

-- CreateIndex
CREATE INDEX "ContentItemImage_contentItemId_idx" ON "ContentItemImage"("contentItemId");

-- CreateIndex
CREATE INDEX "ContentItemImage_productImageId_idx" ON "ContentItemImage"("productImageId");

-- CreateIndex
CREATE INDEX "ContentItemImage_creativeAssetId_idx" ON "ContentItemImage"("creativeAssetId");
