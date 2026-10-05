import sharp from "sharp";
import { z } from "zod";
import prisma from "../../db.server";
import { generateStructuredForTask } from "../ai/index.server";

// Escolha manual quando a IA não chega numa imagem aprovada (Patricia,
// 05/10/2026: "após as tentativas, guardamos as imagens geradas como opção,
// e damos ao cliente opção de escolher entre as 2 geradas ou a imagem do
// produto no shopify ou ele sempre pode cancelar o post ou fazer upload de
// outra imagem").
//
// Só vira candidata uma tentativa que PASSOU na fidelidade e foi reprovada
// só por composição/estilo/destaque — uma reprovada por fidelidade mostra um
// produto diferente do vendido (cor, salto, material) e nunca é oferecida,
// nem como opção (regra de 03/10/2026: nunca mudar cor nem característica
// do produto).
//
// Candidata = CreativeAsset com source "ai_candidate", ligada ao post pelo
// GenerationLog.contentItemId — sem migração. Escolhida vira "ai_generated"
// (e o log passa a contar crédito: é uma imagem entregue); as demais viram
// "ai_candidate_discarded". Nunca entram no reaproveitamento de editorial
// (buildCarousel só reaproveita "ai_generated" aprovada nos dois checks).
//
// Mesmo dia, 2ª mensagem: "ele tem apenas uma tentativa de regenerar, pode
// escolher entre as 2 ou usar a imagem do shopify ou fazer upload... já
// mostramos a imagem do shopify se existir imagem que não seja still". As
// "2" = as duas imagens de IA que ela já viu: a anterior e a nova
// (ContentItem.previousHeroAssetId) quando a regeneração dá certo, ou as
// duas candidatas quando falha. A foto da Shopify só é opção se for
// lifestyle — still sozinha nunca abre um post (regra de 09/09/2026).
export const MAX_IMAGE_CANDIDATES = 2;
const STILLS_AFTER_HERO = 3;
const MAX_UPLOAD_EDGE = 2048;

export interface ImageCandidate {
  id: string;
  url: string;
}

const shotTypeSchema = z.object({ shotType: z.enum(["still", "lifestyle"]) });
const MAX_IMAGES_TO_CLASSIFY = 6;

// Classifica (uma vez, fica gravado) as fotos da Shopify do produto ainda
// sem shotType e devolve a primeira lifestyle, se existir. Chamado quando a
// lojista chega no painel de escolha (fim da regeneração ou geração
// automática sem imagem) — nunca no loader da página, pra não pôr chamada
// de IA no caminho de carregar a tela.
export async function classifyShopifyShotTypes(productId: string): Promise<void> {
  const unclassified = await prisma.productImage.findMany({
    where: { productId, shotType: null },
    orderBy: { position: "asc" },
    take: MAX_IMAGES_TO_CLASSIFY,
  });
  for (const image of unclassified) {
    try {
      const { shotType } = await generateStructuredForTask(
        "image_quality_assessment",
        shotTypeSchema,
        `Classify this product photo. "still" = the product alone on a plain/neutral studio background (packshot, catalog photo, flat lay, detail close-up with no scene). "lifestyle" = the product worn by a person or placed in a real scene/environment.`,
        { imageUrls: [image.url] },
      );
      await prisma.productImage.update({ where: { id: image.id }, data: { shotType } });
    } catch (error) {
      console.error(`Failed to classify product image ${image.id}:`, error);
    }
  }
}

export async function loadLifestyleShopifyImage(productId: string): Promise<ImageCandidate | null> {
  const image = await prisma.productImage.findFirst({
    where: { productId, shotType: "lifestyle" },
    orderBy: { position: "asc" },
  });
  return image ? { id: image.id, url: image.url } : null;
}

export async function loadPreviousHeroImage(previousHeroAssetId: string | null): Promise<ImageCandidate | null> {
  if (!previousHeroAssetId) return null;
  const asset = await prisma.creativeAsset.findUnique({ where: { id: previousHeroAssetId } });
  return asset ? { id: asset.id, url: asset.imageUrl } : null;
}

export async function loadPendingImageCandidates(contentItemId: string): Promise<ImageCandidate[]> {
  const assets = await prisma.creativeAsset.findMany({
    where: { source: "ai_candidate", generationLog: { contentItemId } },
    orderBy: { createdAt: "desc" },
    take: MAX_IMAGE_CANDIDATES,
    select: { id: true, imageUrl: true },
  });
  return assets.map((asset) => ({ id: asset.id, url: asset.imageUrl }));
}

export async function discardPendingImageCandidates(contentItemId: string): Promise<void> {
  await prisma.creativeAsset.updateMany({
    where: { source: "ai_candidate", generationLog: { contentItemId } },
    data: { source: "ai_candidate_discarded" },
  });
}

export type ImageChoiceResult = { status: "success" } | { status: "error"; reason: string };

async function loadEditableItem(
  shopId: string,
  contentItemId: string,
): Promise<{ ok: true; productId: string } | { ok: false; reason: string }> {
  const item = await prisma.contentItem.findUnique({ where: { id: contentItemId } });
  if (!item || item.shopId !== shopId) return { ok: false, reason: "This post is no longer part of the current plan." };
  if (!["draft", "approved"].includes(item.status)) {
    return { ok: false, reason: "This post has already been scheduled or published." };
  }
  if (!item.productId) return { ok: false, reason: "Product not found." };
  return { ok: true, productId: item.productId };
}

// Troca todas as imagens do post: capa na posição 1 (editorial de IA,
// upload ou foto lifestyle da Shopify), stills da Shopify depois. A
// editorial que estava na capa vira a "anterior", pra continuar como opção.
type Hero = { creativeAssetId: string } | { productImageId: string };

