-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Shop" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shopifyDomain" TEXT NOT NULL,
    "accessToken" TEXT NOT NULL,
    "plan" TEXT NOT NULL DEFAULT 'starter',
    "installedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "uninstalledAt" DATETIME,
    "brandDescription" TEXT,
    "brandTone" TEXT,
    "brandAvoid" TEXT,
    "logoUrl" TEXT,
    "applyLogoOverlay" BOOLEAN NOT NULL DEFAULT false,
    "contentLanguagePrimary" TEXT NOT NULL DEFAULT 'en',
    "contentLanguageSecondary" TEXT
);
INSERT INTO "new_Shop" ("accessToken", "applyLogoOverlay", "brandAvoid", "brandDescription", "brandTone", "id", "installedAt", "logoUrl", "plan", "shopifyDomain", "uninstalledAt") SELECT "accessToken", "applyLogoOverlay", "brandAvoid", "brandDescription", "brandTone", "id", "installedAt", "logoUrl", "plan", "shopifyDomain", "uninstalledAt" FROM "Shop";
DROP TABLE "Shop";
ALTER TABLE "new_Shop" RENAME TO "Shop";
CREATE UNIQUE INDEX "Shop_shopifyDomain_key" ON "Shop"("shopifyDomain");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
