import type { LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";
import prisma from "../db.server";
import {
  exchangeCodeForToken,
  exchangeForLongLivedToken,
  getInstagramBusinessAccount,
  verifyState,
} from "../services/meta/oauth.server";

// Callback público (fora do iframe embutido) — a Meta redireciona pra cá
// depois do merchant autorizar. Troca o código por token, descobre a Página
// + conta Instagram Business ligada, salva em SocialAccount, e manda o
// navegador de volta pro app embutido no admin da Shopify.
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const oauthError = url.searchParams.get("error_description");

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
    const shortLivedToken = await exchangeCodeForToken(code);
    const { accessToken: longLivedUserToken, expiresInSeconds } =
      await exchangeForLongLivedToken(shortLivedToken);
    const igAccount = await getInstagramBusinessAccount(longLivedUserToken);

    if (!igAccount) {
      return redirect(
        `${appUrl}/app/social?error=${encodeURIComponent(
          "No Instagram professional account linked to a Facebook Page was found on this account.",
        )}`,
      );
    }

    await prisma.socialAccount.upsert({
      where: { shopId_platform: { shopId: shop.id, platform: "instagram" } },
      create: {
        shopId: shop.id,
        platform: "instagram",
        accessToken: igAccount.pageAccessToken,
        expiresAt: new Date(Date.now() + expiresInSeconds * 1000),
        igBusinessAccountId: igAccount.igBusinessAccountId,
        fbPageId: igAccount.pageId,
      },
      update: {
        accessToken: igAccount.pageAccessToken,
        expiresAt: new Date(Date.now() + expiresInSeconds * 1000),
        igBusinessAccountId: igAccount.igBusinessAccountId,
        fbPageId: igAccount.pageId,
      },
    });

    return redirect(`${appUrl}/app/social?connected=${encodeURIComponent(igAccount.igUsername)}`);
  } catch (error) {
    console.error("Meta OAuth callback failed:", error);
    const message = error instanceof Error ? error.message : "Unknown error connecting Instagram.";
    return redirect(`${appUrl}/app/social?error=${encodeURIComponent(message)}`);
  }
};