async function replacePostImages(contentItemId: string, productId: string, hero: Hero) {
  const currentHero = await prisma.contentItemImage.findFirst({
    where: { contentItemId, position: 1 },
    select: { creativeAssetId: true },
  });
  const heroProductImageId = "productImageId" in hero ? hero.productImageId : null;
  const stills = await prisma.productImage.findMany({
    where: { productId, ...(heroProductImageId ? { id: { not: heroProductImageId } } : {}) },
    orderBy: { position: "asc" },
    take: STILLS_AFTER_HERO,
  });
  const previousHeroAssetId =
    currentHero?.creativeAssetId && currentHero.creativeAssetId !== ("creativeAssetId" in hero ? hero.creativeAssetId : null)
      ? currentHero.creativeAssetId
      : undefined;
  await prisma.$transaction([
    prisma.contentItemImage.deleteMany({ where: { contentItemId } }),
    prisma.contentItemImage.createMany({
      data: [
        { contentItemId, position: 1, ...hero },
        ...stills.map((still, index) => ({ contentItemId, position: index + 2, productImageId: still.id })),
      ],
    }),
    ...(previousHeroAssetId
      ? [prisma.contentItem.update({ where: { id: contentItemId }, data: { previousHeroAssetId } })]
      : []),
  ]);
}

export async function chooseImageCandidate(params: {
  shopId: string;
  contentItemId: string;
  creativeAssetId: string;
}): Promise<ImageChoiceResult> {
  const loaded = await loadEditableItem(params.shopId, params.contentItemId);
  if (!loaded.ok) return { status: "error", reason: loaded.reason };

  const asset = await prisma.creativeAsset.findFirst({
    where: {
      id: params.creativeAssetId,
      shopId: params.shopId,
      source: "ai_candidate",
      generationLog: { contentItemId: params.contentItemId },
    },
  });
  if (!asset) return { status: "error", reason: "This image option is no longer available." };

  await prisma.creativeAsset.update({ where: { id: asset.id }, data: { source: "ai_generated" } });
  if (asset.generationLogId) {
    await prisma.generationLog.update({ where: { id: asset.generationLogId }, data: { countsAsCredit: true } });
  }
  await discardPendingImageCandidates(params.contentItemId);
  await replacePostImages(params.contentItemId, loaded.productId, { creativeAssetId: asset.id });
  return { status: "success" };
}

// Volta pra editorial que estava antes da última troca.
export async function choosePreviousHeroImage(params: {
  shopId: string;
  contentItemId: string;
}): Promise<ImageChoiceResult> {
  const loaded = await loadEditableItem(params.shopId, params.contentItemId);
  if (!loaded.ok) return { status: "error", reason: loaded.reason };
  const item = await prisma.contentItem.findUnique({ where: { id: params.contentItemId } });
  const previous = await loadPreviousHeroImage(item?.previousHeroAssetId ?? null);
  if (!previous) return { status: "error", reason: "The previous image is no longer available." };

  await discardPendingImageCandidates(params.contentItemId);
  await replacePostImages(params.contentItemId, loaded.productId, { creativeAssetId: previous.id });
  return { status: "success" };
}

export async function applyShopifyPhotosToPost(params: {
  shopId: string;
  contentItemId: string;
}): Promise<ImageChoiceResult> {
  const loaded = await loadEditableItem(params.shopId, params.contentItemId);
  if (!loaded.ok) return { status: "error", reason: loaded.reason };

  const lifestyle = await loadLifestyleShopifyImage(loaded.productId);
  if (!lifestyle) {
    return { status: "error", reason: "This product has no Shopify photo with a model or scene to open the post with." };
  }

  await discardPendingImageCandidates(params.contentItemId);
  await replacePostImages(params.contentItemId, loaded.productId, { productImageId: lifestyle.id });
  return { status: "success" };
}

export async function applyUploadedImageToPost(params: {
  shopId: string;
  contentItemId: string;
  imageDataUrl: string;
}): Promise<ImageChoiceResult> {
  const loaded = await loadEditableItem(params.shopId, params.contentItemId);
  if (!loaded.ok) return { status: "error", reason: loaded.reason };

  const match = /^data:image\/[a-z0-9.+-]+;base64,(.+)$/i.exec(params.imageDataUrl);
  if (!match) return { status: "error", reason: "That file isn't an image. Upload a JPG or PNG." };

  let jpeg: Buffer;
  try {
    jpeg = await sharp(Buffer.from(match[1], "base64"))
      .rotate()
      .resize({ width: MAX_UPLOAD_EDGE, height: MAX_UPLOAD_EDGE, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 90 })
      .toBuffer();
  } catch {
    return { status: "error", reason: "We couldn't read that image. Try a JPG or PNG." };
  }

  const asset = await prisma.creativeAsset.create({
    data: {
      shopId: params.shopId,
      productId: loaded.productId,
      imageUrl: `data:image/jpeg;base64,${jpeg.toString("base64")}`,
      source: "merchant_upload",
    },
  });
  await discardPendingImageCandidates(params.contentItemId);
  await replacePostImages(params.contentItemId, loaded.productId, { creativeAssetId: asset.id });
  return { status: "success" };
}

// "Manter a imagem atual" — só descarta as opções pendentes.
export async function dismissImageCandidates(params: {
  shopId: string;
  contentItemId: string;
}): Promise<ImageChoiceResult> {
  const item = await prisma.contentItem.findUnique({ where: { id: params.contentItemId } });
  if (!item || item.shopId !== params.shopId) {
    return { status: "error", reason: "This post is no longer part of the current plan." };
  }
  await discardPendingImageCandidates(params.contentItemId);
  return { status: "success" };
}
