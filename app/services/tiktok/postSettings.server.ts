import { Prisma } from "@prisma/client";
import prisma from "../../db.server";
import { getValidTikTokAccessToken } from "./oauth.server";
import { queryTikTokCreatorInfo } from "./publish.server";
import {
  validateTikTokPostSettings,
  type TikTokCreatorInfo,
  type TikTokPostSettings,
} from "./postSettings";

export type TikTokCreatorInfoResult =
  | { status: "not_connected" }
  | { status: "ok"; creator: TikTokCreatorInfo }
  | { status: "error"; reason: string };

// Diretrizes do TikTok: a tela de "postar no TikTok" tem que mostrar a
// conta de destino e as opções atuais dela toda vez que é renderizada —
// por isso é consultado ao vivo no loader do Weekly Plan, nunca guardado.
export async function getTikTokCreatorInfoForShop(shopId: string): Promise<TikTokCreatorInfoResult> {
  const account = await prisma.socialAccount.findUnique({
    where: { shopId_platform: { shopId, platform: "tiktok" } },
  });
  if (!account) return { status: "not_connected" };
  try {
    const accessToken = await getValidTikTokAccessToken(account);
    return { status: "ok", creator: await queryTikTokCreatorInfo({ accessToken }) };
  } catch (error) {
    console.error("Failed to load TikTok creator info:", error);
    return {
      status: "error",
      reason: error instanceof Error ? error.message : "Couldn't reach TikTok.",
    };
  }
}

export type SaveTikTokSettingsResult = { status: "success" } | { status: "error"; reason: string };

// Grava a configuração + o consentimento expresso da lojista pra UM Reel.
// Revalida contra o creator_info ao vivo (nunca confia só na tela) e só
// aceita Reel que ainda não saiu no ar.
export async function saveTikTokPostSettings(params: {
  shopId: string;
  contentItemId: string;
  settings: Omit<TikTokPostSettings, "consentedAt">;
}): Promise<SaveTikTokSettingsResult> {
  const item = await prisma.contentItem.findFirst({
    where: { id: params.contentItemId, shopId: params.shopId },
    select: { format: true, status: true },
  });
  if (!item) return { status: "error", reason: "This post is no longer part of the current plan." };
  if (item.format !== "reel") return { status: "error", reason: "Only Reels can be posted to TikTok." };
  if (!["draft", "approved"].includes(item.status)) {
    return { status: "error", reason: "This post has already been scheduled or published." };
  }

  const creatorResult = await getTikTokCreatorInfoForShop(params.shopId);
  if (creatorResult.status === "not_connected") {
    return { status: "error", reason: "Connect TikTok first — see Social accounts." };
  }
  if (creatorResult.status === "error") {
    return { status: "error", reason: `Couldn't check your TikTok account: ${creatorResult.reason}` };
  }
  const invalidReason = validateTikTokPostSettings(params.settings, creatorResult.creator);
  if (invalidReason) return { status: "error", reason: invalidReason };

  const settings: TikTokPostSettings = { ...params.settings, consentedAt: new Date().toISOString() };
  await prisma.contentItem.update({
    where: { id: params.contentItemId },
    data: { tiktokSettings: settings as unknown as Prisma.InputJsonValue },
  });
  return { status: "success" };
}

// "Não postar este Reel no TikTok" — volta a não ter consentimento.
export async function clearTikTokPostSettings(params: {
  shopId: string;
  contentItemId: string;
}): Promise<SaveTikTokSettingsResult> {
  const result = await prisma.contentItem.updateMany({
    where: { id: params.contentItemId, shopId: params.shopId, status: { in: ["draft", "approved"] } },
    data: { tiktokSettings: Prisma.DbNull },
  });
  if (result.count === 0) {
    return { status: "error", reason: "This post has already been scheduled or published." };
  }
  return { status: "success" };
}
