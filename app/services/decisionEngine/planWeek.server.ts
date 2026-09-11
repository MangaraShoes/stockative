import type { ContentPillar } from "@prisma/client";
import prisma from "../../db.server";
import { inferObjective } from "./archetypes.server";
import { decideContentBrief, describeEvidence } from "./stage1.server";
import { generateCreativeCopy } from "./stage2.server";
import { buildCarousel, hasUnusedEditorial } from "../imageMvp/buildCarousel.server";
import { getProductUsageStats } from "./contentHistory.server";
import { translateCaption, buildBilingualCaption } from "./translateCaption.server";
import { maxPrimaryCaptionChars } from "./captionFormat";
import type { ContentLanguageCode } from "./constants";

const POSTS_PER_WEEK = 3;
const AVOID_REUSE_WITHIN_DAYS = 7;

export interface WeeklyPlanSlot {
  contentItemId: string;
  productTitle: string;
  objective: string;
  pillarName: string | null; // qual pilar (Fase 1) orientou este post, se algum
  isHero: boolean; // recebeu (ou tentou receber) uma editorial NOVA — ver "Alocação de crédito de imagem" em ARCHITECTURE.md
  needsManualImage: boolean; // produto não tinha editorial reaproveitável e não era o hero da semana
}

// Distribui os pilares salvos pelos slots da semana, ponderado por
// targetSharePct (pilar postLess pesa metade) — sem repetir pilar dentro do
// mesmo ciclo enquanto houver opção, reiniciando o ciclo se a semana tiver
// mais slots que pilares (Patricia, 11/09/2026: "implementa os pilares
// influenciando o weekly planner" — antes o planner nem olhava pra
// content_pillars, escolhia só por sinal comercial). Loja sem pilares
// salvos ainda recebe null em todo slot — planOneSlot já sabe lidar com
// isso sem pilar nenhum, mesmo padrão de todo o resto do produto.
async function allocatePillarsForWeek(
  shopId: string,
  slotCount: number,
): Promise<(ContentPillar | null)[]> {
  const pillars = await prisma.contentPillar.findMany({ where: { shopId } });
  if (pillars.length === 0) return Array(slotCount).fill(null);

  const weighted = pillars.map((pillar) => ({
    pillar,
    weight: Math.max(pillar.targetSharePct, 1) * (pillar.postLess ? 0.5 : 1),
  }));

  const result: (ContentPillar | null)[] = [];
  let pool = [...weighted];

  for (let i = 0; i < slotCount; i++) {
    if (pool.length === 0) pool = [...weighted];

    const totalWeight = pool.reduce((sum, w) => sum + w.weight, 0);
    let roll = Math.random() * totalWeight;
    let pickedIndex = pool.length - 1;
    for (let j = 0; j < pool.length; j++) {
      roll -= pool[j].weight;
      if (roll <= 0) {
        pickedIndex = j;
        break;
      }
    }

    result.push(pool[pickedIndex].pillar);
    pool.splice(pickedIndex, 1);
  }

  return result;
}

