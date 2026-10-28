import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { fetchActiveSubscription, isBillingEnabled } from "../services/billing/subscription.server";

// Assinatura criada, cancelada, expirada ou trocada fora do app (28/10/2026).
// Atualiza Shop.subscriptionActive, que é o que o cron do plano semanal lê
// (ver billingRequired no schema). Só o app público assina este webhook.
//
// Não confia no status do payload: numa troca de plano chegam dois eventos
// (o antigo CANCELLED e o novo ACTIVE) em qualquer ordem. Pergunta à
// Partner API se existe assinatura ativa agora.
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic } = await authenticate.webhook(request);
  console.log(`Received ${topic} webhook for ${shop}`);

  if (!isBillingEnabled()) return new Response();

  const shopRow = await db.shop.findUnique({ where: { shopifyDomain: shop } });
  if (!shopRow?.shopGid) return new Response();

  // Erro na Partner API lança e a Shopify reenvia o webhook depois.
  const subscription = await fetchActiveSubscription(shopRow.shopGid, { skipCache: true });
  await db.shop.update({
    where: { id: shopRow.id },
    data: {
      billingRequired: true,
      subscriptionActive: Boolean(subscription),
      ...(subscription ? { plan: subscription.plan } : {}),
    },
  });

  return new Response();
};
