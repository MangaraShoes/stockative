import prisma from "../../db.server";
import { generateProductImage } from "./generateProductImage.server";

interface BuildCarouselParams {
  shopId: string;
  productId: string;
  contentItemId: string;
  creativeAngle: string;
  format: string;
  maxStills?: number;
}

interface CarouselImage {
  position: number;
  url: string;
  source: "ai_generated" | "shopify_existing";
}

export type BuildCarouselResult =
  | { status: "success"; images: CarouselImage[]; heroWasReused: boolean }
  | { status: "fallback"; reason: string };

// Extraído pra fora de buildCarousel pra planWeek.server.ts poder checar a
// MESMA definição de "reaproveitável" antes de decidir chamar buildCarousel
// (Patricia, 11/09/2026: o planner só checava "existe alguma editorial",
// não "existe uma editorial ainda não usada" — com todas já usadas, ele
// ainda chamava buildCarousel achando que ia reaproveitar, e buildCarousel
// gerava uma editorial NOVA por baixo dos panos, furando o orçamento de
// "só o hero da semana ganha imagem nova").
export async function hasUnusedEditorial(productId: string): Promise<boolean> {
  const usedHeroRows = await prisma.contentItemImage.findMany({
    where: {
      position: 1,
      creativeAssetId: { not: null },
      contentItem: { productId },
    },
    select: { creativeAssetId: true },
  });
  const usedHeroAssetIds = new Set(usedHeroRows.map((r) => r.creativeAssetId));

  const existingEditorials = await prisma.creativeAsset.findMany({
    where: {
      productId,
      source: "ai_generated",
      generationLog: { passedFidelityCheck: true, passedCompositionCheck: true },
    },
    select: { id: true },
  });

  return existingEditorials.some((asset) => !usedHeroAssetIds.has(asset.id));
}

// Monta o carrossel: posição 1 é sempre a editorial (gerada por IA — nunca
// geramos still por IA), 2+ são stills da galeria da Shopify. A editorial
// NUNCA repete entre posts do mesmo produto: se já existe uma editorial
// gerada que ainda não foi usada como capa, reaproveita (sem gastar crédito
// de novo); só gera uma nova quando todas as existentes já foram usadas.
// Os stills podem repetir livremente entre posts (regra de Patricia, 09/09/2026).
export async function buildCarousel(
  params: BuildCarouselParams,
): Promise<BuildCarouselResult> {
  const maxStills = params.maxStills ?? 4;

  const usedHeroRows = await prisma.contentItemImage.findMany({
    where: {
      position: 1,
      creativeAssetId: { not: null },
      contentItem: { productId: params.productId },
    },
    select: { creativeAssetId: true },
  });
  const usedHeroAssetIds = new Set(usedHeroRows.map((r) => r.creativeAssetId));

  // Só reaproveita uma editorial que realmente tem o resultado do guardrail
  // de qualidade linkado e aprovado — sem isso, imagens órfãs geradas fora
  // do fluxo de carrossel (ex.: pelo botão de preview avulso "Generate
  // product image", depois abandonadas num rascunho) podiam ser
  // reaproveitadas como se fossem uma editorial pronta (achado real,
  // 11/09/2026: uma imagem de artesão trançando fibra foi publicada assim).
  const existingEditorials = await prisma.creativeAsset.findMany({
    where: {
      productId: params.productId,
      source: "ai_generated",
      generationLog: { passedFidelityCheck: true, passedCompositionCheck: true },
    },
    orderBy: { createdAt: "desc" },
  });

  let heroAssetId = existingEditorials.find(
    (asset) => !usedHeroAssetIds.has(asset.id),
  )?.id;
  let heroUrl = existingEditorials.find((a) => a.id === heroAssetId)?.imageUrl;
  const heroWasReused = Boolean(heroAssetId);

  if (!heroAssetId) {
    const product = await prisma.productCache.findUnique({
      where: { id: params.productId },
    });
    if (!product?.imageUrl) {
      return {
        status: "fallback",
        reason: "This product has no reference photo to generate an editorial image from.",
      };
    }

    const generated = await generateProductImage({
      shopId: params.shopId,
      productId: params.productId,
      contentItemId: params.contentItemId,
      referenceImageUrl: product.imageUrl,
      productTitle: product.title,
      creativeAngle: params.creativeAngle,
      format: params.format,
    });

    if (generated.status !== "success") {
      return { status: "fallback", reason: generated.reason };
    }

    heroAssetId = generated.creativeAssetId;
    heroUrl = generated.imageUrl;
  }

  if (!heroAssetId || !heroUrl) {
    return { status: "fallback", reason: "Could not determine a hero image." };
  }

  const stills = await prisma.productImage.findMany({
    where: { productId: params.productId },
    orderBy: { position: "asc" },
    take: maxStills,
  });

  const images: CarouselImage[] = [
    { position: 1, url: heroUrl, source: "ai_generated" },
    ...stills.map((still, index) => ({
      position: index + 2,
      url: still.url,
      source: "shopify_existing" as const,
    })),
  ];

  await prisma.contentItemImage.createMany({
    data: [
      {
        contentItemId: params.contentItemId,
        position: 1,
        creativeAssetId: heroAssetId,
      },
      ...stills.map((still, index) => ({
        contentItemId: params.contentItemId,
        position: index + 2,
        productImageId: still.id,
      })),
    ],
  });

  return { status: "success", images, heroWasReused };
}
