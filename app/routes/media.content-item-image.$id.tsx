import type { LoaderFunctionArgs } from "react-router";
import { getContentItemImageJpegBuffer } from "../services/imageMvp/contentItemImageSource.server";

// Rota pública (sem sessão Shopify) — a Graph API da Meta precisa buscar a
// imagem diretamente pra criar o container de publicação, e só aceita JPEG.
// Normaliza pra JPEG aqui, seja a origem uma data URI (imagem gerada por IA)
// ou uma URL do CDN do Shopify (still original).
export const loader = async ({ params }: LoaderFunctionArgs) => {
  let jpegBuffer: Buffer;
  try {
    jpegBuffer = await getContentItemImageJpegBuffer(params.id!);
  } catch {
    throw new Response("Not found", { status: 404 });
  }

  return new Response(new Uint8Array(jpegBuffer), {
    headers: {
      "Content-Type": "image/jpeg",
      "Cache-Control": "public, max-age=3600",
    },
  });
};
