// Cota mensal de geração/regeneração por tipo (Patricia, 24/09/2026:
// "regeneração espelha a cota de geração, como pool mensal, não 1x por
// post"). Mesma tabela BASIC/GROW/PLUS de planTiers.server.ts, só que em
// volume MENSAL em vez de semanal — 1 crédito = 1 imagem/vídeo ENTREGUE
// (ver GenerationLog.countsAsCredit), então geração e regeneração consomem
// do mesmo pool.
import { isBillingEnabled } from "../billing/subscription.server";
import { reportExtraUsage } from "../billing/appEvents.server";
import prisma from "../../db.server";
import { EXTRA_CREDIT_PRICING } from "./extrasPricing";

export type CreditTaskType = "image" | "video" | "brand_analysis" | "content_pillars";

// Basic: 12 posts/mês = 8 carrossel/post + 4 reels — número fixo da
// hipótese de preço em CLAUDE.md, não derivado por semana×4.33 (daria 9/4).
// Grow (3 imagem + 2 reel/semana) e Plus (4 imagem + 3 reel/semana) ainda
// não têm total mensal fechado por Patricia — usam a mesma cadência
// semanal de planTiers.server.ts × 4.33 semanas/mês, arredondado.
const MONTHLY_LIMITS: Record<string, { image: number; video: number }> = {
  basic: { image: 8, video: 4 },
  grow: { image: 13, video: 9 },
  plus: { image: 17, video: 13 },
};

// Cota de brand_analysis/content_pillars, achado ao vivo, 26/09/2026: essas
// duas rodam ilimitado hoje (Store voice/Content pillars, botão
// "Regenerate" disponível pra sempre, não só no onboarding) — custam bem
// menos por chamada que imagem/reel (~$0,01-0,03 vs ~$0,11-1,99), então o
// teto não precisa escalar por plano como imagem/reel escala: é só pra
// cortar clique repetido sem controle, não pra limitar uso legítimo.
// Números fixos, iguais em qualquer plano (Basic/Grow/Plus), crédito
// extra comprado não mexe neles.
const FLAT_MONTHLY_LIMITS: Record<"brand_analysis" | "content_pillars", number> = {
  brand_analysis: 15,
  content_pillars: 10,
};

type ShopPlanFields = {
  plan: string;
};

export function getMonthlyLimit(shop: ShopPlanFields, taskType: CreditTaskType): number {
  if (taskType === "brand_analysis" || taskType === "content_pillars") {
    return FLAT_MONTHLY_LIMITS[taskType];
  }
  return (MONTHLY_LIMITS[shop.plan] ?? MONTHLY_LIMITS.basic)[taskType];
}

function startOfCurrentMonth(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

export async function getMonthlyUsage(shopId: string, taskType: CreditTaskType): Promise<number> {
  return prisma.generationLog.count({
    where: {
      shopId,
      taskType,
      countsAsCredit: true,
      createdAt: { gte: startOfCurrentMonth() },
    },
  });
}

// Crédito extra comprado avulso (Patricia, 30/09/2026) — só imagem/vídeo,
// e só no mês da compra (mesma janela da cota do plano).
async function getPurchasedCreditsThisMonth(shopId: string, taskType: CreditTaskType): Promise<number> {
  if (taskType !== "image" && taskType !== "video") return 0;
  const result = await prisma.imageCreditPurchase.aggregate({
    where: { shopId, taskType, purchasedAt: { gte: startOfCurrentMonth() } },
    _sum: { creditsPurchased: true },
  });
  return result._sum.creditsPurchased ?? 0;
}

export async function getRemainingCredits(shop: ShopPlanFields & { id: string }, taskType: CreditTaskType): Promise<number> {
  const limit = getMonthlyLimit(shop, taskType) + (await getPurchasedCreditsThisMonth(shop.id, taskType));
  const used = await getMonthlyUsage(shop.id, taskType);
  return Math.max(0, limit - used);
}

// Lojista aceitou a cobrança de crédito extra ao clicar Regenerate sem
// crédito sobrando (Patricia, 30/09/2026). Com a cobrança ligada
// (BILLING_ENABLED), primeiro registra o uso na Shopify — a fatura mensal da
// lojista ganha o valor do medidor extra_image/extra_video — e só então libera
// o crédito aqui. Se o registro na Shopify falhar, o crédito NÃO é liberado
// (lança), pra nunca gerar sem cobrar.
export async function purchaseExtraCredits(
  shop: { id: string; shopGid: string | null },
  taskType: "image" | "video",
  credits: number,
): Promise<void> {
  const priceCents =
    taskType === "image" ? EXTRA_CREDIT_PRICING.pricePerImageCents : EXTRA_CREDIT_PRICING.pricePerVideoCents;
  const purchase = await prisma.imageCreditPurchase.create({
    data: { shopId: shop.id, taskType, creditsPurchased: 0, pricePaid: 0 },
  });

  try {
    if (isBillingEnabled()) {
      if (!shop.shopGid) throw new Error("Shop GID unknown — open the app once so it can be recorded.");
      await reportExtraUsage({
        shopGid: shop.shopGid,
        meter: taskType === "image" ? "extra_image" : "extra_video",
        quantity: credits,
        // id da compra: um retry da mesma compra nunca cobra duas vezes.
        idempotencyKey: `extra_${purchase.id}`,
      });
    }
  } catch (error) {
    await prisma.imageCreditPurchase.delete({ where: { id: purchase.id } });
    throw error;
  }

  await prisma.imageCreditPurchase.update({
    where: { id: purchase.id },
    data: { creditsPurchased: credits, pricePaid: (credits * priceCents) / 100 },
  });
}
