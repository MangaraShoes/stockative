import "@shopify/shopify-app-react-router/adapters/node";
import {
  ApiVersion,
  AppDistribution,
  shopifyApp,
} from "@shopify/shopify-app-react-router/server";
import { PrismaSessionStorage } from "@shopify/shopify-app-session-storage-prisma";
import prisma from "./db.server";
import { getOrCreateShop, syncProducts } from "./services/syncProducts.server";
import { computeCommerceSignals } from "./services/computeCommerceSignals.server";

const shopify = shopifyApp({
  apiKey: process.env.SHOPIFY_API_KEY,
  apiSecretKey: process.env.SHOPIFY_API_SECRET || "",
  apiVersion: ApiVersion.October25,
  scopes: process.env.SCOPES?.split(","),
  appUrl: process.env.SHOPIFY_APP_URL || "",
  authPathPrefix: "/auth",
  sessionStorage: new PrismaSessionStorage(prisma),
  distribution: AppDistribution.AppStore,
  future: {
    expiringOfflineAccessTokens: true,
  },
  hooks: {
    // Roda assim que a loja autoriza o app (instalação ou reautenticação) —
    // a lojista nunca precisa clicar em "Sync products" pra ter os dados
    // iniciais (Patricia, 10/09/2026: "precisa ocorrer automática sem a
    // necessidade da cliente pedir"). Depois disso, webhooks products/*
    // e orders/paid mantêm tudo atualizado sem sync manual nenhum.
    afterAuth: async ({ session, admin }) => {
      const shop = await getOrCreateShop(session.shop, session.accessToken ?? "");
      await syncProducts(admin, shop.id);
      await computeCommerceSignals(admin, shop.id);
    },
  },
  ...(process.env.SHOP_CUSTOM_DOMAIN
    ? { customShopDomains: [process.env.SHOP_CUSTOM_DOMAIN] }
    : {}),
});

export default shopify;
export const apiVersion = ApiVersion.October25;
export const addDocumentResponseHeaders = shopify.addDocumentResponseHeaders;
export const authenticate = shopify.authenticate;
export const unauthenticated = shopify.unauthenticated;
export const login = shopify.login;
export const registerWebhooks = shopify.registerWebhooks;
export const sessionStorage = shopify.sessionStorage;
