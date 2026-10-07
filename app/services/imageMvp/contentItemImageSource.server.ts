import sharp from "sharp";
import prisma from "../../db.server";
import { safeFetch } from "../safeFetch.server";

// Resolve os bytes reais (JPEG) de um ContentItemImage, seja a origem uma
// data URI (imagem gerada por IA, em creativeAsset.imageUrl) ou uma URL do
// CDN do Shopify (still original, em productImage.url). Extraído da rota
// pública de mídia pra ser reaproveitado também pela montagem do Reel, sem
// precisar de uma volta HTTP pro próprio app (que depende do túnel/URL
// pública estar de pé — já foi ponto de falha real nesta sessão).
export async function getContentItemImageJpegBuffer(contentItemImageId: string): Promise<Buffer> {
  const image = await prisma.contentItemImage.findUnique({
    where: { id: contentItemImageId },
    include: { productImage: true, creativeAsset: true },
  });
  if (!image) {
    throw new Error(`ContentItemImage ${contentItemImageId} not found`);
  }

  let sourceBuffer: Buffer;
  if (image.creativeAsset) {
    const base64 = image.creativeAsset.imageUrl.split(",")[1];
    sourceBuffer = Buffer.from(base64, "base64");
  } else if (image.productImage) {
    // URL vem do Shopify (CDN), mas passa pelo safeFetch mesmo assim:
    // limite de tamanho/tempo e nunca rede interna (auditoria, 07/10/2026).
    const response = await safeFetch(image.productImage.url, {
      timeoutMs: 20_000,
      maxBytes: 25 * 1024 * 1024,
    });
    if (!response.ok) {
      throw new Error(`Source image unavailable (${response.status})`);
    }
    sourceBuffer = response.body;
  } else {
    throw new Error("Image has no source");
  }

  return sharp(sourceBuffer).jpeg({ quality: 90 }).toBuffer();
}
