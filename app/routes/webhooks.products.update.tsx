import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { syncSingleProduct } from "../services/syncProducts.server";

// Mesma lógica de webhooks.products.create.tsx, mas pra quando um produto
// já existente é editado na Shopify (preço, estoque, descrição, galeria...).
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, admin, payload } = await authenticate.webhook(request);
  if (!admin) return new Response();

  const shopRecord = await prisma.shop.findUnique({ where: { shopifyDomain: shop } });
  if (!shopRecord) return new Response();

  const shopifyProductId = payload.admin_graphql_api_id as string;
  await syncSingleProduct(admin, shopRecord.id, shopifyProductId);

  return new Response();
};
