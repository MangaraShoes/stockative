// Cobrança dos créditos extras (imagem/vídeo) como USO na fatura mensal
// (Patricia, 06/10/2026). O Shopify App Pricing não aceita compra avulsa,
// então cada crédito extra aceito em "Accept charge" vira um evento no medidor
// de uso do plano ("extra_image" / "extra_video", configurados no painel com
// o preço de extrasPricing.ts). A Shopify soma e cobra no fim do ciclo.
// Docs: https://shopify.dev/docs/api/app-events

const APP_EVENTS_VERSION = "2026-10";

export type ExtraUsageMeter = "extra_image" | "extra_video";

let tokenCache: { token: string; expiresAt: number } | null = null;

// Token via client credentials das chaves de API criadas no Dev Dashboard
// (APP_EVENTS_CLIENT_ID/SECRET). Vale 60 min — renova com 5 min de folga.
async function getAccessToken(): Promise<string> {
  if (tokenCache && tokenCache.expiresAt > Date.now()) return tokenCache.token;

  const clientId = process.env.APP_EVENTS_CLIENT_ID;
  const clientSecret = process.env.APP_EVENTS_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("APP_EVENTS_CLIENT_ID / APP_EVENTS_CLIENT_SECRET are missing.");
  }

  const response = await fetch("https://api.shopify.com/auth/access_token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ grant_type: "client_credentials", client_id: clientId, client_secret: clientSecret }),
  });
  const json = (await response.json()) as { access_token?: string; expires_in?: number };
  if (!response.ok || !json.access_token) {
    throw new Error(`App Events auth failed: ${response.status}`);
  }
  const ttlMs = ((json.expires_in ?? 3600) - 300) * 1000;
  tokenCache = { token: json.access_token, expiresAt: Date.now() + ttlMs };
  return json.access_token;
}

// idempotencyKey impede cobrar duas vezes o mesmo crédito (a Shopify guarda
// chaves de evento de cobrança para sempre). Máx. 64 caracteres.
export async function reportExtraUsage(params: {
  shopGid: string;
  meter: ExtraUsageMeter;
  quantity: number;
  idempotencyKey: string;
}): Promise<void> {
  const token = await getAccessToken();
  const response = await fetch(`https://api.shopify.com/app/${APP_EVENTS_VERSION}/events`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      shop_id: params.shopGid,
      event_handle: params.meter,
      timestamp: new Date().toISOString(),
      idempotency_key: params.idempotencyKey.slice(0, 64),
      attributes: { value: params.quantity },
    }),
  });
  if (!response.ok) {
    throw new Error(`App Events request failed: ${response.status} ${await response.text()}`);
  }
}
