-- CreateTable
CREATE TABLE "Shop" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shopifyDomain" TEXT NOT NULL,
    "accessToken" TEXT NOT NULL,
    "plan" TEXT NOT NULL DEFAULT 'starter',
    "installedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "uninstalledAt" DATETIME
);

-- CreateTable
CREATE TABLE "SocialAccount" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shopId" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "accessToken" TEXT NOT NULL,
    "expiresAt" DATETIME,
    "igBusinessAccountId" TEXT,
    "fbPageId" TEXT,
    CONSTRAINT "SocialAccount_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ProductCache" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shopId" TEXT NOT NULL,
    "shopifyProductId" TEXT NOT NULL,
    "shopifyVariantId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "price" REAL NOT NULL,
    "compareAtPrice" REAL,
    "inventoryQuantity" INTEGER NOT NULL DEFAULT 0,
    "productType" TEXT,
    "tags" TEXT,
    "collections" TEXT,
    "imageUrl" TEXT,
    "status" TEXT NOT NULL,
    "shopifyCreatedAt" DATETIME,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ProductCache_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CommerceSignal" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "productId" TEXT NOT NULL,
    "unitsSold7d" INTEGER NOT NULL DEFAULT 0,
    "unitsSold30d" INTEGER NOT NULL DEFAULT 0,
    "revenue30d" REAL NOT NULL DEFAULT 0,
    "salesVelocity" REAL NOT NULL DEFAULT 0,
    "daysSinceLastSale" INTEGER,
    "inventoryAgeDays" INTEGER,
    "margin" REAL,
    "computedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CommerceSignal_productId_fkey" FOREIGN KEY ("productId") REFERENCES "ProductCache" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ContentItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shopId" TEXT NOT NULL,
    "productId" TEXT,
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
    CONSTRAINT "ContentItem_creativeAssetId_fkey" FOREIGN KEY ("creativeAssetId") REFERENCES "CreativeAsset" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TrackedLink" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "contentItemId" TEXT NOT NULL,
    "shortCode" TEXT NOT NULL,
    "utmParams" JSONB,
    "clickCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TrackedLink_contentItemId_fkey" FOREIGN KEY ("contentItemId") REFERENCES "ContentItem" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PerformanceSignal" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "contentItemId" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "reach" INTEGER,
    "likes" INTEGER,
    "comments" INTEGER,
    "saves" INTEGER,
    "shares" INTEGER,
    "clicks" INTEGER,
    "productPageVisits" INTEGER,
    "addToCart" INTEGER,
    "orders" INTEGER,
    "revenue" REAL,
    "capturedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PerformanceSignal_contentItemId_fkey" FOREIGN KEY ("contentItemId") REFERENCES "ContentItem" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "GenerationLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "contentItemId" TEXT,
    "taskType" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "tokensUsed" INTEGER,
    "costEstimate" REAL,
    "passedFidelityCheck" BOOLEAN,
    "countsAsCredit" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "GenerationLog_contentItemId_fkey" FOREIGN KEY ("contentItemId") REFERENCES "ContentItem" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CreativeAsset" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shopId" TEXT NOT NULL,
    "productId" TEXT,
    "imageUrl" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "generationLogId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CreativeAsset_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "CreativeAsset_productId_fkey" FOREIGN KEY ("productId") REFERENCES "ProductCache" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "CreativeAsset_generationLogId_fkey" FOREIGN KEY ("generationLogId") REFERENCES "GenerationLog" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ImageCreditPurchase" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shopId" TEXT NOT NULL,
    "creditsPurchased" INTEGER NOT NULL,
    "pricePaid" REAL NOT NULL,
    "purchasedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ImageCreditPurchase_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CompetitorAccount" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shopId" TEXT NOT NULL,
    "instagramUsername" TEXT NOT NULL,
    "addedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CompetitorAccount_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CompetitorPost" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "competitorAccountId" TEXT NOT NULL,
    "igMediaId" TEXT NOT NULL,
    "caption" TEXT,
    "mediaType" TEXT,
    "likeCount" INTEGER,
    "commentCount" INTEGER,
    "postedAt" DATETIME,
    "permalink" TEXT,
    "syncedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CompetitorPost_competitorAccountId_fkey" FOREIGN KEY ("competitorAccountId") REFERENCES "CompetitorAccount" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "Shop_shopifyDomain_key" ON "Shop"("shopifyDomain");

-- CreateIndex
CREATE INDEX "SocialAccount_shopId_idx" ON "SocialAccount"("shopId");

-- CreateIndex
CREATE INDEX "ProductCache_shopId_idx" ON "ProductCache"("shopId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductCache_shopId_shopifyProductId_key" ON "ProductCache"("shopId", "shopifyProductId");

-- CreateIndex
CREATE UNIQUE INDEX "CommerceSignal_productId_key" ON "CommerceSignal"("productId");

-- CreateIndex
CREATE INDEX "ContentItem_shopId_idx" ON "ContentItem"("shopId");

-- CreateIndex
CREATE INDEX "ContentItem_status_idx" ON "ContentItem"("status");

-- CreateIndex
CREATE UNIQUE INDEX "TrackedLink_contentItemId_key" ON "TrackedLink"("contentItemId");

-- CreateIndex
CREATE UNIQUE INDEX "TrackedLink_shortCode_key" ON "TrackedLink"("shortCode");

-- CreateIndex
CREATE INDEX "PerformanceSignal_contentItemId_idx" ON "PerformanceSignal"("contentItemId");

-- CreateIndex
CREATE INDEX "GenerationLog_contentItemId_idx" ON "GenerationLog"("contentItemId");

-- CreateIndex
CREATE UNIQUE INDEX "CreativeAsset_generationLogId_key" ON "CreativeAsset"("generationLogId");

-- CreateIndex
CREATE INDEX "CreativeAsset_shopId_idx" ON "CreativeAsset"("shopId");

-- CreateIndex
CREATE INDEX "ImageCreditPurchase_shopId_idx" ON "ImageCreditPurchase"("shopId");

-- CreateIndex
CREATE INDEX "CompetitorAccount_shopId_idx" ON "CompetitorAccount"("shopId");

-- CreateIndex
CREATE INDEX "CompetitorPost_competitorAccountId_idx" ON "CompetitorPost"("competitorAccountId");
