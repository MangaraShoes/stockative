import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { buildAuthorizeUrl as buildMetaAuthorizeUrl } from "../services/meta/oauth.server";
import { buildAuthorizeUrl as buildPinterestAuthorizeUrl } from "../services/pinterest/oauth.server";
import { buildAuthorizeUrl as buildTikTokAuthorizeUrl } from "../services/tiktok/oauth.server";
import { buildAuthorizeUrl as buildYouTubeAuthorizeUrl } from "../services/youtube/oauth.server";
import {
  beginOAuthTransaction,
  findPendingTicket,
  isOAuthProvider,
  type OAuthProvider,
} from "../services/oauthTransaction.server";
import { oauthPopupCloseResponse } from "../services/oauthPopupClose.server";

// Rota pública (aba nova, fora do iframe) aberta pelo botão "Connect" de
// /app/social. Mostra pra QUAL loja a conta vai ser conectada antes de mandar
// pra rede social — quem recebeu este link de outra pessoa vê que a loja
// não é a sua (auditoria de segurança, 07/10/2026, H1). O ticket só é
// consumido no POST do botão, ver oauthTransaction.server.ts.

const PROVIDER_LABELS: Record<OAuthProvider, string> = {
  meta: "Instagram & Facebook",
  pinterest: "Pinterest",
  tiktok: "TikTok",
  youtube: "YouTube",
};

const AUTHORIZE_URL_BUILDERS: Record<OAuthProvider, (state: string) => string> = {
  meta: buildMetaAuthorizeUrl,
  pinterest: buildPinterestAuthorizeUrl,
  tiktok: buildTikTokAuthorizeUrl,
  youtube: buildYouTubeAuthorizeUrl,
};

const EXPIRED_MESSAGE = "This connection link has expired or was already used. Go back to Stockative and click Connect again.";

function errorResponse(message: string): Response {
  const appUrl = process.env.SHOPIFY_APP_URL ?? "";
  return oauthPopupCloseResponse(`${appUrl}/app/social?error=${encodeURIComponent(message)}`);
}

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const provider = params.provider;
  const ticketId = new URL(request.url).searchParams.get("t");
  if (!isOAuthProvider(provider) || !ticketId) {
    throw new Response("Not found", { status: 404 });
  }

  const ticket = await findPendingTicket(ticketId, provider);
  if (!ticket) return errorResponse(EXPIRED_MESSAGE);

  return confirmPage(PROVIDER_LABELS[provider], ticket.shopDomain);
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const provider = params.provider;
  const ticketId = new URL(request.url).searchParams.get("t");
  if (!isOAuthProvider(provider) || !ticketId) {
    throw new Response("Not found", { status: 404 });
  }

  // Só aceita o POST vindo da própria tela de confirmação: sem isso, um site
  // de terceiro podia auto-submeter este form e pular a confirmação.
  if (!isSameOriginRequest(request)) {
    throw new Response("Forbidden", { status: 403 });
  }

  const started = await beginOAuthTransaction(ticketId, provider);
  if (!started) return errorResponse(EXPIRED_MESSAGE);

  return new Response(null, {
    status: 303,
    headers: {
      Location: AUTHORIZE_URL_BUILDERS[provider](started.state),
      "Set-Cookie": started.setCookie,
      "Cache-Control": "no-store",
    },
  });
};

function isSameOriginRequest(request: Request): boolean {
  const appUrl = process.env.SHOPIFY_APP_URL;
  if (!appUrl) return false;
  const origin = request.headers.get("origin");
  if (origin) return origin === new URL(appUrl).origin;
  return request.headers.get("sec-fetch-site") === "same-origin";
}

function confirmPage(providerLabel: string, shopDomain: string): Response {
  const html = `<!DOCTYPE html>
<html>
<head>
<meta charSet="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Connect ${escapeHtml(providerLabel)} — Stockative</title>
<style>
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 100vh;
    margin: 0;
    background: #f6f6f7;
    color: #202223;
  }
  .card { max-width: 380px; text-align: center; padding: 32px 16px; }
  h1 { font-size: 20px; margin: 0 0 12px; }
  p { color: #6d7175; margin: 4px 0 12px; }
  .shop { color: #202223; font-weight: 600; word-break: break-all; }
  button {
    margin-top: 8px;
    padding: 10px 20px;
    font-size: 15px;
    border: 0;
    border-radius: 8px;
    background: #303030;
    color: #fff;
    cursor: pointer;
  }
</style>
</head>
<body>
<div class="card">
  <h1>Connect ${escapeHtml(providerLabel)}</h1>
  <p>Your account will be linked to this store:</p>
  <p class="shop">${escapeHtml(shopDomain)}</p>
  <p>If this isn't your store, close this tab.</p>
  <form method="post">
    <button type="submit">Continue to ${escapeHtml(providerLabel)}</button>
  </form>
</div>
</body>
</html>`;

  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
      "X-Frame-Options": "DENY",
      "Content-Security-Policy": "frame-ancestors 'none'",
    },
  });
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
