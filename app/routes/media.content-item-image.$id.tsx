import type { LoaderFunctionArgs } from "react-router";
import sharp from "sharp";
import prisma from "../db.server";

// Rota pública (sem sessão Shopify) — a Graph API da Meta precisa buscar a
// imagem diretamente pra criar o container de publicação, e só aceita JPEG.
// Normaliza pra JPEG aqui, seja a origem uma data URI (imagem gerada por IA)
// ou uma URL do CDN do Shopify (still original).
export const loader = async ({ params }: LoaderFunctionArgs) => {
  const contentItemImage = await prisma.contentItemImage.findUnique({
    where: { id: params.id },
    include: { productImage: true, creativeAsset: true },
  });

  if (!contentItemImage) {
    throw new Response("Not found", { status: 404 });
  }

  let sourceBuffer: Buffer;
  if (contentItemImage.creativeAsset) {
    const base64 = contentItemImage.creativeAsset.imageUrl.split(",")[1];
    sourceBuffer = Buffer.from(base64, "base64");
  } else if (contentItemImage.productImage) {
    const response = await fetch(contentItemImage.productImage.url);
    if (!response.ok) throw new Response("Source image unavailable", { status: 502 });
    sourceBuffer = Buffer.from(await response.arrayBuffer());
  } else {
    throw new Response("Image has no source", { status: 404 });
  }

  const jpegBuffer = await sharp(sourceBuffer).jpeg({ quality: 90 }).toBuffer();

  return new Response(new Uint8Array(jpegBuffer), {
    headers: {
      "Content-Type": "image/jpeg",
      "Cache-Control": "public, max-age=3600",
    },
  });
};
