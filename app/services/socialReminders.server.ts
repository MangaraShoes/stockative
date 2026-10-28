import prisma from "../db.server";
import { isPinterestConfigured } from "./pinterest/oauth.server";
import { isTikTokConfigured } from "./tiktok/oauth.server";
import { isYouTubeConfigured } from "./youtube/oauth.server";

// Redes que a lojista ainda não conectou (Patricia, 28/10/2026: "se o
// cliente conectar uma rede e esquecer as outras devemos criar um aviso na
// tela inicial... e enviar um email lembrando que os posts não vão ser
// publicados em XXX redes"). O passo 2 do onboarding exige só o Instagram
// (com o Facebook junto, no mesmo login da Meta), então sem isso ela nunca
// fica sabendo que os posts poderiam sair também no Pinterest e os Reels no
// TikTok e no YouTube. O Instagram não entra aqui: é obrigatório, não dá pra
// dispensar, e sem ele o Weekly plan já avisa por conta própria.

export const SOCIAL_PLATFORMS = [
  { key: "pinterest", label: "Pinterest" },
  { key: "tiktok", label: "TikTok" },
  { key: "youtube", label: "YouTube" },
] as const;

export type SocialPlatformKey = (typeof SOCIAL_PLATFORMS)[number]["key"];

export function isSocialPlatformKey(value: string): value is SocialPlatformKey {
  return SOCIAL_PLATFORMS.some((platform) => platform.key === value);
}

// Rede sem credenciais no servidor nem aparece na tela de contas sociais —
// não faz sentido cobrar a lojista por ela.
function isConfigured(key: SocialPlatformKey): boolean {
  switch (key) {
    case "pinterest":
      return isPinterestConfigured();
    case "tiktok":
      return isTikTokConfigured();
    case "youtube":
      return isYouTubeConfigured();
  }
}

export interface MissingSocialPlatforms {
  missing: { key: SocialPlatformKey; label: string }[];
  ignored: { key: SocialPlatformKey; label: string }[];
}

export async function getMissingSocialPlatforms(shopId: string): Promise<MissingSocialPlatforms> {
  const [accounts, shop] = await Promise.all([
    prisma.socialAccount.findMany({
      where: { shopId },
      select: { platform: true },
    }),
    prisma.shop.findUniqueOrThrow({ where: { id: shopId }, select: { ignoredSocialPlatforms: true } }),
  ]);

  const connected = new Set<SocialPlatformKey>();
  for (const account of accounts) {
    if (isSocialPlatformKey(account.platform)) connected.add(account.platform);
  }

  const ignored = new Set(shop.ignoredSocialPlatforms);
  const notConnected = SOCIAL_PLATFORMS.filter(
    (platform) => isConfigured(platform.key) && !connected.has(platform.key),
  ).map(({ key, label }) => ({ key, label }));

  return {
    missing: notConnected.filter((platform) => !ignored.has(platform.key)),
    ignored: notConnected.filter((platform) => ignored.has(platform.key)),
  };
}

export async function setSocialPlatformIgnored(
  shopId: string,
  key: SocialPlatformKey,
  ignore: boolean,
): Promise<void> {
  const shop = await prisma.shop.findUniqueOrThrow({
    where: { id: shopId },
    select: { ignoredSocialPlatforms: true },
  });
  const current = new Set(shop.ignoredSocialPlatforms);
  if (ignore) current.add(key);
  else current.delete(key);
  await prisma.shop.update({
    where: { id: shopId },
    data: { ignoredSocialPlatforms: [...current] },
  });
}
