import prisma from "../../db.server";
import { generateProductImage } from "./generateProductImage.server";
import type { CommercialObjective } from "../decisionEngine/constants";
import { getRepertoireForInteraction } from "./categoryDispatch.server";
import type { VisualCategory, ProductInteraction } from "./productClassification.server";

interface BuildCarouselParams {
  shopId: string;
  productId: string;
  contentItemId: string;
  creativeAngle: string;
  format: string;
  // Objetivo comercial DESTE post — decide a estratégia visual (interação +
  // modo, ver visualMode.server.ts), não só a legenda (Patricia, 14/09/2026:
  // "fazer o objetivo comercial escolher entre opções válidas").
  objective: CommercialObjective;
  maxStills?: number;
  // true quando a lojista pediu explicitamente pra recriar SÓ A IMAGEM de
  // um post que ela já gostou (Patricia, 13/09/2026: "deveria ter opção de
  // somente recriar a imagem") — sem isso, reaproveitar uma editorial já
  // gerada e "não usada" poderia devolver a MESMA imagem com defeito que
  // ela acabou de pedir pra trocar.
  forceNewHero?: boolean;
  // O que a lojista pediu especificamente pra mudar ao clicar "Regenerate
  // image only" (Patricia, 13/09/2026: "opção de dizer o que ela gostaria
  // que melhorasse, como opcional") — repassado como correctionNote pro
  // Nano Banana, mesmo mecanismo já usado nas correções manuais de imagem.
  correctionNote?: string;
}

interface CarouselImage {
  position: number;
  url: string;
  source: "ai_generated" | "shopify_existing";
}

export type BuildCarouselResult =
  | { status: "success"; images: CarouselImage[]; heroWasReused: boolean; heroAssetId: string }
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
  const maxStills = params.maxStills ?? 3;

  const product = await prisma.productCache.findUnique({
    where: { id: params.productId },
  });

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
  const existingEditorials = params.forceNewHero
    ? []
    : await prisma.creativeAsset.findMany({
        where: {
          productId: params.productId,
          source: "ai_generated",
          generationLog: { passedFidelityCheck: true, passedCompositionCheck: true },
        },
        orderBy: { createdAt: "desc" },
        include: { generationLog: true },
      });

  // Achado ao vivo, 21/09/2026 (Patricia: uma loafer preta fechada, "de
  // outono", reaproveitada numa cena de praia/verão): passedFidelityCheck/
  // passedCompositionCheck acima só atestam fidelidade ao produto e
  // qualidade editorial — nunca se o AMBIENTE pedido naquela geração ainda
  // faz sentido pra este produto (ex.: praia exige calçado aberto, ver
  // isFootwearEnvironmentStillValid). Uma editorial gerada antes desse
  // guardrail existir ficava reaproveitável pra sempre depois. Recheca
  // aqui, na hora do reaproveitamento, não só na hora da geração original.
  const validEditorials = product
    ? existingEditorials.filter((asset) => {
        const log = asset.generationLog;
        if (!log?.category || !log.requestedEnvironment) return true;
        const repertoire = getRepertoireForInteraction(
          log.category as VisualCategory,
          (log.interaction as ProductInteraction | null) ?? "worn",
        );
        return repertoire.isEnvironmentStillValid?.(product.title, log.requestedEnvironment) ?? true;
      })
    : existingEditorials;

  let heroAssetId = validEditorials.find(
    (asset) => !usedHeroAssetIds.has(asset.id),
  )?.id;
  let heroUrl = validEditorials.find((a) => a.id === heroAssetId)?.imageUrl;
  const heroWasReused = Boolean(heroAssetId);

  if (!heroAssetId) {
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
      objective: params.objective,
      correctionNote: params.correctionNote,
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

  return { status: "success", images, heroWasReused, heroAssetId };
}
