import prisma from "../../db.server";
import { getContentItemImageJpegBuffer } from "../imageMvp/contentItemImageSource.server";
import { isAvatarVideoEnabled, MAX_AVATAR_SCRIPT_CHARS, MAX_AVATAR_VIDEO_ATTEMPTS } from "./avatarVideoConfig";
import { buildAvatarReel } from "./buildAvatarReel.server";
import { planAvatarShots, splitSentences } from "./avatarShots.server";
import { translateReelCaptions } from "./avatarCaptions.server";
import { createHeyGenAvatarVideo, getHeyGenVideo, HeyGenError } from "./heygen.server";

// Passado disso a montagem caiu no meio (redeploy) e pode ser retomada.
const STUCK_COMPOSING_MS = 10 * 60 * 1000;
const GIVE_UP_AFTER_MS = 2 * 60 * 60 * 1000;
const MAX_IMAGES = 4;

export type AvatarVideoResult = { status: "success" } | { status: "error"; reason: string };

export async function startAvatarVideo(params: {
  shopId: string;
  contentItemId: string;
  script: string;
}): Promise<AvatarVideoResult> {
  const script = params.script.trim();
  if (!script) return { status: "error", reason: "Write the script first." };
  if (script.length > MAX_AVATAR_SCRIPT_CHARS) {
    return { status: "error", reason: `The script can have up to ${MAX_AVATAR_SCRIPT_CHARS} characters.` };
  }

  const shop = await prisma.shop.findUnique({ where: { id: params.shopId } });
  if (!shop || !isAvatarVideoEnabled(shop.shopifyDomain)) {
    return { status: "error", reason: "Avatar videos aren't available for this store." };
  }
  if (!shop.heygenApiKey || !shop.heygenAvatarId || !shop.heygenVoiceId) {
    return { status: "error", reason: "Choose your avatar and voice in Settings first." };
  }

  // Reserva a tentativa antes de gastar dinheiro: dois cliques não passam
  // juntos do limite. O post fica retido desde já, senão poderia sair no
  // horário sem o vídeo.
  const claimed = await prisma.contentItem.updateMany({
    where: {
      id: params.contentItemId,
      shopId: params.shopId,
      status: { in: ["draft", "approved"] },
      avatarVideoAttempts: { lt: MAX_AVATAR_VIDEO_ATTEMPTS },
      OR: [{ avatarVideoStatus: null }, { avatarVideoStatus: { notIn: ["processing", "composing"] } }],
    },
    data: {
      avatarVideoAttempts: { increment: 1 },
      avatarVideoStatus: "processing",
      avatarVideoError: null,
      avatarScript: script,
      avatarVideoRequestedAt: new Date(),
      requiresApproval: true,
      status: "draft",
    },
  });
  if (claimed.count === 0) {
    return {
      status: "error",
      reason: `This post can't generate another video right now. The limit is ${MAX_AVATAR_VIDEO_ATTEMPTS} per post.`,
    };
  }

  try {
    const jobId = await createHeyGenAvatarVideo(shop.heygenApiKey, {
      avatarId: shop.heygenAvatarId,
      voiceId: shop.heygenVoiceId,
      script,
      title: `Stockative ${params.contentItemId}`,
    });
    await prisma.contentItem.update({
      where: { id: params.contentItemId },
      data: { avatarVideoJobId: jobId },
    });
    return { status: "success" };
  } catch (error) {
    console.error(`Failed to start avatar video for content item ${params.contentItemId}:`, error);
    const reason =
      error instanceof HeyGenError && [402, 403].includes(error.status)
        ? "HeyGen refused this video. Check your API balance and key."
        : "We couldn't reach HeyGen. Please try again.";
    await failAvatarVideo(params.contentItemId, reason, { refund: true });
    return { status: "error", reason };
  }
}

// Sem vídeo de avatar pronto, o post volta a seguir as regras normais.
async function failAvatarVideo(contentItemId: string, reason: string, { refund }: { refund: boolean }) {
  const item = await prisma.contentItem.findUnique({
    where: { id: contentItemId },
    select: { videoUploadedAt: true, avatarVideoAttempts: true },
  });
  if (!item) return;
  await prisma.contentItem.update({
    where: { id: contentItemId },
    data: {
      avatarVideoStatus: "failed",
      avatarVideoError: reason,
      avatarVideoJobId: null,
      requiresApproval: Boolean(item.videoUploadedAt),
      ...(refund ? { avatarVideoAttempts: Math.max(0, item.avatarVideoAttempts - 1) } : {}),
    },
  });
}

