import { createHmac, timingSafeEqual } from "node:crypto";
import {
  PINTEREST_OAUTH_DIALOG_BASE,
  PINTEREST_SCOPES,
  PINTEREST_TOKEN_URL,
  pinterestApiRequest,
} from "./api.server";

const STATE_MAX_AGE_MS = 10 * 60 * 1000; // 10 minutos

function getAppId() {
  const appId = process.env.PINTEREST_APP_ID;
  if (!appId) throw new Error("PINTEREST_APP_ID is not configured");
  return appId;
}

function getAppSecret() {
  const secret = process.env.PINTEREST_APP_SECRET;
  if (!secret) throw new Error("PINTEREST_APP_SECRET is not configured");
  return secret;
}

export function isPinterestConfigured() {
  return Boolean(process.env.PINTEREST_APP_ID && process.env.PINTEREST_APP_SECRET);
}

export function getRedirectUri() {
  const appUrl = process.env.SHOPIFY_APP_URL;
  if (!appUrl) throw new Error("SHOPIFY_APP_URL is not set");
  return `${appUrl}/auth/pinterest/callback`;
}

// Mesmo esquema de state assinado usado no Meta (HMAC do shopDomain +
// timestamp), só que assinado com o secret do Pinterest — cada integração
// assina com o próprio secret pra não misturar os dois fluxos.
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
    scope: PINTEREST_SCOPES,
    response_type: "code",
  });
  return `${PINTEREST_OAUTH_DIALOG_BASE}?${params}`;
}

interface PinterestTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  refresh_token_expires_in?: number;
  token_type: string;
  scope: string;
}

// A API do Pinterest autentica a troca de código com HTTP Basic Auth
// (client_id:client_secret em base64), diferente do Meta que manda os dois
// como parâmetros do form. Ver https://developers.pinterest.com/docs/getting-started/authentication/
export async function exchangeCodeForToken(code: string): Promise<{
  accessToken: string;
  refreshToken: string;
  expiresInSeconds: number;
}> {
  const basicAuth = Buffer.from(`${getAppId()}:${getAppSecret()}`).toString("base64");

  const response = await fetch(PINTEREST_TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basicAuth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: getRedirectUri(),
    }),
  });

  const json = (await response.json()) as PinterestTokenResponse & { message?: string };
  if (!response.ok) {
    throw new Error(json.message ?? `Pinterest token exchange failed (${response.status})`);
  }

  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    expiresInSeconds: json.expires_in,
  };
}

export interface ConnectedPinterestAccount {
  pinterestUserId: string;
  username: string;
}

export async function getPinterestAccount(
  accessToken: string,
): Promise<ConnectedPinterestAccount> {
  const account = await pinterestApiRequest<{ username: string; id?: string }>(
    "/user_account",
    accessToken,
  );
  return {
    pinterestUserId: account.id ?? account.username,
    username: account.username,
  };
}
