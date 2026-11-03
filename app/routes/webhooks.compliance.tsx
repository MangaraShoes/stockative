import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { deleteAllShopData, isShopStillInstalled } from "../services/shopDataDeletion.server";

// Webhooks de privacidade obrigatórios da Shopify (GDPR), exigidos pra
// aprovação na App Store e prometidos na Privacy Policy (Patricia,
// 01/10/2026). authenticate.webhook valida o HMAC e rejeita qualquer
// requisição que não venha da Shopify.
//
// - customers/data_request e customers/redact: o Stockative não guarda
//   dados pessoais de clientes da loja (pedidos só entram agregados por
//   produto, sem nome/e-mail/endereço — ver webhooks.orders.paid), então
//   não há nada a exportar nem apagar; só confirma o recebimento.
// - shop/redact: chega ~48h depois da desinstalação — apaga tudo da loja,
//   a menos que ela tenha reinstalado nesse meio-tempo.
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic } = await authenticate.webhook(request);

  console.log(`Received ${topic} compliance webhook for ${shop}`);

  if (topic === "SHOP_REDACT") {
    if (await isShopStillInstalled(shop)) {
      console.log(`shop/redact for ${shop}: skipped, shop reinstalled the app`);
      return new Response();
    }
    const result = await deleteAllShopData(shop);
    console.log(`shop/redact for ${shop}: ${result.deleted ? "all data deleted" : "no shop record"}`);
  }

  return new Response();
};