async function finishAvatarVideo(contentItemId: string, videoUrl: string, script: string) {
  const response = await fetch(videoUrl, { signal: AbortSignal.timeout(120_000) });
  if (!response.ok) throw new Error(`Could not download the avatar video: ${response.status}`);
  const avatarVideo = Buffer.from(await response.arrayBuffer());

  const images = await prisma.contentItemImage.findMany({
    where: { contentItemId },
    orderBy: { position: "asc" },
    take: MAX_IMAGES,
    select: { id: true },
  });
  const buffers = await Promise.all(images.map((image) => getContentItemImageJpegBuffer(image.id)));
  const languages = await prisma.contentItem.findUnique({
    where: { id: contentItemId },
    select: { shop: { select: { contentLanguagePrimary: true, contentLanguageSecondary: true } } },
  });
  const [sentenceShots, captions] = await Promise.all([
    planAvatarShots(script, buffers),
    translateReelCaptions(
      splitSentences(script),
      languages?.shop.contentLanguageSecondary,
      languages?.shop.contentLanguagePrimary,
    ),
  ]);
  const video = await buildAvatarReel({ avatarVideo, images: buffers, script, sentenceShots, captions });

  // Post publicado ou cancelado enquanto gerava: o vídeo é descartado.
  const saved = await prisma.contentItem.updateMany({
    where: { id: contentItemId, status: { in: ["draft", "approved"] } },
    data: {
      videoUrl: `data:video/mp4;base64,${video.toString("base64")}`,
      videoGeneratedAt: new Date(),
      videoUploadedAt: new Date(),
      videoSavedToShopifyAt: null,
      format: "reel",
      avatarVideoStatus: "ready",
      avatarVideoError: null,
      avatarVideoJobId: null,
      requiresApproval: true,
      status: "draft",
    },
  });
  if (saved.count === 0) {
    await prisma.contentItem.update({
      where: { id: contentItemId },
      data: { avatarVideoStatus: null, avatarVideoJobId: null, requiresApproval: false },
    });
  }
}

export async function pollAvatarVideos(): Promise<number> {
  const now = Date.now();
  const items = await prisma.contentItem.findMany({
    where: {
      avatarVideoJobId: { not: null },
      OR: [
        { avatarVideoStatus: "processing" },
        { avatarVideoStatus: "composing", updatedAt: { lt: new Date(now - STUCK_COMPOSING_MS) } },
      ],
    },
    select: {
      id: true,
      avatarVideoJobId: true,
      avatarVideoStatus: true,
      avatarVideoRequestedAt: true,
      avatarScript: true,
      shop: { select: { heygenApiKey: true } },
    },
  });

  let finished = 0;
  for (const item of items) {
    if (!item.avatarVideoJobId) continue;
    try {
      if (!item.shop.heygenApiKey) {
        await failAvatarVideo(item.id, "Your HeyGen key was removed.", { refund: false });
        continue;
      }
      const video = await getHeyGenVideo(item.shop.heygenApiKey, item.avatarVideoJobId);
      if (video.status === "failed") {
        await failAvatarVideo(item.id, video.failureMessage || "HeyGen couldn't generate this video.", {
          refund: true,
        });
        finished++;
        continue;
      }
      if (video.status !== "completed" || !video.videoUrl) {
        const requestedAt = item.avatarVideoRequestedAt?.getTime() ?? now;
        if (now - requestedAt > GIVE_UP_AFTER_MS) {
          await failAvatarVideo(item.id, "HeyGen took too long to generate this video.", { refund: false });
          finished++;
        }
        continue;
      }
      // Dois processos sobrepostos (redeploy) não montam o mesmo vídeo.
      const claimed = await prisma.contentItem.updateMany({
        where: { id: item.id, avatarVideoStatus: item.avatarVideoStatus },
        data: { avatarVideoStatus: "composing" },
      });
      if (claimed.count === 0) continue;
      await finishAvatarVideo(item.id, video.videoUrl, item.avatarScript ?? "");
      finished++;
    } catch (error) {
      console.error(`Failed to process avatar video for content item ${item.id}:`, error);
      // Volta para a fila: o job no HeyGen continua válido e já foi pago.
      await prisma.contentItem
        .updateMany({
          where: { id: item.id, avatarVideoStatus: "composing" },
          data: { avatarVideoStatus: "processing" },
        })
        .catch(() => undefined);
    }
  }
  return finished;
}
