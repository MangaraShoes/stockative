import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { computeCommerceSignals } from "../services/computeCommerceSignals.server";

// Recalcula os sinais de comércio (velocidade de venda, receita 30d, etc.)
// sempre que um pedido é pago — mantém tudo atualizado sem a lojista
// precisar clicar em "Calculate commerce signals" (Patricia, 10/09/2026).
// Recalcula pra loja inteira, não só o produto do pedido — simples o
// bastante pro tamanho de catálogo atual, sem job incremental.
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, admin } = await authenticate.webhook(request);
  if (!admin) return new Response();

  const shopRecord = await prisma.shop.findUnique({ where: { shopifyDomain: shop } });
  if (!shopRecord) return new Response();

  await computeCommerceSignals(admin, shopRecord.id);

  return new Response();
};
