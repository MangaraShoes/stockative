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
  // ainda não publicou. Desde 01/10/2026 também apaga na hora os tokens
  // das redes conectadas (SocialAccount) — a Privacy Policy promete isso, e
  // não há motivo pra guardar credencial de publicação de uma loja que saiu.
  // O resto dos dados da loja é apagado ~48h depois, pelo webhook
  // shop/redact (ver webhooks.compliance.tsx).
  const shopRow = await db.shop.findUnique({ where: { shopifyDomain: shop } });
  if (shopRow) {
    await db.shop.update({ where: { id: shopRow.id }, data: { uninstalledAt: new Date() } });
    await db.contentItem.updateMany({
      where: { shopId: shopRow.id, status: { notIn: ["published", "cancelled"] } },
      data: { status: "cancelled" },
    });
    await db.socialAccount.deleteMany({ where: { shopId: shopRow.id } });
  }

  return new Response();
};
