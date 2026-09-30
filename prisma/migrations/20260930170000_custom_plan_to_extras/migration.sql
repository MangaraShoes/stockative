-- "Custom" deixa de ser um plano próprio e vira Extras, um add-on mensal
-- em cima do Basic/Grow/Plus (Patricia, 30/09/2026). Lojas que estavam no
-- "custom" voltam pro Basic sem extras — os números antigos eram o TOTAL
-- mensal do plano, não um adicional, então reaproveitá-los como extra
-- dobraria o volume dessas lojas sem ninguém ter pedido.
-- Os campos só eram lidos com plan = 'custom', então zerar em todas as
-- lojas não muda nada pra quem estava em Basic/Grow/Plus.
UPDATE "Shop" SET "plan" = 'basic' WHERE "plan" = 'custom';

ALTER TABLE "Shop" RENAME COLUMN "customPostsPerMonth" TO "extraCarouselsPerMonth";
ALTER TABLE "Shop" RENAME COLUMN "customReelsPerMonth" TO "extraReelsPerMonth";

UPDATE "Shop" SET "extraCarouselsPerMonth" = 0, "extraReelsPerMonth" = 0;
ALTER TABLE "Shop" ALTER COLUMN "extraCarouselsPerMonth" SET DEFAULT 0,
ALTER COLUMN "extraCarouselsPerMonth" SET NOT NULL,
ALTER COLUMN "extraReelsPerMonth" SET DEFAULT 0,
ALTER COLUMN "extraReelsPerMonth" SET NOT NULL;
