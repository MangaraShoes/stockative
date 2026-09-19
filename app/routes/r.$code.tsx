import type { LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";
import prisma from "../db.server";

// Rota pública (sem sessão Shopify) — é pra onde o link do Facebook/Pinterest
// aponta de verdade (ver trackedLink.server.ts e publishContentItem.server.ts).
// Conta o clique e manda pro produto real na loja. 404 puro e simples se o
// código não existir, sem vazar nenhum detalhe interno.
export const loader = async ({ params }: LoaderFunctionArgs) => {
  const trackedLink = await prisma.trackedLink.findUnique({
    where: { shortCode: params.code },
    include: { contentItem: { include: { product: true } } },
  });

  const destination = trackedLink?.contentItem.product?.productUrl;
  if (!trackedLink || !destination) {
    throw new Response("Not found", { status: 404 });
  }

  // Best-effort — nunca atrasa nem quebra o redirecionamento em si por causa
  // da contagem.
  prisma.trackedLink
    .update({ where: { id: trackedLink.id }, data: { clickCount: { increment: 1 } } })
    .catch((error) => console.error("Failed to record tracked-link click:", error));

  return redirect(destination);
};
