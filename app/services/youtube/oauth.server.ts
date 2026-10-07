import type { SocialAccount } from "@prisma/client";
import prisma from "../../db.server";
import {
  YOUTUBE_AUTH_BASE,
  YOUTUBE_CHANNELS_URL,
  YOUTUBE_SCOPES,
  YOUTUBE_TOKEN_URL,
  youtubeApiRequest,
} from "./api.server";

function getClientId() {
  const id = process.env.YOUTUBE_CLIENT_ID;
  if (!id) throw new Error("YOUTUBE_CLIENT_ID is not configured");
  return id;
}

function getClientSecret() {
  const secret = process.env.YOUTUBE_CLIENT_SECRET;
  if (!secret) throw new Error("YOUTUBE_CLIENT_SECRET is not configured");
  return secret;
}

export function isYouTubeConfigured() {
  return Boolean(process.env.YOUTUBE_CLIENT_ID && process.env.YOUTUBE_CLIENT_SECRET);
}

export function getRedirectUri() {
  const appUrl = process.env.SHOPIFY_APP_URL;
  if (!appUrl) throw new Error("SHOPIFY_APP_URL is not set");
  return `${appUrl}/auth/youtube/callback`;
}

// access_type=offline + prompt=consent são obrigatórios aqui, não
// opcionais: sem os dois, uma loja que reconecta (ou já autorizou antes)
// não recebe refresh_token nenhum de volta, silenciosamente — o Google só
// devolve o access_token de curta duração nesse caso.
// `state` vem de beginOAuthTransaction (oauthTransaction.server.ts).
export function buildAuthorizeUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: getClientId(),
    redirect_uri: getRedirectUri(),
    response_type: "code",
    scope: YOUTUBE_SCOPES,
    access_type: "offline",
    prompt: "consent",
    state,
  });
  return `${YOUTUBE_AUTH_BASE}?${params}`;
}

interface GoogleTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  token_type: string;
  scope: string;
  error?: string;
  error_description?: string;
}

export async function exchangeCodeForToken(code: string): Promise<{
  accessToken: string;
  refreshToken?: string;
  expiresInSeconds: number;
}> {
  const response = await fetch(YOUTUBE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: getClientId(),
      client_secret: getClientSecret(),
      code,
      grant_type: "authorization_code",
      redirect_uri: getRedirectUri(),
    }),
  });

  const json = (await response.json()) as GoogleTokenResponse;
  if (!response.ok || json.error) {
    throw new Error(json.error_description ?? `YouTube token exchange failed (${response.status})`);
  }

  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    expiresInSeconds: json.expires_in,
  };
}

export interface ConnectedYouTubeChannel {
  channelId: string;
  channelTitle: string;
}

export async function getYouTubeChannel(accessToken: string): Promise<ConnectedYouTubeChannel> {
  const data = await youtubeApiRequest<{
    items: { id: string; snippet: { title: string } }[];
  }>(`${YOUTUBE_CHANNELS_URL}?part=snippet&mine=true`, accessToken);

  const channel = data.items[0];
  if (!channel) throw new Error("No YouTube channel found for this Google account.");
  return { channelId: channel.id, channelTitle: channel.snippet.title };
}

async function refreshAccessToken(refreshToken: string): Promise<{
  accessToken: string;
  expiresInSeconds: number;
}> {
  const response = await fetch(YOUTUBE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: getClientId(),
      client_secret: getClientSecret(),
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  });

  const json = (await response.json()) as GoogleTokenResponse;
  if (!response.ok || json.error) {
    throw new Error(json.error_description ?? `YouTube token refresh failed (${response.status})`);
  }

  return { accessToken: json.access_token, expiresInSeconds: json.expires_in };
}

const EXPIRY_SAFETY_BUFFER_MS = 5 * 60 * 1000; // renova um pouco antes de expirar de verdade, não em cima da hora

// Devolve um access_token válido, renovando e salvando no banco primeiro se
// o atual já expirou ou está perto disso — mesmo mecanismo do
// getValidTikTokAccessToken, com UMA diferença real: o Google NÃO rotaciona
// o refresh_token a cada renovação (a resposta de refresh geralmente nem
// devolve refresh_token nenhum) — por isso o update abaixo nunca escreve
// refreshToken, só accessToken/expiresAt, preservando o token original
// indefinidamente até a lojista revogar o acesso.
export async function getValidYouTubeAccessToken(account: SocialAccount): Promise<string> {
  const isFresh = account.expiresAt && account.expiresAt.getTime() - Date.now() > EXPIRY_SAFETY_BUFFER_MS;
  if (isFresh) return account.accessToken;
  if (!account.refreshToken) return account.accessToken; // nada pra renovar com — segue com o que tem, deixa a chamada real falhar e reportar

  const refreshed = await refreshAccessToken(account.refreshToken);
  await prisma.socialAccount.update({
    where: { id: account.id },
    data: {
      accessToken: refreshed.accessToken,
      expiresAt: new Date(Date.now() + refreshed.expiresInSeconds * 1000),
    },
  });
  return refreshed.accessToken;
}
