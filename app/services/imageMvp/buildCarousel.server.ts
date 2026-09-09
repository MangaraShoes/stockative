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

  const existingEditorials = await prisma.creativeAsset.findMany({
    where: { productId: params.productId, source: "ai_generated" },
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
