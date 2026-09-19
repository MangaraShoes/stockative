-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "isOnline" BOOLEAN NOT NULL DEFAULT false,
    "scope" TEXT,
    "expires" TIMESTAMP(3),
    "accessToken" TEXT NOT NULL,
    "userId" BIGINT,
    "firstName" TEXT,
    "lastName" TEXT,
    "email" TEXT,
    "accountOwner" BOOLEAN NOT NULL DEFAULT false,
    "locale" TEXT,
    "collaborator" BOOLEAN DEFAULT false,
    "emailVerified" BOOLEAN DEFAULT false,
    "refreshToken" TEXT,
    "refreshTokenExpires" TIMESTAMP(3),

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Shop" (
    "id" TEXT NOT NULL,
    "shopifyDomain" TEXT NOT NULL,
    "accessToken" TEXT NOT NULL,
    "plan" TEXT NOT NULL DEFAULT 'starter',
    "installedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "uninstalledAt" TIMESTAMP(3),
    "brandDescription" TEXT,
    "brandTone" TEXT,
    "brandAvoid" TEXT,
    "languageConfirmed" BOOLEAN NOT NULL DEFAULT false,
    "competitorsSkipped" BOOLEAN NOT NULL DEFAULT false,
    "logoUrl" TEXT,
    "applyLogoOverlay" BOOLEAN NOT NULL DEFAULT false,
    "ianaTimezone" TEXT,
    "lastWeeklyPlanGeneratedAt" TIMESTAMP(3),
    "contentLanguagePrimary" TEXT NOT NULL DEFAULT 'en',
    "contentLanguageSecondary" TEXT,

    CONSTRAINT "Shop_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContentPillar" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "function" TEXT NOT NULL,
    "attractsAudience" TEXT NOT NULL,
    "problemExplored" TEXT NOT NULL,
    "promise" TEXT NOT NULL,
    "idealFormat" TEXT NOT NULL,
    "cta" TEXT NOT NULL,
    "growthCategory" TEXT NOT NULL,
    "targetSharePct" DOUBLE PRECISION NOT NULL,
    "drivesReach" BOOLEAN NOT NULL DEFAULT false,
    "drivesFollowers" BOOLEAN NOT NULL DEFAULT false,
    "drivesPurchase" BOOLEAN NOT NULL DEFAULT false,
    "postLess" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContentPillar_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SocialAccount" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "accessToken" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "igBusinessAccountId" TEXT,
    "fbPageId" TEXT,
    "refreshToken" TEXT,
    "pinterestUserId" TEXT,
    "pinterestUsername" TEXT,

    CONSTRAINT "SocialAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PinterestBoard" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "pinterestBoardId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PinterestBoard_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductCache" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "shopifyProductId" TEXT NOT NULL,
    "shopifyVariantId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "price" DOUBLE PRECISION NOT NULL,
    "compareAtPrice" DOUBLE PRECISION,
    "inventoryQuantity" INTEGER NOT NULL DEFAULT 0,
    "productType" TEXT,
    "tags" TEXT,
    "collections" TEXT,
    "imageUrl" TEXT,
    "productUrl" TEXT,
    "status" TEXT NOT NULL,
    "shopifyCreatedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductCache_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductImage" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "shopifyImageId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductImage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommerceSignal" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "unitsSold7d" INTEGER NOT NULL DEFAULT 0,
    "unitsSold30d" INTEGER NOT NULL DEFAULT 0,
    "revenue30d" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "salesVelocity" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "daysSinceLastSale" INTEGER,
    "inventoryAgeDays" INTEGER,
    "margin" DOUBLE PRECISION,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommerceSignal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContentItem" (
    "id" TEXT NOT NULL,
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
    "weekBatchId" TEXT,
    "scheduledAt" TIMESTAMP(3),
    "publishedAt" TIMESTAMP(3),
    "externalPostId" TEXT,
    "storyExternalPostId" TEXT,
    "facebookExternalPostId" TEXT,
    "pinterestExternalPostId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContentItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContentItemImage" (
    "id" TEXT NOT NULL,
    "contentItemId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "productImageId" TEXT,
    "creativeAssetId" TEXT,

    CONSTRAINT "ContentItemImage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrackedLink" (
    "id" TEXT NOT NULL,
    "contentItemId" TEXT NOT NULL,
    "shortCode" TEXT NOT NULL,
    "utmParams" JSONB,
    "clickCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TrackedLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PerformanceSignal" (
    "id" TEXT NOT NULL,
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
    "revenue" DOUBLE PRECISION,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PerformanceSignal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GenerationLog" (
    "id" TEXT NOT NULL,
    "contentItemId" TEXT,
    "taskType" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "tokensUsed" INTEGER,
    "costEstimate" DOUBLE PRECISION,
    "passedFidelityCheck" BOOLEAN,
    "passedCompositionCheck" BOOLEAN,
    "countsAsCredit" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "shopId" TEXT,
    "productId" TEXT,
    "category" TEXT,
    "campaignId" TEXT,
    "requestedAction" TEXT,
    "requestedEnvironment" TEXT,
    "requestedFraming" TEXT,
    "requestedLight" TEXT,
    "observedAction" TEXT,
    "observedEnvironment" TEXT,
    "observedFraming" TEXT,
    "observedLight" TEXT,

    CONSTRAINT "GenerationLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreativeAsset" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "productId" TEXT,
    "imageUrl" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "generationLogId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CreativeAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImageCreditPurchase" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "creditsPurchased" INTEGER NOT NULL,
    "pricePaid" DOUBLE PRECISION NOT NULL,
    "purchasedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImageCreditPurchase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompetitorAccount" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "instagramUsername" TEXT NOT NULL,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "biography" TEXT,
    "website" TEXT,

    CONSTRAINT "CompetitorAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompetitorPost" (
    "id" TEXT NOT NULL,
    "competitorAccountId" TEXT NOT NULL,
    "igMediaId" TEXT NOT NULL,
    "caption" TEXT,
    "mediaType" TEXT,
    "likeCount" INTEGER,
    "commentCount" INTEGER,
    "postedAt" TIMESTAMP(3),
    "permalink" TEXT,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CompetitorPost_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Shop_shopifyDomain_key" ON "Shop"("shopifyDomain");

-- CreateIndex
CREATE INDEX "ContentPillar_shopId_idx" ON "ContentPillar"("shopId");

-- CreateIndex
CREATE INDEX "SocialAccount_shopId_idx" ON "SocialAccount"("shopId");

-- CreateIndex
CREATE UNIQUE INDEX "SocialAccount_shopId_platform_key" ON "SocialAccount"("shopId", "platform");

-- CreateIndex
CREATE INDEX "PinterestBoard_shopId_idx" ON "PinterestBoard"("shopId");

-- CreateIndex
CREATE UNIQUE INDEX "PinterestBoard_shopId_category_key" ON "PinterestBoard"("shopId", "category");

-- CreateIndex
CREATE INDEX "ProductCache_shopId_idx" ON "ProductCache"("shopId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductCache_shopId_shopifyProductId_key" ON "ProductCache"("shopId", "shopifyProductId");

-- CreateIndex
CREATE INDEX "ProductImage_productId_idx" ON "ProductImage"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductImage_productId_shopifyImageId_key" ON "ProductImage"("productId", "shopifyImageId");

-- CreateIndex
CREATE UNIQUE INDEX "CommerceSignal_productId_key" ON "CommerceSignal"("productId");

-- CreateIndex
CREATE INDEX "ContentItem_shopId_idx" ON "ContentItem"("shopId");

-- CreateIndex
CREATE INDEX "ContentItem_status_idx" ON "ContentItem"("status");

-- CreateIndex
CREATE INDEX "ContentItem_weekBatchId_idx" ON "ContentItem"("weekBatchId");

-- CreateIndex
CREATE INDEX "ContentItemImage_contentItemId_idx" ON "ContentItemImage"("contentItemId");

-- CreateIndex
CREATE INDEX "ContentItemImage_productImageId_idx" ON "ContentItemImage"("productImageId");

-- CreateIndex
CREATE INDEX "ContentItemImage_creativeAssetId_idx" ON "ContentItemImage"("creativeAssetId");

-- CreateIndex
CREATE UNIQUE INDEX "TrackedLink_contentItemId_key" ON "TrackedLink"("contentItemId");

-- CreateIndex
CREATE UNIQUE INDEX "TrackedLink_shortCode_key" ON "TrackedLink"("shortCode");

-- CreateIndex
CREATE INDEX "PerformanceSignal_contentItemId_idx" ON "PerformanceSignal"("contentItemId");

-- CreateIndex
CREATE INDEX "GenerationLog_contentItemId_idx" ON "GenerationLog"("contentItemId");

-- CreateIndex
CREATE INDEX "GenerationLog_shopId_idx" ON "GenerationLog"("shopId");

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

-- AddForeignKey
ALTER TABLE "ContentPillar" ADD CONSTRAINT "ContentPillar_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocialAccount" ADD CONSTRAINT "SocialAccount_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PinterestBoard" ADD CONSTRAINT "PinterestBoard_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductCache" ADD CONSTRAINT "ProductCache_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductImage" ADD CONSTRAINT "ProductImage_productId_fkey" FOREIGN KEY ("productId") REFERENCES "ProductCache"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommerceSignal" ADD CONSTRAINT "CommerceSignal_productId_fkey" FOREIGN KEY ("productId") REFERENCES "ProductCache"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentItem" ADD CONSTRAINT "ContentItem_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentItem" ADD CONSTRAINT "ContentItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "ProductCache"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentItem" ADD CONSTRAINT "ContentItem_contentPillarId_fkey" FOREIGN KEY ("contentPillarId") REFERENCES "ContentPillar"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentItem" ADD CONSTRAINT "ContentItem_creativeAssetId_fkey" FOREIGN KEY ("creativeAssetId") REFERENCES "CreativeAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentItemImage" ADD CONSTRAINT "ContentItemImage_contentItemId_fkey" FOREIGN KEY ("contentItemId") REFERENCES "ContentItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentItemImage" ADD CONSTRAINT "ContentItemImage_productImageId_fkey" FOREIGN KEY ("productImageId") REFERENCES "ProductImage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentItemImage" ADD CONSTRAINT "ContentItemImage_creativeAssetId_fkey" FOREIGN KEY ("creativeAssetId") REFERENCES "CreativeAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrackedLink" ADD CONSTRAINT "TrackedLink_contentItemId_fkey" FOREIGN KEY ("contentItemId") REFERENCES "ContentItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PerformanceSignal" ADD CONSTRAINT "PerformanceSignal_contentItemId_fkey" FOREIGN KEY ("contentItemId") REFERENCES "ContentItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GenerationLog" ADD CONSTRAINT "GenerationLog_contentItemId_fkey" FOREIGN KEY ("contentItemId") REFERENCES "ContentItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreativeAsset" ADD CONSTRAINT "CreativeAsset_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreativeAsset" ADD CONSTRAINT "CreativeAsset_productId_fkey" FOREIGN KEY ("productId") REFERENCES "ProductCache"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreativeAsset" ADD CONSTRAINT "CreativeAsset_generationLogId_fkey" FOREIGN KEY ("generationLogId") REFERENCES "GenerationLog"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImageCreditPurchase" ADD CONSTRAINT "ImageCreditPurchase_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompetitorAccount" ADD CONSTRAINT "CompetitorAccount_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompetitorPost" ADD CONSTRAINT "CompetitorPost_competitorAccountId_fkey" FOREIGN KEY ("competitorAccountId") REFERENCES "CompetitorAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
