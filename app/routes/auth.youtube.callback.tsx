import type { LoaderFunctionArgs } from "react-router";
import prisma from "../db.server";
import { exchangeCodeForToken, getYouTubeChannel, verifyState } from "../services/youtube/oauth.server";
import { oauthPopupCloseResponse } from "../services/oauthPopupClose.server";

// Callback público — o Google redireciona pra cá depois do merchant
// autorizar. Troca o código por token (+ refresh token, se o Google
// devolver), busca o canal conectado, salva em SocialAccount e manda o
// navegador de volta pro app embutido no admin da Shopify. Mesmo formato de
// auth.tiktok.callback.tsx.
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const oauthError = url.searchParams.get("error_description") ?? url.searchParams.get("error");

  const appUrl = process.env.SHOPIFY_APP_URL ?? "";

  if (oauthError) {
    return oauthPopupCloseResponse(`${appUrl}/app/social?error=${encodeURIComponent(oauthError)}`);
  }
  if (!code || !state) {
    return oauthPopupCloseResponse(
      `${appUrl}/app/social?error=${encodeURIComponent("Missing code or state.")}`,
    );
  }

  const shopDomain = verifyState(state);
  if (!shopDomain) {
    return oauthPopupCloseResponse(
      `${appUrl}/app/social?error=${encodeURIComponent("Invalid or expired connection request — try again.")}`,
    );
  }

  const shop = await prisma.shop.findUnique({ where: { shopifyDomain: shopDomain } });
  if (!shop) {
    return oauthPopupCloseResponse(`${appUrl}/app/social?error=${encodeURIComponent("Shop not found.")}`);
  }

  try {
    const { accessToken, refreshToken, expiresInSeconds } = await exchangeCodeForToken(code);
    const channel = await getYouTubeChannel(accessToken);

    await prisma.socialAccount.upsert({
      where: { shopId_platform: { shopId: shop.id, platform: "youtube" } },
      create: {
        shopId: shop.id,
        platform: "youtube",
        accessToken,
        refreshToken,
        expiresAt: new Date(Date.now() + expiresInSeconds * 1000),
        youtubeChannelId: channel.channelId,
        youtubeChannelTitle: channel.channelTitle,
      },
      update: {
        accessToken,
        // Só sobrescreve se o Google devolveu um novo (não rotaciona a cada
        // troca) — nunca apaga um refreshToken válido já salvo antes.
        ...(refreshToken ? { refreshToken } : {}),
        expiresAt: new Date(Date.now() + expiresInSeconds * 1000),
        youtubeChannelId: channel.channelId,
        youtubeChannelTitle: channel.channelTitle,
      },
    });

    return oauthPopupCloseResponse(
      `${appUrl}/app/social?youtubeConnected=${encodeURIComponent(channel.channelTitle)}`,
    );
  } catch (error) {
    console.error("YouTube OAuth callback failed:", error);
    const message = error instanceof Error ? error.message : "Unknown error connecting YouTube.";
    return oauthPopupCloseResponse(`${appUrl}/app/social?error=${encodeURIComponent(message)}`);
  }
};
