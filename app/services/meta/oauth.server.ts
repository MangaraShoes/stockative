import { createHmac, timingSafeEqual } from "node:crypto";
import {
  FACEBOOK_OAUTH_DIALOG_BASE,
  META_SCOPES,
  graphApiRequest,
} from "./graphApi.server";

const STATE_MAX_AGE_MS = 10 * 60 * 1000; // 10 minutos

function getAppId() {
  const appId = process.env.META_APP_ID;
  if (!appId) throw new Error("META_APP_ID is not configured");
  return appId;
}

function getAppSecret() {
  const secret = process.env.META_APP_SECRET;
  if (!secret) throw new Error("META_APP_SECRET is not configured");
  return secret;
}

export function isMetaConfigured() {
  return Boolean(process.env.META_APP_ID && process.env.META_APP_SECRET);
}

export function getRedirectUri() {
  const appUrl = process.env.SHOPIFY_APP_URL;
  if (!appUrl) throw new Error("SHOPIFY_APP_URL is not set");
  return `${appUrl}/auth/meta/callback`;
}

// state = shopDomain + timestamp, assinado com HMAC pra impedir que o
// callback seja usado pra conectar a conta Meta a uma loja diferente.
export function signState(shopDomain: string): string {
  const payload = `${shopDomain}:${Date.now()}`;
  const signature = createHmac("sha256", getAppSecret()).update(payload).digest("hex");
  return Buffer.from(`${payload}:${signature}`).toString("base64url");
}

export function verifyState(state: string): string | null {
  try {
    const decoded = Buffer.from(state, "base64url").toString("utf8");
    const [shopDomain, timestamp, signature] = decoded.split(":");
    if (!shopDomain || !timestamp || !signature) return null;

    const expectedSignature = createHmac("sha256", getAppSecret())
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
    client_id: getAppId(),
    redirect_uri: getRedirectUri(),
    state: signState(shopDomain),
    scope: META_SCOPES,
    response_type: "code",
  });
  return `${FACEBOOK_OAUTH_DIALOG_BASE}?${params}`;
}

export async function exchangeCodeForToken(code: string): Promise<string> {
  const json = await graphApiRequest<{ access_token: string }>("/oauth/access_token", {
    client_id: getAppId(),
    client_secret: getAppSecret(),
    redirect_uri: getRedirectUri(),
    code,
  });
  return json.access_token;
}

export async function exchangeForLongLivedToken(
  shortLivedToken: string,
): Promise<{ accessToken: string; expiresInSeconds: number }> {
  const json = await graphApiRequest<{ access_token: string; expires_in: number }>(
    "/oauth/access_token",
    {
      grant_type: "fb_exchange_token",
      client_id: getAppId(),
      client_secret: getAppSecret(),
      fb_exchange_token: shortLivedToken,
    },
  );
  return { accessToken: json.access_token, expiresInSeconds: json.expires_in };
}

export interface ConnectedInstagramAccount {
  pageId: string;
  pageAccessToken: string;
  igBusinessAccountId: string;
  igUsername: string;
}

// Lista as Páginas do Facebook que o usuário administra e procura a primeira
// que tenha uma conta Instagram Business/Creator ligada. Cada Página tem seu
// próprio access_token (retornado junto em /me/accounts) — é esse token, não
// o de usuário, que a Graph API espera pra publicar depois.
export async function getInstagramBusinessAccount(
  longLivedUserToken: string,
): Promise<ConnectedInstagramAccount | null> {
  const pages = await graphApiRequest<{
    data: { id: string; access_token: string; name: string }[];
  }>("/me/accounts", { access_token: longLivedUserToken });

  for (const page of pages.data) {
    const pageWithIg = await graphApiRequest<{
      instagram_business_account?: { id: string; username: string };
    }>(`/${page.id}`, {
      fields: "instagram_business_account{id,username}",
      access_token: page.access_token,
    });

    if (pageWithIg.instagram_business_account) {
      return {
        pageId: page.id,
        pageAccessToken: page.access_token,
        igBusinessAccountId: pageWithIg.instagram_business_account.id,
        igUsername: pageWithIg.instagram_business_account.username,
      };
    }
  }

  return null;
}
