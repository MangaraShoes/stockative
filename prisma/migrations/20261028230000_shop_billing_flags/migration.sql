-- AlterTable
ALTER TABLE "Shop" ADD COLUMN     "billingRequired" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "subscriptionActive" BOOLEAN NOT NULL DEFAULT false;
