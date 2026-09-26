import prisma from "../../db.server";
import {
  publishCarousel,
  publishFacebookVideo,
  publishReel,
  publishSingleImage,
  publishStory,
  publishToFacebookPage,
} from "./publish.server";
import { buildFinalCaption, parseStoredHashtags } from "../decisionEngine/captionFormat";
import { getOrCreateBoardForCategory } from "../pinterest/boards.server";
import { createPin } from "../pinterest/publish.server";
import { uploadVideoToInbox } from "../tiktok/publish.server";
import { getValidTikTokAccessToken } from "../tiktok/oauth.server";
import { uploadShort } from "../youtube/publish.server";
import { getValidYouTubeAccessToken } from "../youtube/oauth.server";
import { uploadGeneratedImageToProduct } from "../shopify/uploadProductImage.server";
import { unauthenticated } from "../../shopify.server";
import { getOrCreateTrackedLink, buildTrackedUrl } from "../trackedLink.server";

// Story é sempre best-effort — nunca derruba a publicação do feed, que é o
// post principal (Patricia, 11/09/2026: "podemos também gerar um stories
// com este post ao mesmo tempo?"). Sem legenda: confirmado ao vivo que a
// API de Stories não tem campo de caption — ver publishStory em publish.server.ts.
export type StoryPublishOutcome =
  | { status: "not_attempted" } // sem imagem hero disponível
  | { status: "published"; igMediaId: string }
  | { status: "failed"; reason: string };

// Mesma lógica best-effort do Story: espelhar o post na Página do Facebook
// nunca derruba a publicação principal do Instagram (Patricia, 11/09/2026:
// "precisamos fazer o mesmo post do IG no facebook"). "not_attempted"
// cobre o caso de a conta conectada não ter uma Página vinculada com
// fbPageId salvo (não deveria acontecer hoje, já que toda conexão de
// Instagram passa por uma Página, mas é defensivo).
export type FacebookPublishOutcome =
  | { status: "not_attempted" }
  | { status: "published"; postId: string }
  | { status: "failed"; reason: string };

// Best-effort igual ao Story/Facebook: espelha o post num Pin, no board da
// categoria do produto (Patricia, 11/09/2026 — "cria um app automatico
// separando todos os posts por categorias dentro do pinterest"). "not
// attempted" cobre tanto "Pinterest não conectado" quanto "produto sem
// categoria pra rotear o board".
export type PinterestPublishOutcome =
  | { status: "not_attempted"; reason?: string }
  | { status: "published"; pinId: string }
  | { status: "failed"; reason: string };

// Best-effort igual aos outros — só tentado pra post format="reel" (TikTok
// só aceita vídeo), e só entrega na caixa de rascunhos do TikTok da
// lojista, não publica sozinho (ver uploadVideoToInbox em
// tiktok/publish.server.ts pro motivo: a Content Posting API exige
// auditoria pra Direct Post, e a Stockative ainda não passou por ela).
export type TikTokPublishOutcome =
  | { status: "not_attempted"; reason?: string }
  | { status: "published"; publishId: string }
  | { status: "failed"; reason: string };

// Best-effort igual aos outros — só tentado pra post format="reel" (Shorts
// é vídeo vertical curto). Diferente do TikTok, o YouTube não exige
// auditoria pra publicação direta: sucesso aqui já É publicação real e
// pública (privacyStatus: "public", decisão de Patricia, 25/09/2026), sem
// a nuance de "entregue mas não publicado" que o TikTok tem.
export type YouTubePublishOutcome =
  | { status: "not_attempted"; reason?: string }
  | { status: "published"; videoId: string }
  | { status: "failed"; reason: string };

