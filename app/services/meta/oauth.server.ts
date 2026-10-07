import {
  FACEBOOK_OAUTH_DIALOG_BASE,
  META_SCOPES,
  graphApiRequest,
} from "./graphApi.server";

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

// `state` vem de beginOAuthTransaction (oauthTransaction.server.ts).
export function buildAuthorizeUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: getAppId(),
    redirect_uri: getRedirectUri(),
    state,
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

// Padrão documentado da Meta pra duração de um long-lived user token (~60
// dias) — usado só como fallback quando a resposta não traz `expires_in`
// (visto ao vivo em 10/09/2026 na conta real da Mangará: o upsert de
// SocialAccount quebrava com "Invalid Date" porque expiresInSeconds vinha
// undefined). Sem isso a conexão inteira falhava por causa de um campo
// opcional que não deveria travar o fluxo.
const DEFAULT_LONG_LIVED_TOKEN_SECONDS = 60 * 24 * 60 * 60;

export async function exchangeForLongLivedToken(
  shortLivedToken: string,
): Promise<{ accessToken: string; expiresInSeconds: number }> {
  const json = await graphApiRequest<{ access_token: string; expires_in?: number }>(
    "/oauth/access_token",
    {
      grant_type: "fb_exchange_token",
      client_id: getAppId(),
      client_secret: getAppSecret(),
      fb_exchange_token: shortLivedToken,
    },
  );
  console.log("Meta fb_exchange_token raw response:", {
    ...json,
    access_token: json.access_token ? "[REDACTED]" : json.access_token,
  });
  const expiresInSeconds =
    typeof json.expires_in === "number" && Number.isFinite(json.expires_in)
      ? json.expires_in
      : DEFAULT_LONG_LIVED_TOKEN_SECONDS;
  return { accessToken: json.access_token, expiresInSeconds };
}

export interface ConnectedInstagramAccount {
  pageId: string;
  pageName: string;
  pageAccessToken: string;
  igBusinessAccountId: string;
  igUsername: string;
}

interface PagesResponse {
  data: { id: string; access_token: string; name: string }[];
  paging?: { next?: string };
}

// Lista as Páginas do Facebook que o usuário administra e procura a primeira
// que tenha uma conta Instagram Business/Creator ligada. Cada Página tem seu
// próprio access_token (retornado junto em /me/accounts) — é esse token, não
// o de usuário, que a Graph API espera pra publicar depois. Segue
// paging.next (01/10/2026, auditoria Meta App Review) — antes só olhava a
// primeira página de resultados, então quem administra muitas Páginas podia
// não ter a sua encontrada. Escolher entre VÁRIAS contas Instagram ainda não
// existe: continua pegando a primeira (follow-up).
export async function getInstagramBusinessAccount(
  longLivedUserToken: string,
): Promise<ConnectedInstagramAccount | null> {
  let pages = await graphApiRequest<PagesResponse>("/me/accounts", {
    access_token: longLivedUserToken,
  });

  for (;;) {
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
          pageName: page.name,
          pageAccessToken: page.access_token,
          igBusinessAccountId: pageWithIg.instagram_business_account.id,
          igUsername: pageWithIg.instagram_business_account.username,
        };
      }
    }

    if (!pages.paging?.next) return null;
    const response = await fetch(pages.paging.next);
    if (!response.ok) return null;
    pages = (await response.json()) as PagesResponse;
  }
}
