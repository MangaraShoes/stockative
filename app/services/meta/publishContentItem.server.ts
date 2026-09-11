import prisma from "../../db.server";
import { publishCarousel, publishSingleImage, publishStory } from "./publish.server";
import { buildFinalCaption, parseStoredHashtags } from "../decisionEngine/captionFormat";

// Story é sempre best-effort — nunca derruba a publicação do feed, que é o
// post principal (Patricia, 11/09/2026: "podemos também gerar um stories
// com este post ao mesmo tempo?"). Sem legenda: confirmado ao vivo que a
// API de Stories não tem campo de caption — ver publishStory em publish.server.ts.
export type StoryPublishOutcome =
  | { status: "not_attempted" } // sem imagem hero disponível
  | { status: "published"; igMediaId: string }
  | { status: "failed"; reason: string };

export type PublishResult =
  | { status: "success"; igMediaId: string; story: StoryPublishOutcome }
  | { status: "error"; reason: string };

// shopId vem sempre da sessão autenticada de quem chama, nunca de dado
// enviado pelo cliente (Patricia, 11/09/2026 — achado crítico: o endpoint
// aceitava qualquer contentItemId e publicava usando a conta Instagram da
// LOJA DONA daquele post, não da loja autenticada na requisição — uma loja
// poderia publicar através da conta de outra só adivinhando/reaproveitando
// um ID). Todo lookup abaixo filtra por shopId também, nunca só por id.
export async function publishContentItemToInstagram(
  contentItemId: string,
  shopId: string,
): Promise<PublishResult> {
  // Trava contra publicação duplicada: só segue se conseguir marcar como
  // "publishing" a partir de um estado que não seja já published/publishing
  // — um clique duplo ou um retry concorrente encontra count=0 e para aqui,
  // antes de gastar uma chamada real à Meta.
  const claimed = await prisma.contentItem.updateMany({
    where: { id: contentItemId, shopId, status: { notIn: ["published", "publishing"] } },
    data: { status: "publishing" },
  });
  if (claimed.count === 0) {
    const existing = await prisma.contentItem.findFirst({ where: { id: contentItemId, shopId } });
    if (!existing) return { status: "error", reason: "Content item not found." };
    if (existing.status === "published") {
      return { status: "error", reason: "This post was already published." };
    }
    return { status: "error", reason: "This post is already being published." };
  }

  const contentItem = await prisma.contentItem.findUniqueOrThrow({
    where: { id: contentItemId },
    include: { images: { orderBy: { position: "asc" } } },
  });

  const socialAccount = await prisma.socialAccount.findFirst({
    where: { shopId: contentItem.shopId, platform: "instagram" },
  });
  if (!socialAccount || !socialAccount.igBusinessAccountId) {
    await prisma.contentItem.update({ where: { id: contentItemId }, data: { status: "draft" } });
    return {
      status: "error",
      reason: "No Instagram account connected. Connect one from the Social accounts page first.",
    };
  }

  if (contentItem.images.length === 0) {
    await prisma.contentItem.update({ where: { id: contentItemId }, data: { status: "draft" } });
    return {
      status: "error",
      reason: "This post has no images yet — build the carousel or generate an image first.",
    };
  }

  const appUrl = process.env.SHOPIFY_APP_URL;
  if (!appUrl) {
    await prisma.contentItem.update({ where: { id: contentItemId }, data: { status: "draft" } });
    return { status: "error", reason: "App URL is not configured." };
  }

  const imageUrls = contentItem.images.map(
    (image) => `${appUrl}/media/content-item-image/${image.id}`,
  );

  const target = {
    igBusinessAccountId: socialAccount.igBusinessAccountId,
    pageAccessToken: socialAccount.accessToken,
  };
  // Mesma função usada no preview da tela de Create content — nunca mais
  // divergir do que o merchant aprovou (hashtags com #, CTA incluído).
  const caption = buildFinalCaption({
    captionText: contentItem.captionText ?? "",
    cta: contentItem.cta,
    hashtags: parseStoredHashtags(contentItem.hashtags),
  });

  try {
    const igMediaId =
      imageUrls.length === 1
        ? await publishSingleImage(target, imageUrls[0], caption)
        : await publishCarousel(target, imageUrls, caption);

    // Story usa a mesma imagem hero (posição 1) do feed — best-effort, nunca
    // falha a publicação principal se der errado.
    let story: StoryPublishOutcome = { status: "not_attempted" };
    const heroImageUrl = imageUrls[0];
    if (heroImageUrl) {
      try {
        const storyMediaId = await publishStory(target, heroImageUrl);
        story = { status: "published", igMediaId: storyMediaId };
      } catch (storyError) {
        story = {
          status: "failed",
          reason: storyError instanceof Error ? storyError.message : "Unknown error publishing story.",
        };
      }
    }

    await prisma.contentItem.update({
      where: { id: contentItemId },
      data: {
        status: "published",
        publishedAt: new Date(),
        externalPostId: igMediaId,
        storyExternalPostId: story.status === "published" ? story.igMediaId : null,
      },
    });

    return { status: "success", igMediaId, story };
  } catch (error) {
    // "failed" preserva o sinal de que uma tentativa real quebrou (em vez de
    // voltar pra "draft" silenciosamente) — o merchant vê e decide se tenta
    // de novo; o guard de duplicata acima permite retry porque "failed" não
    // está em (published, publishing).
    await prisma.contentItem.update({ where: { id: contentItemId }, data: { status: "failed" } });
    return {
      status: "error",
      reason: error instanceof Error ? error.message : "Unknown error publishing to Instagram.",
    };
  }
}
