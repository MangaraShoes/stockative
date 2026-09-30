-- Extras deixam de ser posts a mais por mês e viram crédito avulso de
-- imagem/vídeo (Patricia, 30/09/2026: "não queremos cobrar por carrossel ou
-- reel mas sim por extra imagem e extra vídeo"). A compra fica em
-- ImageCreditPurchase (já existia desde o init, nunca usada), agora com
-- taskType pra servir imagem E vídeo.
ALTER TABLE "Shop" DROP COLUMN "extraCarouselsPerMonth",
DROP COLUMN "extraReelsPerMonth";

ALTER TABLE "ImageCreditPurchase" ADD COLUMN "taskType" TEXT NOT NULL DEFAULT 'image';
CREATE INDEX "ImageCreditPurchase_shopId_taskType_purchasedAt_idx" ON "ImageCreditPurchase"("shopId", "taskType", "purchasedAt");
