// Manda UM evento extra_image de teste para uma dev store, com as mesmas
// credenciais que o app usa (appEvents.server.ts). Serve para provar que o
// App Events autentica e que o medidor registra uso, sem gerar imagem.
// Uso, no servidor: docker compose ... exec app-public node deploy/hetzner/send-test-usage-event.mjs <loja>.myshopify.com
// Imprime só códigos de status, nunca credenciais.
import { PrismaClient } from "@prisma/client";

const domain = process.argv[2];
if (!domain) throw new Error("Pass the shop domain, e.g. stockative-public-test.myshopify.com");
const prisma = new PrismaClient();
const shop = await prisma.shop.findUnique({ where: { shopifyDomain: domain }, select: { shopGid: true } });
await prisma.$disconnect();
const shopId = shop?.shopGid;
if (!shopId) throw new Error(`No shopGid stored for ${domain} — open the app in that store once.`);
console.log("shop:", shopId);

const clientId = process.env.APP_EVENTS_CLIENT_ID || process.env.SHOPIFY_API_KEY;
const clientSecret = process.env.APP_EVENTS_CLIENT_SECRET || process.env.SHOPIFY_API_SECRET;

const auth = await fetch("https://api.shopify.com/auth/access_token", {
  method: "POST",
  headers: { "Content-Type": "application/json", "User-Agent": "stockative-test" },
  body: JSON.stringify({ grant_type: "client_credentials", client_id: clientId, client_secret: clientSecret }),
});
console.log("auth:", auth.status);
const { access_token: token } = await auth.json();
if (!token) process.exit(1);

const event = await fetch("https://api.shopify.com/app/2026-10/events", {
  method: "POST",
  headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, "User-Agent": "stockative-test" },
  body: JSON.stringify({
    shop_id: shopId,
    event_handle: "extra_image",
    timestamp: new Date().toISOString(),
    idempotency_key: `test_extra_image_${shopId}_${Date.now()}`.slice(0, 64),
    attributes: { value: 1 },
  }),
});
console.log("event:", event.status, await event.text());
