import type { LoaderFunctionArgs } from "react-router";

// Rota de diagnóstico TEMPORÁRIA (Patricia, 21/09/2026 — incidente de env
// vars sumindo do Railway) — pública de propósito, sem authenticate.admin,
// pra confirmar de fora se o processo em execução agora mesmo realmente
// enxerga cada variável, sem depender do cache do iframe do Shopify Admin
// nem do painel do Railway. Nunca expõe valor nenhum, só presença.
// Remover assim que o incidente for resolvido.
export const loader = async (_args: LoaderFunctionArgs) => {
  const check = (name: string) => Boolean(process.env[name]);
  return {
    SHOPIFY_API_KEY: check("SHOPIFY_API_KEY"),
    SHOPIFY_API_SECRET: check("SHOPIFY_API_SECRET"),
    SHOPIFY_APP_URL: check("SHOPIFY_APP_URL"),
    SCOPES: check("SCOPES"),
    DATABASE_URL: check("DATABASE_URL"),
    DIRECT_URL: check("DIRECT_URL"),
    CRON_SECRET: check("CRON_SECRET"),
    OPENROUTER_API_KEY: check("OPENROUTER_API_KEY"),
    META_APP_ID: check("META_APP_ID"),
    META_APP_SECRET: check("META_APP_SECRET"),
    PINTEREST_APP_ID: check("PINTEREST_APP_ID"),
    PINTEREST_APP_SECRET: check("PINTEREST_APP_SECRET"),
    TIKTOK_CLIENT_KEY: check("TIKTOK_CLIENT_KEY"),
    TIKTOK_CLIENT_SECRET: check("TIKTOK_CLIENT_SECRET"),
  };
};
