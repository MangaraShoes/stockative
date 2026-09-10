import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { syncSingleProduct } from "../services/syncProducts.server";

// Sincronização automática: dispara sozinho quando um produto é criado na
// Shopify, sem a lojista precisar clicar em "Sync products" — ver
// ARCHITECTURE.md e o pedido explícito de Patricia (10/09/2026).
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, admin, payload } = await authenticate.webhook(request);
  if (!admin) return new Response();

  const shopRecord = await prisma.shop.findUnique({ where: { shopifyDomain: shop } });
  if (!shopRecord) return new Response();

  const shopifyProductId = payload.admin_graphql_api_id as string;
  await syncSingleProduct(admin, shopRecord.id, shopifyProductId);

  return new Response();
};
