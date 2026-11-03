import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import prisma from "../db.server";
import {
  exchangeCodeForToken,
  exchangeForLongLivedToken,
  listInstagramBusinessAccounts,
  type ConnectedInstagramAccount,
} from "../services/meta/oauth.server";
import { oauthPopupCloseResponse } from "../services/oauthPopupClose.server";
import {
  claimPendingSelection,
  completeOAuthTransaction,
  holdPendingSelection,
} from "../services/oauthTransaction.server";

// Callback público (fora do iframe embutido) — a Meta redireciona pra cá
// depois do merchant autorizar. Troca o código por token, descobre a Página
// + conta Instagram Business ligada, salva em SocialAccount, e manda o
// navegador de volta pro app embutido no admin da Shopify.
//
// Mais de uma conta Instagram (02/11/2026): em vez de pegar a primeira, esta
// aba mostra a lista e o merchant escolhe; o POST (action abaixo) salva a
// escolhida. Achado ao gravar o screencast: o "Continue as..." da Meta
// reaproveitou a permissão antiga, que incluía a Página da Mangará, e a
// loja de teste conectou o Instagram real da Mangará sem ninguém escolher.

const NO_ACCOUNT_MESSAGE =
  "No Instagram professional account linked to a Facebook Page was found on this account.";
const EXPIRED_MESSAGE =
  "This connection request has expired or was already used. Go back to Stockative and click Connect again.";

function appUrl() {
  return process.env.SHOPIFY_APP_URL ?? "";
}

function errorResponse(message: string): Response {
  return oauthPopupCloseResponse(`${appUrl()}/app/social?error=${encodeURIComponent(message)}`);
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const oauthError = url.searchParams.get("error_description");

  if (oauthError) return errorResponse(oauthError);
  if (!code || !state) return errorResponse("Missing code or state.");

  const shopDomain = await completeOAuthTransaction(request, "meta", state);
  if (!shopDomain) return errorResponse("Invalid or expired connection request — try again.");

  const shop = await prisma.shop.findUnique({ where: { shopifyDomain: shopDomain } });
  if (!shop) return errorResponse("Shop not found.");

  try {
    const shortLivedToken = await exchangeCodeForToken(code);
    const { accessToken: longLivedUserToken, expiresInSeconds } =
      await exchangeForLongLivedToken(shortLivedToken);
    const tokenExpiresAt = new Date(Date.now() + expiresInSeconds * 1000);
    const accounts = await listInstagramBusinessAccounts(longLivedUserToken);

    if (accounts.length === 0) return errorResponse(NO_ACCOUNT_MESSAGE);
    if (accounts.length === 1) return saveAccount(shop.id, accounts[0], tokenExpiresAt);

    const setCookie = await holdPendingSelection(
      request,
      "meta",
      state,
      longLivedUserToken,
      tokenExpiresAt,
    );
    if (!setCookie) return errorResponse(EXPIRED_MESSAGE);
    return pickerPage(shopDomain, state, accounts, setCookie);
  } catch (error) {
    console.error("Meta OAuth callback failed:", error);
    const message = error instanceof Error ? error.message : "Unknown error connecting Instagram.";
    return errorResponse(message);
  }
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const form = await request.formData();
  const state = String(form.get("state") ?? "");
  const chosenId = String(form.get("igBusinessAccountId") ?? "");
  if (!state || !chosenId) return errorResponse("Choose an Instagram account to connect.");

  // Consome o token guardado no loader: mesmo navegador (cookie), uma vez só.
  const pending = await claimPendingSelection(request, "meta", state);
  if (!pending) return errorResponse(EXPIRED_MESSAGE);

  const shop = await prisma.shop.findUnique({ where: { shopifyDomain: pending.shopDomain } });
  if (!shop) return errorResponse("Shop not found.");

  try {
    // Busca de novo em vez de confiar no form: só aceita uma conta que este
    // token realmente administra, e pega o token da Página na hora.
    const accounts = await listInstagramBusinessAccounts(pending.accessToken);
    const chosen = accounts.find((account) => account.igBusinessAccountId === chosenId);
    if (!chosen) return errorResponse(NO_ACCOUNT_MESSAGE);
    return saveAccount(shop.id, chosen, pending.tokenExpiresAt);
  } catch (error) {
    console.error("Meta OAuth account selection failed:", error);
    const message = error instanceof Error ? error.message : "Unknown error connecting Instagram.";
    return errorResponse(message);
  }
};

async function saveAccount(
  shopId: string,
  igAccount: ConnectedInstagramAccount,
  expiresAt: Date,
): Promise<Response> {
  const fields = {
    accessToken: igAccount.pageAccessToken,
    expiresAt,
    igBusinessAccountId: igAccount.igBusinessAccountId,
    fbPageId: igAccount.pageId,
    igUsername: igAccount.igUsername,
    fbPageName: igAccount.pageName,
  };
  await prisma.socialAccount.upsert({
    where: { shopId_platform: { shopId, platform: "instagram" } },
    create: { shopId, platform: "instagram", ...fields },
    update: fields,
  });

  return oauthPopupCloseResponse(
    `${appUrl()}/app/social?connected=${encodeURIComponent(igAccount.igUsername)}`,
  );
}

// Nenhuma opção vem marcada: a escolha tem que ser consciente, é isso que
// evita conectar a marca errada.
function pickerPage(
  shopDomain: string,
  state: string,
  accounts: ConnectedInstagramAccount[],
  setCookie: string,
): Response {
  const options = accounts
    .map(
      (account) => `<label class="option">
    <input type="radio" name="igBusinessAccountId" value="${escapeHtml(account.igBusinessAccountId)}" required />
    <span><strong>@${escapeHtml(account.igUsername)}</strong><br /><small>Facebook Page: ${escapeHtml(account.pageName)}</small></span>
  </label>`,
    )
    .join("\n");

  const html = `<!DOCTYPE html>
<html>
<head>
<meta charSet="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Choose your Instagram account — Stockative</title>
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
  .card { width: 100%; max-width: 400px; padding: 32px 16px; box-sizing: border-box; }
  h1 { font-size: 20px; margin: 0 0 12px; text-align: center; }
  p { color: #6d7175; margin: 4px 0 12px; text-align: center; }
  .shop { color: #202223; font-weight: 600; word-break: break-all; }
  .option {
    display: flex;
    gap: 12px;
    align-items: flex-start;
    background: #fff;
    border: 1px solid #e1e3e5;
    border-radius: 8px;
    padding: 12px;
    margin-bottom: 8px;
    cursor: pointer;
  }
  .option small { color: #6d7175; }
  button {
    display: block;
    width: 100%;
    margin-top: 12px;
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
  <h1>Choose your Instagram account</h1>
  <p>Your Facebook login manages more than one Instagram account. Pick the one for this store:</p>
  <p class="shop">${escapeHtml(shopDomain)}</p>
  <form method="post">
    <input type="hidden" name="state" value="${escapeHtml(state)}" />
    ${options}
    <button type="submit">Connect</button>
  </form>
</div>
</body>
</html>`;

  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "Referrer-Policy": "same-origin",
      "X-Frame-Options": "DENY",
      "Content-Security-Policy": "frame-ancestors 'none'",
      "Set-Cookie": setCookie,
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
