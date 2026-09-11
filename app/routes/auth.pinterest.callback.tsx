import type { LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";
import prisma from "../db.server";
import {
  exchangeCodeForToken,
  getPinterestAccount,
  verifyState,
} from "../services/pinterest/oauth.server";

// Callback público — o Pinterest redireciona pra cá depois do merchant
// autorizar. Troca o código por token (+ refresh token), busca o username
// conectado, salva em SocialAccount e manda o navegador de volta pro app
// embutido no admin da Shopify. Mesmo formato de auth.meta.callback.tsx.
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const oauthError = url.searchParams.get("error_description") ?? url.searchParams.get("error");

  const appUrl = process.env.SHOPIFY_APP_URL ?? "";

  if (oauthError) {
    return redirect(`${appUrl}/app/social?error=${encodeURIComponent(oauthError)}`);
  }
  if (!code || !state) {
    return redirect(`${appUrl}/app/social?error=${encodeURIComponent("Missing code or state.")}`);
  }

  const shopDomain = verifyState(state);
  if (!shopDomain) {
    return redirect(
      `${appUrl}/app/social?error=${encodeURIComponent("Invalid or expired connection request — try again.")}`,
    );
  }

  const shop = await prisma.shop.findUnique({ where: { shopifyDomain: shopDomain } });
  if (!shop) {
    return redirect(`${appUrl}/app/social?error=${encodeURIComponent("Shop not found.")}`);
  }

  try {
    const { accessToken, refreshToken, expiresInSeconds } = await exchangeCodeForToken(code);
    const account = await getPinterestAccount(accessToken);

    await prisma.socialAccount.upsert({
      where: { shopId_platform: { shopId: shop.id, platform: "pinterest" } },
      create: {
        shopId: shop.id,
        platform: "pinterest",
        accessToken,
        refreshToken,
        expiresAt: new Date(Date.now() + expiresInSeconds * 1000),
        pinterestUserId: account.pinterestUserId,
        pinterestUsername: account.username,
      },
      update: {
        accessToken,
        refreshToken,
        expiresAt: new Date(Date.now() + expiresInSeconds * 1000),
        pinterestUserId: account.pinterestUserId,
        pinterestUsername: account.username,
      },
    });

    return redirect(
      `${appUrl}/app/social?pinterestConnected=${encodeURIComponent(account.username)}`,
    );
  } catch (error) {
    console.error("Pinterest OAuth callback failed:", error);
    const message = error instanceof Error ? error.message : "Unknown error connecting Pinterest.";
    return redirect(`${appUrl}/app/social?error=${encodeURIComponent(message)}`);
  }
};
