import { createHmac, timingSafeEqual } from "node:crypto";
import {
  TIKTOK_AUTHORIZE_BASE,
  TIKTOK_SCOPES,
  TIKTOK_TOKEN_URL,
  TIKTOK_USER_INFO_URL,
  tiktokApiRequest,
} from "./api.server";

const STATE_MAX_AGE_MS = 10 * 60 * 1000; // 10 minutos, mesmo padrão do Pinterest/Meta

function getClientKey() {
  const key = process.env.TIKTOK_CLIENT_KEY;
  if (!key) throw new Error("TIKTOK_CLIENT_KEY is not configured");
  return key;
}

function getClientSecret() {
  const secret = process.env.TIKTOK_CLIENT_SECRET;
  if (!secret) throw new Error("TIKTOK_CLIENT_SECRET is not configured");
  return secret;
}

export function isTikTokConfigured() {
  return Boolean(process.env.TIKTOK_CLIENT_KEY && process.env.TIKTOK_CLIENT_SECRET);
}

export function getRedirectUri() {
  const appUrl = process.env.SHOPIFY_APP_URL;
  if (!appUrl) throw new Error("SHOPIFY_APP_URL is not set");
  return `${appUrl}/auth/tiktok/callback`;
}

// Mesmo esquema de state assinado (HMAC do shopDomain + timestamp) já usado
// no Meta e no Pinterest — cada integração assina com o próprio secret pra
// não misturar os fluxos.
export function signState(shopDomain: string): string {
  const payload = `${shopDomain}:${Date.now()}`;
  const signature = createHmac("sha256", getClientSecret()).update(payload).digest("hex");
  return Buffer.from(`${payload}:${signature}`).toString("base64url");
}

export function verifyState(state: string): string | null {
  try {
    const decoded = Buffer.from(state, "base64url").toString("utf8");
    const [shopDomain, timestamp, signature] = decoded.split(":");
    if (!shopDomain || !timestamp || !signature) return null;

    const expectedSignature = createHmac("sha256", getClientSecret())
      .update(`${shopDomain}:${timestamp}`)
      .digest("hex");

    const signatureBuffer = Buffer.from(signature);
    const expectedBuffer = Buffer.from(expectedSignature);
    if (signatureBuffer.length !== expectedBuffer.length) return null;
    if (!timingSafeEqual(signatureBuffer, expectedBuffer)) return null;

    if (Date.now() - Number(timestamp) > STATE_MAX_AGE_MS) return null;

    return shopDomain;
  } catch {
    return null;
  }
}

export function buildAuthorizeUrl(shopDomain: string): string {
  const params = new URLSearchParams({
    client_key: getClientKey(),
    redirect_uri: getRedirectUri(),
    state: signState(shopDomain),
    scope: TIKTOK_SCOPES,
    response_type: "code",
  });
  return `${TIKTOK_AUTHORIZE_BASE}?${params}`;
}

interface TikTokTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  open_id: string;
  token_type: string;
  scope: string;
}

// Diferente do Pinterest (HTTP Basic Auth), o TikTok espera client_key e
// client_secret como campos do próprio form — ver
// https://developers.tiktok.com/doc/oauth-user-access-token-management
export async function exchangeCodeForToken(code: string): Promise<{
  accessToken: string;
  refreshToken: string;
  expiresInSeconds: number;
  openId: string;
}> {
  const response = await fetch(TIKTOK_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Cache-Control": "no-cache",
    },
    body: new URLSearchParams({
      client_key: getClientKey(),
      client_secret: getClientSecret(),
      code,
      grant_type: "authorization_code",
      redirect_uri: getRedirectUri(),
    }),
  });

  const json = (await response.json()) as TikTokTokenResponse & {
    error?: string;
    error_description?: string;
  };
  if (!response.ok || json.error) {
    throw new Error(json.error_description ?? `TikTok token exchange failed (${response.status})`);
  }

  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    expiresInSeconds: json.expires_in,
    openId: json.open_id,
  };
}

export interface ConnectedTikTokAccount {
  openId: string;
  username: string;
}

export async function getTikTokAccount(accessToken: string): Promise<ConnectedTikTokAccount> {
  const url = `${TIKTOK_USER_INFO_URL}?fields=open_id,username`;
  const data = await tiktokApiRequest<{ user: { open_id: string; username: string } }>(
    url,
    accessToken,
  );
  return { openId: data.user.open_id, username: data.user.username };
}