// Escolhe até POSTS_PER_WEEK produtos pra semana: prioriza velocidade de
// venda e estoque parado (mesmo critério do inferObjective), evitando
// repetir um produto usado nos últimos AVOID_REUSE_WITHIN_DAYS dias, a não
// ser que não haja produtos suficientes sem repetir.
async function rankProductsForWeek(shopId: string) {
  // status: "active" sozinho não bastava — Patricia, 11/09/2026: "selects
  // active products without excluding zero inventory" — um produto ativo
  // mas esgotado não deveria concorrer por um slot da semana.
  const products = await prisma.productCache.findMany({
    where: { shopId, status: "active", inventoryQuantity: { gt: 0 } },
    include: { commerceSignal: true },
  });
  const usageStats = await getProductUsageStats(shopId);

  const now = Date.now();
  const scored = products.map((product) => {
    const usage = usageStats[product.id];
    const daysSinceLastUsed = usage
      ? Math.floor((now - new Date(usage.lastUsedAt).getTime()) / (24 * 60 * 60 * 1000))
      : Infinity;
    const usedRecently = daysSinceLastUsed < AVOID_REUSE_WITHIN_DAYS;

    const salesVelocity = product.commerceSignal?.salesVelocity ?? 0;
    const slowMoverBonus = product.inventoryQuantity > 20 && salesVelocity < 0.3 ? 5 : 0;
    const score = salesVelocity * 10 + slowMoverBonus - (usedRecently ? 100 : 0);

    return { product, score, usedRecently };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored;
}

// Monta o post da semana pra um produto: Estágio 1 + Estágio 2 + carrossel
// (respeitando a regra "nunca só still" — ver CLAUDE.md, 09/09/2026).
async function planOneSlot(
  shopId: string,
  productId: string,
  isHero: boolean,
  pillar: ContentPillar | null,
): Promise<WeeklyPlanSlot> {
  const product = await prisma.productCache.findUniqueOrThrow({
    where: { id: productId },
    include: { commerceSignal: true },
  });
  const shop = await prisma.shop.findUniqueOrThrow({ where: { id: shopId } });

  const objective = inferObjective({
    inventoryQuantity: product.inventoryQuantity,
    salesVelocity: product.commerceSignal?.salesVelocity ?? null,
    daysSinceCreated: product.shopifyCreatedAt
      ? Math.floor((Date.now() - product.shopifyCreatedAt.getTime()) / (24 * 60 * 60 * 1000))
      : null,
  });

  const stage1Input = {
    productTitle: product.title,
    productDescription: product.description,
    productType: product.productType,
    price: product.price,
    inventoryQuantity: product.inventoryQuantity,
    unitsSold30d: product.commerceSignal?.unitsSold30d ?? 0,
    salesVelocity: product.commerceSignal?.salesVelocity ?? 0,
    daysSinceLastSale: product.commerceSignal?.daysSinceLastSale ?? null,
    daysSinceCreated: product.shopifyCreatedAt
      ? Math.floor((Date.now() - product.shopifyCreatedAt.getTime()) / (24 * 60 * 60 * 1000))
      : null,
    brandDescription: shop.brandDescription,
    objective,
    pillar: pillar
      ? {
          name: pillar.name,
          function: pillar.function,
          problemExplored: pillar.problemExplored,
          promise: pillar.promise,
          idealFormat: pillar.idealFormat,
          cta: pillar.cta,
          growthCategory: pillar.growthCategory,
        }
      : null,
  };
  const brief = await decideContentBrief(stage1Input);

  const copy = await generateCreativeCopy(
    brief,
    shop.contentLanguagePrimary as ContentLanguageCode,
    {
      brandDescription: shop.brandDescription,
      brandTone: shop.brandTone,
      brandAvoid: shop.brandAvoid,
    },
    describeEvidence(stage1Input),
    maxPrimaryCaptionChars(Boolean(shop.contentLanguageSecondary)),
  );

  const secondaryCaption = shop.contentLanguageSecondary
    ? await translateCaption(copy.captionText, shop.contentLanguageSecondary as ContentLanguageCode)
    : null;
  const captionText = buildBilingualCaption(copy.captionText, secondaryCaption);

  const contentItem = await prisma.contentItem.create({
    data: {
      shopId,
      productId: product.id,
      contentPillarId: pillar?.id ?? null,
      platform: brief.channel,
      commercialObjective: objective,
      decisionBrief: brief,
      captionText,
      hashtags: copy.hashtags.join(", "),
      cta: copy.cta,
      status: "draft",
    },
  });

  // Só o hero da semana pode gerar uma editorial NOVA. Pros demais, só
  // montamos o carrossel se já existir uma editorial reaproveitável — senão
  // deixamos sem imagem e sinalizamos, em vez de queimar crédito fora do
  // orçamento da semana.
  let needsManualImage = false;
  if (isHero) {
    await buildCarousel({
      shopId,
      productId: product.id,
      contentItemId: contentItem.id,
      creativeAngle: brief.creativeAngle,
      format: brief.format,
    });
  } else {
    if (await hasUnusedEditorial(product.id)) {
      await buildCarousel({
        shopId,
        productId: product.id,
        contentItemId: contentItem.id,
        creativeAngle: brief.creativeAngle,
        format: brief.format,
      });
    } else {
      needsManualImage = true;
    }
  }

  return {
    contentItemId: contentItem.id,
    productTitle: product.title,
    objective,
    pillarName: pillar?.name ?? null,
    isHero,
    needsManualImage,
  };
}

// Gera o plano da semana inteiro de uma vez: escolhe os produtos, decide
// estratégia + copy + imagem pra cada um. Só o primeiro (maior prioridade)
// recebe imagem editorial nova; os demais reaproveitam ou ficam pendentes.
export async function planWeeklyContent(shopId: string): Promise<WeeklyPlanSlot[]> {
  const ranked = await rankProductsForWeek(shopId);
  const chosen = ranked.slice(0, POSTS_PER_WEEK);
  const pillarsForSlots = await allocatePillarsForWeek(shopId, chosen.length);

  const slots: WeeklyPlanSlot[] = [];
  for (const [index, entry] of chosen.entries()) {
    const slot = await planOneSlot(shopId, entry.product.id, index === 0, pillarsForSlots[index]);
    slots.push(slot);
  }
  return slots;
}
