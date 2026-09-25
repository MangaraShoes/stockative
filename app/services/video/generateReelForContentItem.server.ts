import prisma from "../../db.server";
import { getContentItemImageJpegBuffer } from "../imageMvp/contentItemImageSource.server";
import { buildReel } from "./buildReel.server";

// Reels mais longos que isso viram repetitivos pra só 3-4s de "novidade"
// por imagem — o mesmo princípio de variar cena a cada produto do CLAUDE.md
// da Mangará vale aqui: poucas imagens bem escolhidas, não a galeria toda.
const MAX_IMAGES_IN_REEL = 3;

// Monta e salva o Reel de um post já existente, a partir das imagens que
// ele já tem (hero + stills, já geradas e aprovadas pela checagem de
// fidelidade — ver generateProductImage.server.ts). Idempotente por
// natureza: cada chamada remonta do zero e sobrescreve videoUrl, então um
// retry ou "gerar de novo" nunca deixa lixo pra trás.
export async function generateReelForContentItem(contentItemId: string, shopId: string): Promise<void> {
  const contentItem = await prisma.contentItem.findFirstOrThrow({
    where: { id: contentItemId, shopId },
    include: { images: { orderBy: { position: "asc" } } },
  });

  if (contentItem.images.length === 0) {
    throw new Error("This post has no images yet — build the carousel or generate an image first.");
  }

  const imagesToUse = contentItem.images.slice(0, MAX_IMAGES_IN_REEL);
  const buffers = await Promise.all(
    imagesToUse.map((image) => getContentItemImageJpegBuffer(image.id)),
  );

  const videoBuffer = await buildReel({ images: buffers });
  const videoDataUrl = `data:video/mp4;base64,${videoBuffer.toString("base64")}`;

  await prisma.contentItem.update({
    where: { id: contentItemId },
    data: { videoUrl: videoDataUrl, videoGeneratedAt: new Date(), format: "reel" },
  });

  // 1 crédito = 1 Reel entregue (mesmo princípio já usado pra imagem, ver
  // generateProductImage.server.ts) — sem checagem de qualidade pro vídeo
  // hoje, então toda chamada bem-sucedida conta. countsAgainst a cota
  // MENSAL de vídeo (Fase 3, ver creditUsage.server.ts).
  await prisma.generationLog.create({
    data: {
      contentItemId,
      shopId,
      taskType: "video",
      model: "ffmpeg",
      countsAsCredit: true,
    },
  });
}