export type PublishResult =
  | {
      status: "success";
      igMediaId: string;
      story: StoryPublishOutcome;
      facebook: FacebookPublishOutcome;
      pinterest: PinterestPublishOutcome;
      tiktok: TikTokPublishOutcome;
      youtube: YouTubePublishOutcome;
    }
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
  // antes de gastar uma chamada real à Meta. "partial" (ver abaixo) NÃO
  // está nessa lista de propósito — precisa poder ser reclamado de novo pra
  // terminar o que ficou pendente.
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
    include: {
      images: { orderBy: { position: "asc" }, include: { creativeAsset: true } },
      product: true,
      shop: true,
    },
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

  if (contentItem.format === "reel" && !contentItem.videoUrl) {
    await prisma.contentItem.update({ where: { id: contentItemId }, data: { status: "draft" } });
    return {
      status: "error",
      reason: "This reel hasn't been assembled yet — generate the video first.",
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

  // Único jeito real de medir clique-pra-loja hoje (análise estratégica,
  // 14/09/2026: "converter vendas é hoje inmensurável"). Limitação de
  // plataforma, não de código: o Instagram não aceita link clicável no
  // texto do feed nem do Story, só o link da bio (da conta inteira, não
  // deste post) — então isso só cobre o que o Facebook e o Pinterest
  // aceitam de verdade. Sem productUrl, segue sem link, como já era.
  const trackedUrl = contentItem.product?.productUrl
    ? buildTrackedUrl(appUrl, await getOrCreateTrackedLink(contentItemId))
    : null;

  // Corrigido em 12/09/2026 (achado de revisão externa: "if Instagram
  // succeeds but a later database operation fails, the item can become
  // failed. Retrying then republishes the Instagram post"). O post no
  // Instagram em si é o único passo que NÃO pode ser refeito com segurança
  // (republicar cria um post duplicado de verdade) — por isso, assim que a
  // Meta confirma o ID, isso é gravado imediatamente, antes de qualquer
  // outra etapa. Se o processo cair depois disso (Story, Facebook,
  // Pinterest, ou a escrita final), o retry seguinte vê `externalPostId`
  // já preenchido e pula direto pra reconciliar as etapas restantes, nunca
  // publica de novo no Instagram.
  let igMediaId = contentItem.externalPostId ?? null;
  try {
    if (!igMediaId) {
      if (contentItem.format === "reel") {
        const videoUrl = `${appUrl}/media/content-item-video/${contentItem.id}`;
        igMediaId = await publishReel(target, videoUrl, caption);
      } else {
        igMediaId =
          imageUrls.length === 1
            ? await publishSingleImage(target, imageUrls[0], caption)
            : await publishCarousel(target, imageUrls, caption);
      }

      await prisma.contentItem.update({
        where: { id: contentItemId },
        data: { status: "partial", externalPostId: igMediaId },
      });
    }

    // Story usa a mesma imagem hero (posição 1) do feed — best-effort, nunca
    // falha a publicação principal se der errado. Se um retry anterior já
    // conseguiu, reaproveita em vez de publicar um Story duplicado.
    let story: StoryPublishOutcome = contentItem.storyExternalPostId
      ? { status: "published", igMediaId: contentItem.storyExternalPostId }
      : { status: "not_attempted" };
    const heroImageUrl = imageUrls[0];
    if (story.status === "not_attempted" && heroImageUrl) {
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

    // Espelha o mesmo post na Página do Facebook vinculada — mesma imagem
    // (ou carrossel) e mesma legenda do Instagram, também best-effort. Mesma
    // proteção contra duplicar num retry.
    let facebook: FacebookPublishOutcome = contentItem.facebookExternalPostId
      ? { status: "published", postId: contentItem.facebookExternalPostId }
      : { status: "not_attempted" };
    if (facebook.status === "not_attempted" && socialAccount.fbPageId) {
      try {
        // Facebook aceita link clicável direto no texto do post (o
        // Instagram não) — vai só aqui, nunca no caption compartilhado
        // usado pelo Instagram/tradução.
        const facebookCaption = trackedUrl ? `${caption}\n\n${trackedUrl}` : caption;
        const facebookTarget = {
          pageId: socialAccount.fbPageId,
          pageAccessToken: socialAccount.accessToken,
        };
        // Reel espelha como vídeo de verdade, não como imagem/carrossel —
        // Patricia, 14/09/2026: "cobre o Facebook mirror publicando como
        // vídeo também".
        const facebookPostId =
          contentItem.format === "reel"
            ? await publishFacebookVideo(
                facebookTarget,
                `${appUrl}/media/content-item-video/${contentItem.id}`,
                facebookCaption,
              )
            : await publishToFacebookPage(facebookTarget, imageUrls, facebookCaption);
        facebook = { status: "published", postId: facebookPostId };
      } catch (facebookError) {
        facebook = {
          status: "failed",
          reason:
            facebookError instanceof Error
              ? facebookError.message
              : "Unknown error publishing to Facebook.",
        };
      }
    }

    // Espelha num Pin no board da categoria do produto — mesma imagem hero,
    // best-effort igual ao Facebook/Story, mesma proteção contra duplicar.
    let pinterest: PinterestPublishOutcome = contentItem.pinterestExternalPostId
      ? { status: "published", pinId: contentItem.pinterestExternalPostId }
      : { status: "not_attempted" };
    if (pinterest.status === "not_attempted") {
      const pinterestAccount = await prisma.socialAccount.findFirst({
        where: { shopId: contentItem.shopId, platform: "pinterest" },
      });
      if (pinterestAccount) {
        const category = contentItem.product?.productType?.trim();
        if (!category) {
          pinterest = {
            status: "not_attempted",
            reason: "Product has no category set, so there's no board to route it to.",
          };
        } else {
          try {
            const boardId = await getOrCreateBoardForCategory(
              contentItem.shopId,
              { accessToken: pinterestAccount.accessToken },
              category,
            );
            const pinId = await createPin(
              { accessToken: pinterestAccount.accessToken },
              {
                boardId,
                imageUrl: imageUrls[0],
                title: contentItem.product?.title ?? "New arrival",
                description: contentItem.captionText ?? "",
                link: trackedUrl ?? contentItem.product?.productUrl,
              },
            );
            pinterest = { status: "published", pinId };
          } catch (pinterestError) {
            pinterest = {
              status: "failed",
              reason:
                pinterestError instanceof Error
                  ? pinterestError.message
                  : "Unknown error publishing to Pinterest.",
            };
          }
        }
      }
    }

    // Espelha o Reel na caixa de rascunhos do TikTok — só tentado pra
    // post format="reel" (TikTok só aceita vídeo), best-effort igual ao
    // Pinterest/Facebook. A lojista ainda precisa abrir o TikTok e confirmar
    // a publicação de lá (ver uploadVideoToInbox), então isso nunca conta
    // como "published" de verdade, só como "entregue".
    let tiktok: TikTokPublishOutcome = contentItem.tiktokExternalPostId
      ? { status: "published", publishId: contentItem.tiktokExternalPostId }
      : { status: "not_attempted" };
    if (tiktok.status === "not_attempted" && contentItem.format === "reel") {
      const tiktokAccount = await prisma.socialAccount.findFirst({
        where: { shopId: contentItem.shopId, platform: "tiktok" },
      });
      if (tiktokAccount) {
        try {
          const accessToken = await getValidTikTokAccessToken(tiktokAccount);
          const publishId = await uploadVideoToInbox(
            { accessToken },
            `${appUrl}/media/content-item-video/${contentItem.id}`,
          );
          tiktok = { status: "published", publishId };
        } catch (tiktokError) {
          tiktok = {
            status: "failed",
            reason:
              tiktokError instanceof Error
                ? tiktokError.message
                : "Unknown error sending to TikTok.",
          };
        }
      }
    }

    // Espelha o Reel como YouTube Short — só tentado pra post format="reel",
    // best-effort igual ao TikTok/Pinterest. Diferente do TikTok, publica
    // público e direto de verdade (sem passo de confirmação manual), então
    // "published" aqui significa a mesma coisa que no Instagram/Facebook.
    let youtube: YouTubePublishOutcome = contentItem.youtubeExternalPostId
      ? { status: "published", videoId: contentItem.youtubeExternalPostId }
      : { status: "not_attempted" };
    if (youtube.status === "not_attempted" && contentItem.format === "reel") {
      const youtubeAccount = await prisma.socialAccount.findFirst({
        where: { shopId: contentItem.shopId, platform: "youtube" },
      });
      if (youtubeAccount) {
        try {
          const accessToken = await getValidYouTubeAccessToken(youtubeAccount);
          const base64Video = contentItem.videoUrl!.split(",")[1];
          const videoBuffer = Buffer.from(base64Video, "base64");
          const videoId = await uploadShort(
            { accessToken },
            videoBuffer,
            { title: contentItem.product?.title ?? "New arrival", description: caption },
          );
          youtube = { status: "published", videoId };
        } catch (youtubeError) {
          youtube = {
            status: "failed",
            reason:
              youtubeError instanceof Error
                ? youtubeError.message
                : "Unknown error uploading to YouTube.",
          };
        }
      }
    }

    await prisma.contentItem.update({
      where: { id: contentItemId },
      data: {
        status: "published",
        publishedAt: new Date(),
        externalPostId: igMediaId,
        storyExternalPostId: story.status === "published" ? story.igMediaId : null,
        facebookExternalPostId: facebook.status === "published" ? facebook.postId : null,
        pinterestExternalPostId: pinterest.status === "published" ? pinterest.pinId : null,
        tiktokExternalPostId: tiktok.status === "published" ? tiktok.publishId : null,
        youtubeExternalPostId: youtube.status === "published" ? youtube.videoId : null,
      },
    });

    // A imagem que acabou de ser aprovada/postada vai pra galeria do
    // produto de verdade na Shopify, como a ÚLTIMA foto (Patricia,
    // 13/09/2026: "esta imagem que foi aprovada/postada vai para o produto
    // como a ultima imagem") — best-effort igual Story/Facebook/Pinterest,
    // nunca derruba a publicação principal se falhar. Só a imagem hero
    // (posição 1) importa aqui; ela é sempre a única gerada pela IA no
    // carrossel, os stills nas posições seguintes já são fotos reais do
    // produto que já estão na loja.
    const heroImage = contentItem.images.find((img) => img.position === 1);
    // galleryImageUploadedAt evita subir a mesma imagem de novo num retry de
    // item "partial" (Instagram publicou, uma etapa seguinte falhou e este
    // bloco roda outra vez) — sem essa checagem, cada retry duplicava a foto
    // na galeria do produto (achado de revisão de código, 13/09/2026).
    if (heroImage?.creativeAsset && contentItem.product && !contentItem.galleryImageUploadedAt) {
      try {
        const { admin } = await unauthenticated.admin(contentItem.shop.shopifyDomain);
        await uploadGeneratedImageToProduct(admin, {
          shopifyProductId: contentItem.product.shopifyProductId,
          imageDataUrl: heroImage.creativeAsset.imageUrl,
          filename: `${contentItem.product.title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-ai-editorial.jpg`,
          alt: `${contentItem.product.title} — AI-generated editorial photo`,
        });
        await prisma.contentItem.update({
          where: { id: contentItemId },
          data: { galleryImageUploadedAt: new Date() },
        });
      } catch (uploadError) {
        console.error("Failed to add published image to product gallery:", uploadError);
      }
    }

    return { status: "success", igMediaId, story, facebook, pinterest, tiktok, youtube };
  } catch (error) {
    // Se o Instagram já tinha sido publicado (igMediaId setado) antes do
    // erro, "partial" preserva isso e permite reconciliar no próximo retry
    // sem publicar de novo — só volta pra "failed" (nunca republicável sem
    // checar primeiro) quando nem o Instagram chegou a sair.
    await prisma.contentItem.update({
      where: { id: contentItemId },
      data: { status: igMediaId ? "partial" : "failed" },
    });
    return {
      status: "error",
      reason: error instanceof Error ? error.message : "Unknown error publishing to Instagram.",
    };
  }
}

export interface DueContentItemOutcome {
  contentItemId: string;
  shopId: string;
  result: PublishResult;
}

// Publica sozinho tudo que já passou do horário agendado (Patricia,
// 12/09/2026: "caso ele nao interaja com o app vamos seguir postando os
// produtos definidos pelo app nos dias e horarios tbem pre definidos") —
// roda pra TODAS as lojas de uma vez, pensado pra ser chamado por um
// scheduler externo (ver rota /cron/publish-scheduled). "approved" conta
// junto com "draft" de propósito: aprovar é só a lojista sinalizando que
// revisou, nunca é pré-requisito pra publicar — se ela não mexer em nada, o
// post sai do mesmo jeito. publishContentItemToInstagram já tem a trava
// atômica contra publicação duplicada, então é seguro rodar isso em cima de
// um post que a lojista também esteja publicando manualmente ao mesmo tempo.
// Um processo morto no meio de uma publicação deixa o post preso em
// "publishing" pra sempre — o guard atômico de publishContentItemToInstagram
// exclui esse status de propósito (pra não publicar duas vezes em paralelo
// de verdade), então precisa de alguém de fora pra destravar. Passado esse
// tempo sem terminar, mais provável que o processo tenha morrido do que
// ainda estar rodando (achado de revisão externa, 12/09/2026: "a process
// interruption can... leave it stuck in publishing").
const STUCK_PUBLISHING_MINUTES = 10;

export async function publishDueContentItems(): Promise<DueContentItemOutcome[]> {
  await prisma.contentItem.updateMany({
    where: {
      status: "publishing",
      updatedAt: { lt: new Date(Date.now() - STUCK_PUBLISHING_MINUTES * 60 * 1000) },
    },
    // "partial" (não "draft") — se o Instagram já tinha sido publicado antes
    // de travar, o retry via publishContentItemToInstagram vê o
    // externalPostId já salvo e reconcilia em vez de publicar de novo.
    data: { status: "partial" },
  });

  const due = await prisma.contentItem.findMany({
    where: {
      // "partial" entra junto: post que publicou no Instagram mas travou
      // antes de terminar Story/Facebook/Pinterest/a escrita final — precisa
      // ser retomado, não fica esperando um novo agendamento (já tem data
      // no passado de qualquer forma).
      status: { in: ["draft", "approved", "partial"] },
      scheduledAt: { lte: new Date() },
      // Corrigido em 12/09/2026 (achado de revisão externa: "the uninstall
      // handler... does not deactivate the shop... queued publication could
      // continue"). Loja desinstalada nunca mais é considerada aqui.
      shop: { uninstalledAt: null },
    },
    select: {
      id: true,
      shopId: true,
      images: { select: { id: true } },
      promotion: { select: { name: true, endsAt: true } },
    },
  });

  // Nunca tenta publicar um post sem nenhuma imagem (achado de revisão,
  // 12/09/2026: "the planner can assign dates to posts without images...
  // they remain eligible for repeated attempts") — sem essa checagem, um
  // post que falhou a geração de imagem ficava batendo na Meta API todo
  // ciclo do scheduler pra sempre falhar do mesmo jeito. Fica pendente
  // (nem tenta, nem marca como failed) até a lojista gerar uma imagem
  // manualmente em "Create content" ou trocar o produto do slot.
  const outcomes: DueContentItemOutcome[] = [];
  for (const item of due) {
    if (item.images.length === 0) continue;

    // Nunca publica um post de promoção depois que ela terminou (Patricia,
    // 13/09/2026: "sim trava a publicação depois do prazo") — sem isso, um
    // post atrasado (ex.: cron parado por algumas horas) poderia anunciar
    // "20% off até sexta" já no sábado. Cancela em vez de publicar.
    if (item.promotion && item.promotion.endsAt < new Date()) {
      await prisma.contentItem.update({
        where: { id: item.id },
        data: { status: "cancelled" },
      });
      outcomes.push({
        contentItemId: item.id,
        shopId: item.shopId,
        result: {
          status: "error",
          reason: `Promotion "${item.promotion.name}" already ended — never published.`,
        },
      });
      continue;
    }

    const result = await publishContentItemToInstagram(item.id, item.shopId);
    outcomes.push({ contentItemId: item.id, shopId: item.shopId, result });
  }
  return outcomes;
}
