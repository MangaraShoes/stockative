import { createHmac, timingSafeEqual } from "node:crypto";
import type { SocialAccount } from "@prisma/client";
import prisma from "../../db.server";
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

// O access_token do TikTok expira em ~24h (refresh_token dura bem mais) —
// refreshToken/expiresAt já eram salvos desde a conexão, mas nada nunca os
// usava pra renovar (achado de revisão de código, 21/09/2026: "refreshToken
// is captured but never used" — todo Reel que tenta chegar no TikTok passa
// a falhar silenciosamente, best-effort, cerca de um dia depois de
// conectar). Formato de resposta idêntico ao de exchangeCodeForToken.
async function refreshAccessToken(refreshToken: string): Promise<{
  accessToken: string;
  refreshToken: string;
  expiresInSeconds: number;
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
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  });

  const json = (await response.json()) as TikTokTokenResponse & {
    error?: string;
    error_description?: string;
  };
  if (!response.ok || json.error) {
    throw new Error(json.error_description ?? `TikTok token refresh failed (${response.status})`);
  }

  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    expiresInSeconds: json.expires_in,
  };
}

const EXPIRY_SAFETY_BUFFER_MS = 5 * 60 * 1000; // renova um pouco antes de expirar de verdade, não em cima da hora

// Devolve um access_token válido pra essa conta, renovando e salvando no
// banco primeiro se o atual já expirou ou está perto disso — chamar isso
// direto em vez de ler socialAccount.accessToken é o que faltava pra
// publicação no TikTok continuar funcionando depois do primeiro dia
// conectado. O TikTok também ROTACIONA o refresh_token a cada renovação:
// precisa salvar o novo, nunca reusar o antigo depois de usado uma vez.
export async function getValidTikTokAccessToken(account: SocialAccount): Promise<string> {
  const isFresh = account.expiresAt && account.expiresAt.getTime() - Date.now() > EXPIRY_SAFETY_BUFFER_MS;
  if (isFresh) return account.accessToken;
  if (!account.refreshToken) return account.accessToken; // nada pra renovar com — segue com o que tem, deixa a chamada real falhar e reportar

  const refreshed = await refreshAccessToken(account.refreshToken);
  await prisma.socialAccount.update({
    where: { id: account.id },
    data: {
      accessToken: refreshed.accessToken,
      refreshToken: refreshed.refreshToken,
      expiresAt: new Date(Date.now() + refreshed.expiresInSeconds * 1000),
    },
  });
  return refreshed.accessToken;
}
