import type { LoaderFunctionArgs } from "react-router";
import prisma from "../db.server";

// Rota pública (sem sessão Shopify) — a Graph API da Meta precisa buscar o
// vídeo diretamente pra criar o container REELS. Mesmo padrão da rota de
// imagem: ContentItem.videoUrl guarda uma data URI (base64), não uma URL
// real, então serve os bytes na hora em vez de redirecionar.
export const loader = async ({ params }: LoaderFunctionArgs) => {
  const contentItem = await prisma.contentItem.findUnique({
    where: { id: params.id },
    select: { videoUrl: true },
  });

  if (!contentItem?.videoUrl) {
    throw new Response("Not found", { status: 404 });
  }

  const base64 = contentItem.videoUrl.split(",")[1];
  const videoBuffer = Buffer.from(base64, "base64");

  return new Response(new Uint8Array(videoBuffer), {
    headers: {
      "Content-Type": "video/mp4",
      "Cache-Control": "public, max-age=3600",
    },
  });
};
