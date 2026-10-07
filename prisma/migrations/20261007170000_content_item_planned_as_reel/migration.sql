-- AlterTable
ALTER TABLE "ContentItem" ADD COLUMN "plannedAsReel" BOOLEAN NOT NULL DEFAULT false;

-- Reels já existentes: remontam o vídeo quando a imagem muda.
UPDATE "ContentItem" SET "plannedAsReel" = true WHERE "format" = 'reel';
