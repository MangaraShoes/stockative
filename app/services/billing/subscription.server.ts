// Cobrança via Shopify App Pricing (Patricia, 06/10/2026). Os planos, preços
// e o teste grátis de 7 dias vivem no painel de Partner da Shopify, não no
// código: a própria Shopify mostra a tela de escolha de plano e cobra na
// fatura da lojista. O app só (1) confere se a loja tem assinatura ativa,
// (2) manda quem não tem pra tela de planos e (3) sincroniza qual plano ela
// escolheu, pra liberar a cadência/cota certa (planTiers.server.ts).
//
// Desligado até BILLING_ENABLED=true no Railway, pra nada mudar antes de os
// planos existirem no painel. Docs:
// https://shopify.dev/docs/apps/launch/billing/shopify-app-pricing

const PARTNER_API_VERSION = "2026-07";
const CACHE_TTL_MS = 5 * 60 * 1000;

export function isBillingEnabled(): boolean {
  return process.env.BILLING_ENABLED === "true";
}

// Handle do app no admin (admin.shopify.com/store/<loja>/apps/<handle>).
function appHandle(): string {
  return process.env.SHOPIFY_APP_HANDLE || "stockative-1";
}

export function planSelectionUrl(shopDomain: string): string {
  const storeHandle = shopDomain.replace(".myshopify.com", "");
  return `https://admin.shopify.com/store/${storeHandle}/charges/${appHandle()}/pricing_plans`;
}

export interface ActiveSubscription {
  // "basic" | "grow" | "plus" — o que o resto do app entende como plano.
  plan: "basic" | "grow" | "plus";
  trialEndsAt: string | null;
  cancelAtEndOfCycle: boolean;
}

interface PartnerSubscription {
  trialEndsAt: string | null;
  cancelAtEndOfCycle: boolean;
  items: { handle: string; description: string | null }[];
}

// O handle/nome de cada plano é definido no painel. Mapeia por nome, pra não
// depender de um handle exato: "Basic", "Grow", "Plus". O plano privado da
// Mangará (gratuito) libera a cota do Plus.
function planFromItems(items: PartnerSubscription["items"]): ActiveSubscription["plan"] {
  const text = items.map((item) => `${item.handle} ${item.description ?? ""}`).join(" ").toLowerCase();
  if (text.includes("plus") || text.includes("mangara") || text.includes("mangará")) return "plus";
  if (text.includes("grow")) return "grow";
  return "basic";
}

const cache = new Map<string, { value: ActiveSubscription; expiresAt: number }>();

// Só cacheia assinatura CONFIRMADA (orientação da Shopify): quem acabou de
// aprovar um plano é conferido na hora, e um cancelamento aparece quando o
// cache expira. Lança em erro/limite de taxa, pra nunca tratar uma falha
// como "sem assinatura" e bloquear quem está pagando.
export async function fetchActiveSubscription(shopGid: string): Promise<ActiveSubscription | null> {
  const cached = cache.get(shopGid);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const orgId = process.env.SHOPIFY_PARTNER_ORG_ID;
  const token = process.env.SHOPIFY_PARTNER_API_ACCESS_TOKEN;
  const appGid = process.env.SHOPIFY_APP_GID;
  if (!orgId || !token || !appGid) {
    throw new Error("Billing is enabled but SHOPIFY_PARTNER_ORG_ID / SHOPIFY_PARTNER_API_ACCESS_TOKEN / SHOPIFY_APP_GID are missing.");
  }

  const response = await fetch(`https://partners.shopify.com/${orgId}/api/${PARTNER_API_VERSION}/graphql.json`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
    body: JSON.stringify({
      query: `query ($appId: ID!, $shopId: ID!) {
        activeSubscription(appId: $appId, shopId: $shopId) {
          trialEndsAt
          cancelAtEndOfCycle
          items { handle description }
        }
      }`,
      variables: { appId: appGid, shopId: shopGid },
    }),
  });
  const json = (await response.json()) as {
    data?: { activeSubscription: PartnerSubscription | null };
    errors?: unknown;
  };
  if (!response.ok || json.errors || !json.data) {
    throw new Error(`Partner API request failed: ${JSON.stringify(json.errors ?? response.status)}`);
  }

  const raw = json.data.activeSubscription;
  if (!raw) return null;
  const value: ActiveSubscription = {
    plan: planFromItems(raw.items),
    trialEndsAt: raw.trialEndsAt,
    cancelAtEndOfCycle: raw.cancelAtEndOfCycle,
  };
  cache.set(shopGid, { value, expiresAt: Date.now() + CACHE_TTL_MS });
  return value;
}
