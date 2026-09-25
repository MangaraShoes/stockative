// Cota mensal de geração/regeneração por tipo (Patricia, 24/09/2026:
// "regeneração espelha a cota de geração, como pool mensal, não 1x por
// post"). Mesma tabela BASIC/GROW/PLUS de planTiers.server.ts, só que em
// volume MENSAL em vez de semanal — 1 crédito = 1 imagem/vídeo ENTREGUE
// (ver GenerationLog.countsAsCredit), então geração e regeneração consomem
// do mesmo pool.
import prisma from "../../db.server";

export type CreditTaskType = "image" | "video";

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

type ShopPlanFields = {
  plan: string;
  customPostsPerMonth: number | null;
  customReelsPerMonth: number | null;
};

// Plano custom não tem uma cota mensal própria configurada — deriva do
// mesmo par de campos usado pra montar a cadência semanal (Fase 2), nunca
// trava esperando a lojista preencher (cai no default do Basic).
function resolveCustomLimits(shop: ShopPlanFields): { image: number; video: number } {
  if (!shop.customPostsPerMonth || shop.customPostsPerMonth <= 0) return MONTHLY_LIMITS.basic;

  const video = shop.customReelsPerMonth && shop.customReelsPerMonth > 0 ? shop.customReelsPerMonth : 0;
  const image = Math.max(0, shop.customPostsPerMonth - video);
  return { image, video };
}

export function getMonthlyLimit(shop: ShopPlanFields, taskType: CreditTaskType): number {
  const limits = shop.plan === "custom" ? resolveCustomLimits(shop) : MONTHLY_LIMITS[shop.plan] ?? MONTHLY_LIMITS.basic;
  return limits[taskType];
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

export async function getRemainingCredits(shop: ShopPlanFields & { id: string }, taskType: CreditTaskType): Promise<number> {
  const limit = getMonthlyLimit(shop, taskType);
  const used = await getMonthlyUsage(shop.id, taskType);
  return Math.max(0, limit - used);
}
