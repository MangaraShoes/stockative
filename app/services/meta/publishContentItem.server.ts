import prisma from "../../db.server";
import { publishCarousel, publishSingleImage } from "./publish.server";

export type PublishResult =
  | { status: "success"; igMediaId: string }
  | { status: "error"; reason: string };

export async function publishContentItemToInstagram(
  contentItemId: string,
): Promise<PublishResult> {
  const contentItem = await prisma.contentItem.findUnique({
    where: { id: contentItemId },
    include: {
      images: { orderBy: { position: "asc" } },
    },
  });
  if (!contentItem) return { status: "error", reason: "Content item not found." };

  const socialAccount = await prisma.socialAccount.findFirst({
    where: { shopId: contentItem.shopId, platform: "instagram" },
  });
  if (!socialAccount || !socialAccount.igBusinessAccountId) {
    return {
      status: "error",
      reason: "No Instagram account connected. Connect one from the Social accounts page first.",
    };
  }

  if (contentItem.images.length === 0) {
    return {
      status: "error",
      reason: "This post has no images yet — build the carousel or generate an image first.",
    };
  }

  const appUrl = process.env.SHOPIFY_APP_URL;
  if (!appUrl) return { status: "error", reason: "App URL is not configured." };

  const imageUrls = contentItem.images.map(
    (image) => `${appUrl}/media/content-item-image/${image.id}`,
  );

  const target = {
    igBusinessAccountId: socialAccount.igBusinessAccountId,
    pageAccessToken: socialAccount.accessToken,
  };
  const caption = [contentItem.captionText, contentItem.hashtags]
    .filter(Boolean)
    .join("\n\n");

  try {
    const igMediaId =
      imageUrls.length === 1
        ? await publishSingleImage(target, imageUrls[0], caption)
        : await publishCarousel(target, imageUrls, caption);

    await prisma.contentItem.update({
      where: { id: contentItemId },
      data: {
        status: "published",
        publishedAt: new Date(),
        externalPostId: igMediaId,
      },
    });

    return { status: "success", igMediaId };
  } catch (error) {
    return {
      status: "error",
      reason: error instanceof Error ? error.message : "Unknown error publishing to Instagram.",
    };
  }
}
