import prisma from "../db.server";
import { isMetaConfigured } from "./meta/oauth.server";
import { isPinterestConfigured } from "./pinterest/oauth.server";
import { isTikTokConfigured } from "./tiktok/oauth.server";
import { isYouTubeConfigured } from "./youtube/oauth.server";

// Redes que a lojista ainda não conectou (Patricia, 28/10/2026: "se o
// cliente conectar uma rede e esquecer as outras devemos criar um aviso na
// tela inicial... e enviar um email lembrando que os posts não vão ser
// publicados em XXX redes"). O passo 2 do onboarding só exige UMA rede, então
// sem isso ela nunca fica sabendo que os Reels poderiam sair também no
// TikTok e no YouTube. Instagram e Facebook contam como uma só: conectam
// juntos, no mesmo login da Meta.

export const SOCIAL_PLATFORMS = [
  { key: "meta", label: "Instagram & Facebook" },
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
    case "meta":
      return isMetaConfigured();
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
      select: { platform: true, igBusinessAccountId: true },
    }),
    prisma.shop.findUniqueOrThrow({ where: { id: shopId }, select: { ignoredSocialPlatforms: true } }),
  ]);

  // Mesmo critério de usableSocialAccountsWhere: um login da Meta que ficou
  // pela metade (sem conta Instagram Business) não publica em lugar nenhum.
  const connected = new Set<SocialPlatformKey>();
  for (const account of accounts) {
    if (account.platform === "instagram") {
      if (account.igBusinessAccountId) connected.add("meta");
    } else if (isSocialPlatformKey(account.platform)) {
      connected.add(account.platform);
    }
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

// "label, label and label" para o texto do banner e do e-mail.
export function joinPlatformLabels(labels: string[]): string {
  if (labels.length <= 1) return labels.join("");
  return `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`;
}
