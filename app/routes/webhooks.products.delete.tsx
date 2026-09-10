import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { archiveDeletedProduct } from "../services/syncProducts.server";

// products/delete só manda o ID no payload — arquiva em vez de apagar a
// linha, pra não quebrar content_items/creative_assets que ainda
// referenciam esse produto no histórico.
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, payload } = await authenticate.webhook(request);

  const shopRecord = await prisma.shop.findUnique({ where: { shopifyDomain: shop } });
  if (!shopRecord) return new Response();

  const shopifyProductId = `gid://shopify/Product/${payload.id}`;
  await archiveDeletedProduct(shopRecord.id, shopifyProductId);

  return new Response();
};
