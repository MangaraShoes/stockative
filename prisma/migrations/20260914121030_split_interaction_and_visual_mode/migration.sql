/*
  Warnings:

  - You are about to drop the column `imagingParadigm` on the `ProductCache` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "GenerationLog" ADD COLUMN     "commercialObjective" TEXT,
ADD COLUMN     "fidelityConstraints" JSONB,
ADD COLUMN     "interaction" TEXT,
ADD COLUMN     "strategyVersion" TEXT,
ADD COLUMN     "visualMode" TEXT;

-- AlterTable
ALTER TABLE "ProductCache" DROP COLUMN "imagingParadigm",
ADD COLUMN     "imagingInteractions" TEXT;
