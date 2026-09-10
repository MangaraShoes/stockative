-- CreateTable
CREATE TABLE "ContentPillar" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shopId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "function" TEXT NOT NULL,
    "attractsAudience" TEXT NOT NULL,
    "problemExplored" TEXT NOT NULL,
    "promise" TEXT NOT NULL,
    "idealFormat" TEXT NOT NULL,
    "cta" TEXT NOT NULL,
    "growthCategory" TEXT NOT NULL,
    "targetSharePct" REAL NOT NULL,
    "drivesReach" BOOLEAN NOT NULL DEFAULT false,
    "drivesFollowers" BOOLEAN NOT NULL DEFAULT false,
    "drivesPurchase" BOOLEAN NOT NULL DEFAULT false,
    "postLess" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ContentPillar_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "ContentPillar_shopId_idx" ON "ContentPillar"("shopId");
