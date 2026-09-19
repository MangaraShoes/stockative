import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, session, topic } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  // Webhook requests can trigger multiple times and after an app has already been uninstalled.
  // If this webhook already ran, the session may have been deleted previously.
  if (session) {
    await db.session.deleteMany({ where: { shop } });
  }

  // Corrigido em 12/09/2026 (achado de revisão externa: "the uninstall
  // handler removes Shopify sessions, but does not deactivate the shop or
  // cancel pending posts... queued publication could continue while those
  // credentials remain valid"). Marca a loja inativa e cancela tudo que
  // ainda não publicou — as credenciais sociais (SocialAccount) ficam
  // salvas, mas publishDueContentItems e o gerador semanal agora ignoram
  // qualquer loja com uninstalledAt preenchido.
  const shopRow = await db.shop.findUnique({ where: { shopifyDomain: shop } });
  if (shopRow) {
    await db.shop.update({ where: { id: shopRow.id }, data: { uninstalledAt: new Date() } });
    await db.contentItem.updateMany({
      where: { shopId: shopRow.id, status: { notIn: ["published", "cancelled"] } },
      data: { status: "cancelled" },
    });
  }

  return new Response();
};
