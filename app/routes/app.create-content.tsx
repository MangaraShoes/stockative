import { useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData, useNavigate } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { goTo } from "../utils/navigateOnClick";
import {
  COMMERCIAL_OBJECTIVES,
  CONTENT_LANGUAGES,
  type CommercialObjective,
  type ContentLanguageCode,
} from "../services/decisionEngine/constants";
import { inferObjective } from "../services/decisionEngine/archetypes.server";
import { decideContentBrief, describeEvidence } from "../services/decisionEngine/stage1.server";
import { generateCreativeCopy } from "../services/decisionEngine/stage2.server";
import { translateCaption, buildBilingualCaption } from "../services/decisionEngine/translateCaption.server";
import { buildFinalCaption, maxPrimaryCaptionChars } from "../services/decisionEngine/captionFormat";
import { generateProductImage } from "../services/imageMvp/generateProductImage.server";
import { assessProductImageQuality } from "../services/imageMvp/assessProductImageQuality.server";
import { getProductUsageStats } from "../services/decisionEngine/contentHistory.server";
import { buildCarousel } from "../services/imageMvp/buildCarousel.server";
import { generateReelForContentItem } from "../services/video/generateReelForContentItem.server";
import { publishContentItemToInstagram } from "../services/meta/publishContentItem.server";
import { uploadGeneratedImageToProduct } from "../services/shopify/uploadProductImage.server";
import type { Stage1Output } from "../services/decisionEngine/stage1.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);

  const shop = await prisma.shop.findUnique({
    where: { shopifyDomain: session.shop },
  });

  const products = shop
    ? await prisma.productCache.findMany({
        where: { shopId: shop.id },
        include: { commerceSignal: true },
        orderBy: { title: "asc" },
      })
    : [];

  const usageStats = shop ? await getProductUsageStats(shop.id) : {};

  // O botão de publicar só deve prometer as plataformas de fato conectadas —
  // o Facebook não tem conexão própria, ele publica junto sempre que o
  // Instagram estiver ligado a uma Página (fbPageId), então segue o mesmo
  // SocialAccount do Instagram.
  const socialAccounts = shop
    ? await prisma.socialAccount.findMany({ where: { shopId: shop.id } })
    : [];
  const instagramAccount = socialAccounts.find((a) => a.platform === "instagram");
  const pinterestAccount = socialAccounts.find((a) => a.platform === "pinterest");
  const connectedPlatforms = {
    instagram: Boolean(instagramAccount?.igBusinessAccountId),
    facebook: Boolean(instagramAccount?.fbPageId),
    pinterest: Boolean(pinterestAccount),
  };

  // Recupera o rascunho mais recente ao voltar pra página (Patricia,
  // 12/09/2026: "qdo eu dei um refresh na pagina sumiu tudo ele nao guarda
  // oque estava acontecendo") — o ContentItem, a legenda e as imagens já
  // estavam salvos no banco o tempo todo, só a tela não os recarregava
  // depois de um refresh, porque tudo vinha só do fetcher da última ação.
  const latestDraft = shop
    ? await prisma.contentItem.findFirst({
        where: { shopId: shop.id, status: "draft" },
        orderBy: { createdAt: "desc" },
        include: {
          images: {
            orderBy: { position: "asc" },
            include: { creativeAsset: true, productImage: true },
          },
        },
      })
    : null;

  const resumedContent = latestDraft
    ? {
        intent: "generate-content" as const,
        productId: latestDraft.productId ?? "",
        contentItemId: latestDraft.id,
        brief: latestDraft.decisionBrief as Stage1Output,
        copy: {
          captionText: latestDraft.captionText ?? "",
          hashtags: latestDraft.hashtags ? latestDraft.hashtags.split(", ") : [],
          cta: latestDraft.cta ?? "",
        },
        wasAutoObjective: false,
      }
    : null;

  // Um só ContentItemImage (posição 1, com creativeAsset) reflete "gerou a
  // imagem única" (seção 4); mais de uma reflete "montou o carrossel"
  // (seção 5) — nunca os dois ao mesmo tempo, mesma exclusividade que já
  // existe ao vivo entre os dois fluxos.
  const singleResumedImage =
    latestDraft && latestDraft.images.length === 1 ? latestDraft.images[0] : null;
  const resumedImage =
    singleResumedImage?.creativeAsset
      ? {
          status: "success" as const,
          creativeAssetId: singleResumedImage.creativeAsset.id,
          imageUrl: singleResumedImage.creativeAsset.imageUrl,
          attempts: 1,
        }
      : null;

  const resumedCarousel =
    latestDraft && latestDraft.images.length > 1
      ? {
          status: "success" as const,
          heroWasReused: false,
          heroAssetId: latestDraft.images[0]?.creativeAsset?.id ?? "",
          images: latestDraft.images.map((img) => ({
            position: img.position,
            url: img.creativeAsset?.imageUrl ?? img.productImage?.url ?? "",
            source: img.creativeAssetId
              ? ("ai_generated" as const)
              : ("shopify_existing" as const),
          })),
        }
      : null;

  const resumedReel =
    latestDraft?.format === "reel" && latestDraft.videoUrl
      ? { status: "success" as const, videoUrl: latestDraft.videoUrl }
      : null;

  return {
    products,
    hasBrandVoice: Boolean(shop?.brandTone?.trim()),
    usageStats,
    connectedPlatforms,
    contentLanguagePrimary: shop?.contentLanguagePrimary ?? "en",
    contentLanguageSecondary: shop?.contentLanguageSecondary ?? null,
    resumedContent,
    resumedImage,
    resumedCarousel,
    resumedReel,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent");

  const shop = await prisma.shop.findUnique({
    where: { shopifyDomain: session.shop },
  });
  if (!shop) throw new Response("Shop not found", { status: 404 });

  if (intent === "generate-image") {
    const productId = String(formData.get("productId"));
    const contentItemId = String(formData.get("contentItemId"));
    const creativeAngle = String(formData.get("creativeAngle"));
    const format = String(formData.get("format"));
    const correctionNote = String(formData.get("correctionNote") ?? "").trim() || undefined;

    // Nunca confiar em productId/contentItemId vindos do form sem checar que
    // pertencem à loja autenticada — mesma classe de falha achada por
    // Patricia na publicação (11/09/2026), aplicada aqui também.
    const ownedContentItem = await prisma.contentItem.findFirst({
      where: { id: contentItemId, shopId: shop.id },
    });
    if (!ownedContentItem) throw new Response("Content item not found", { status: 404 });

    const product = await prisma.productCache.findFirst({
      where: { id: productId, shopId: shop.id },
    });
    if (!product?.imageUrl) {
      return {
        intent: "generate-image" as const,
        result: {
          status: "fallback" as const,
          reason: "This product has no reference photo to generate from.",
          attempts: 0,
        },
      };
    }

    const result = await generateProductImage({
      shopId: shop.id,
      productId: product.id,
      contentItemId,
      referenceImageUrl: product.imageUrl,
      productTitle: product.title,
      creativeAngle,
      format,
      objective: ownedContentItem.commercialObjective as CommercialObjective,
      correctionNote,
    });

    if (result.status === "success") {
      await prisma.contentItem.update({
        where: { id: contentItemId },
        data: { creativeAssetId: result.creativeAssetId },
      });
    }

    return { intent: "generate-image" as const, result };
  }

  if (intent === "build-carousel") {
    const productId = String(formData.get("productId"));
    const contentItemId = String(formData.get("contentItemId"));
    const creativeAngle = String(formData.get("creativeAngle"));
    const format = String(formData.get("format"));

    const ownedContentItem = await prisma.contentItem.findFirst({
      where: { id: contentItemId, shopId: shop.id },
    });
    if (!ownedContentItem) throw new Response("Content item not found", { status: 404 });
    const ownedProduct = await prisma.productCache.findFirst({
      where: { id: productId, shopId: shop.id },
    });
    if (!ownedProduct) throw new Response("Product not found", { status: 404 });

    const result = await buildCarousel({
      shopId: shop.id,
      productId,
      contentItemId,
      objective: ownedContentItem.commercialObjective as CommercialObjective,
      creativeAngle,
      format,
    });

    return { intent: "build-carousel" as const, result };
  }

  // Monta um Reel (vídeo vertical) a partir das imagens que o post já tem —
  // nunca gera pixel novo, só aplica movimento às imagens já aprovadas (ver
  // buildReel.server.ts). Marca o post como format="reel"; publicar depois
  // publica como Reel, não como carrossel.
  if (intent === "generate-reel") {
    const contentItemId = String(formData.get("contentItemId"));
    const ownedContentItem = await prisma.contentItem.findFirst({
      where: { id: contentItemId, shopId: shop.id },
    });
    if (!ownedContentItem) throw new Response("Content item not found", { status: 404 });

    try {
      await generateReelForContentItem(contentItemId, shop.id);
      const updated = await prisma.contentItem.findUniqueOrThrow({ where: { id: contentItemId } });
      return {
        intent: "generate-reel" as const,
        result: { status: "success" as const, videoUrl: updated.videoUrl! },
      };
    } catch (error) {
      return {
        intent: "generate-reel" as const,
        result: {
          status: "error" as const,
          reason: error instanceof Error ? error.message : "Unknown error generating the reel.",
        },
      };
    }
  }

  // Desfaz "generate-reel" — volta o post a ser publicado como carrossel
  // normal, sem descartar as imagens já geradas.
  if (intent === "discard-reel") {
    const contentItemId = String(formData.get("contentItemId"));
    const ownedContentItem = await prisma.contentItem.findFirst({
      where: { id: contentItemId, shopId: shop.id },
    });
    if (!ownedContentItem) throw new Response("Content item not found", { status: 404 });

    await prisma.contentItem.update({
      where: { id: contentItemId },
      data: { format: "post", videoUrl: null, videoGeneratedAt: null },
    });
    return { intent: "discard-reel" as const };
  }

  // Sobe um vídeo pronto de fora (ex.: baixado da Creatify) pra publicar
  // pelo mesmo pipeline de Reel/vídeo do Facebook que já existe — Patricia,
  // 14/09/2026: "sim ja liga o fio que falta". Mesmo formato de
  // armazenamento (data URI em videoUrl) que generateReelForContentItem já
  // usa, só que os bytes vêm do upload em vez do ffmpeg.
  if (intent === "upload-reel-video") {
    const contentItemId = String(formData.get("contentItemId"));
    const ownedContentItem = await prisma.contentItem.findFirst({
      where: { id: contentItemId, shopId: shop.id },
    });
    if (!ownedContentItem) throw new Response("Content item not found", { status: 404 });

    const videoFile = formData.get("videoFile");
    if (!(videoFile instanceof File) || videoFile.size === 0) {
      return {
        intent: "upload-reel-video" as const,
        result: { status: "error" as const, reason: "No video file selected." },
      };
    }

    const buffer = Buffer.from(await videoFile.arrayBuffer());
    const videoDataUrl = `data:${videoFile.type || "video/mp4"};base64,${buffer.toString("base64")}`;

    await prisma.contentItem.update({
      where: { id: contentItemId },
      data: { videoUrl: videoDataUrl, videoGeneratedAt: new Date(), format: "reel" },
    });

    return {
      intent: "upload-reel-video" as const,
      result: { status: "success" as const, videoUrl: videoDataUrl },
    };
  }

  if (intent === "publish-instagram") {
    const contentItemId = String(formData.get("contentItemId"));
    const result = await publishContentItemToInstagram(contentItemId, shop.id);
    return { intent: "publish-instagram" as const, result };
  }

  // Ação opcional e explícita — nunca automática — pra salvar uma editorial
  // gerada por IA como foto real do produto na Shopify (Patricia,
  // 12/09/2026). Entra no fim da galeria, nunca na frente, então não muda a
  // foto principal da vitrine.
  if (intent === "save-image-to-product") {
    const creativeAssetId = String(formData.get("creativeAssetId"));
    const productId = String(formData.get("productId"));

    const creativeAsset = await prisma.creativeAsset.findFirst({
      where: { id: creativeAssetId, shopId: shop.id },
    });
    const product = await prisma.productCache.findFirst({
      where: { id: productId, shopId: shop.id },
    });
    if (!creativeAsset || !product) {
      return {
        intent: "save-image-to-product" as const,
        creativeAssetId,
        result: { status: "error" as const, reason: "Image or product not found." },
      };
    }

    const result = await uploadGeneratedImageToProduct(admin, {
      shopifyProductId: product.shopifyProductId,
      imageDataUrl: creativeAsset.imageUrl,
      filename: `${product.title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-ai-editorial.jpg`,
      alt: `${product.title} — AI-generated editorial photo`,
    });

    return { intent: "save-image-to-product" as const, creativeAssetId, result };
  }

  if (intent === "assess-image-quality") {
    const productId = String(formData.get("productId"));

    const product = await prisma.productCache.findFirst({
      where: { id: productId, shopId: shop.id },
    });
    if (!product?.imageUrl) {
      return {
        intent: "assess-image-quality" as const,
        assessment: null,
        error: "This product has no reference photo to assess.",
      };
    }

    const assessment = await assessProductImageQuality(
      product.imageUrl,
      product.title,
    );

    return { intent: "assess-image-quality" as const, assessment, error: null };
  }

  const productId = String(formData.get("productId"));
  const objectiveInput = String(formData.get("objective"));

  const product = await prisma.productCache.findFirst({
    where: { id: productId, shopId: shop.id },
    include: { commerceSignal: true },
  });
  if (!product) throw new Response("Product not found", { status: 404 });

  const objective: CommercialObjective =
    objectiveInput === "auto"
      ? inferObjective({
          inventoryQuantity: product.inventoryQuantity,
          salesVelocity: product.commerceSignal?.salesVelocity ?? null,
          daysSinceCreated: product.shopifyCreatedAt
            ? Math.floor(
                (Date.now() - product.shopifyCreatedAt.getTime()) /
                  (24 * 60 * 60 * 1000),
              )
            : null,
          price: product.price,
        })
      : (objectiveInput as CommercialObjective);

  const stage1Input = {
    productTitle: product.title,
    productDescription: product.description,
    productType: product.productType,
    price: product.price,
    inventoryQuantity: product.inventoryQuantity,
    unitsSold30d: product.commerceSignal?.unitsSold30d ?? 0,
    salesVelocity: product.commerceSignal?.salesVelocity ?? 0,
    daysSinceLastSale: product.commerceSignal?.daysSinceLastSale ?? null,
    daysSinceCreated: product.shopifyCreatedAt
      ? Math.floor((Date.now() - product.shopifyCreatedAt.getTime()) / (24 * 60 * 60 * 1000))
      : null,
    brandDescription: shop.brandDescription,
    objective,
  };
  const brief = await decideContentBrief(stage1Input);

  const copy = await generateCreativeCopy(
    brief,
    shop.contentLanguagePrimary as ContentLanguageCode,
    {
      brandDescription: shop.brandDescription,
      brandTone: shop.brandTone,
      brandAvoid: shop.brandAvoid,
    },
    describeEvidence(stage1Input),
    maxPrimaryCaptionChars(Boolean(shop.contentLanguageSecondary)),
  );

  const secondaryCaption = shop.contentLanguageSecondary
    ? await translateCaption(copy.captionText, shop.contentLanguageSecondary as ContentLanguageCode)
    : null;
  const captionText = buildBilingualCaption(copy.captionText, secondaryCaption);

  const contentItem = await prisma.contentItem.create({
    data: {
      shopId: shop.id,
      productId: product.id,
      platform: brief.channel,
      commercialObjective: objective,
      decisionBrief: brief,
      captionText,
      hashtags: copy.hashtags.join(", "),
      cta: copy.cta,
      status: "draft",
    },
  });

  return {
    intent: "generate-content" as const,
    productId: product.id,
    brief,
    copy: { ...copy, captionText },
    contentItemId: contentItem.id,
    wasAutoObjective: objectiveInput === "auto",
  };
};

export default function CreateContent() {
  const navigate = useNavigate();
  const {
    products,
    hasBrandVoice,
    usageStats,
    connectedPlatforms,
    contentLanguagePrimary,
    contentLanguageSecondary,
    resumedContent,
    resumedImage,
    resumedCarousel,
    resumedReel,
  } = useLoaderData<typeof loader>();

  const publishButtonLabel = (() => {
    const names: string[] = [];
    if (connectedPlatforms.instagram) names.push("Instagram");
    if (connectedPlatforms.facebook) names.push("Facebook");
    if (connectedPlatforms.pinterest) names.push("Pinterest");
    if (names.length === 0) return "Publish";
    if (names.length === 1) return `Publish to ${names[0]}`;
    return `Publish to ${names.slice(0, -1).join(", ")} & ${names[names.length - 1]}`;
  })();
  const fetcher = useFetcher<typeof action>();
  const imageFetcher = useFetcher<typeof action>();
  const qualityFetcher = useFetcher<typeof action>();
  const carouselFetcher = useFetcher<typeof action>();
  const reelFetcher = useFetcher<typeof action>();
  const discardReelFetcher = useFetcher<typeof action>();
  const uploadReelFetcher = useFetcher<typeof action>();
  const publishFetcher = useFetcher<typeof action>();
  const saveToProductFetcher = useFetcher<typeof action>();

  const isGenerating = fetcher.state !== "idle";
  const isGeneratingImage = imageFetcher.state !== "idle";
  const isAssessingQuality = qualityFetcher.state !== "idle";
  const isBuildingCarousel = carouselFetcher.state !== "idle";
  const isGeneratingReel = reelFetcher.state !== "idle";
  const isDiscardingReel = discardReelFetcher.state !== "idle";
  const isUploadingReel = uploadReelFetcher.state !== "idle";
  const isPublishing = publishFetcher.state !== "idle";
  const isSavingToProduct = saveToProductFetcher.state !== "idle";

  // Prefere o resultado desta sessão (fetcher); sem isso, recupera o
  // rascunho salvo, pra um refresh nunca parecer que perdeu o trabalho.
  const contentResult =
    fetcher.data?.intent === "generate-content" ? fetcher.data : (resumedContent ?? undefined);
  const imageResult =
    imageFetcher.data?.intent === "generate-image"
      ? imageFetcher.data.result
      : (resumedImage ?? undefined);
  const qualityResult =
    qualityFetcher.data?.intent === "assess-image-quality"
      ? qualityFetcher.data
      : undefined;
  const carouselResult =
    carouselFetcher.data?.intent === "build-carousel"
      ? carouselFetcher.data.result
      : (resumedCarousel ?? undefined);
  const reelResult =
    discardReelFetcher.data?.intent === "discard-reel"
      ? undefined
      : uploadReelFetcher.data?.intent === "upload-reel-video"
        ? uploadReelFetcher.data.result
        : reelFetcher.data?.intent === "generate-reel"
          ? reelFetcher.data.result
          : (resumedReel ?? undefined);
  const publishResult =
    publishFetcher.data?.intent === "publish-instagram"
      ? publishFetcher.data.result
      : undefined;

  const [productId, setProductId] = useState(
    resumedContent?.productId || products[0]?.id || "",
  );
  const [objective, setObjective] = useState("auto");
  const [correctionNote, setCorrectionNote] = useState("");

  const usageForSelectedProduct = usageStats[productId];

  const runGenerate = () =>
    fetcher.submit({ productId, objective }, { method: "POST" });

  const runAssessQuality = () =>
    qualityFetcher.submit(
      { intent: "assess-image-quality", productId },
      { method: "POST" },
    );

  const runGenerateImage = () => {
    if (!contentResult) return;
    imageFetcher.submit(
      {
        intent: "generate-image",
        productId: contentResult.productId,
        contentItemId: contentResult.contentItemId,
        creativeAngle: contentResult.brief.creativeAngle,
        format: contentResult.brief.format,
        correctionNote,
      },
      { method: "POST" },
    );
  };

  const runBuildCarousel = () => {
    if (!contentResult) return;
    carouselFetcher.submit(
      {
        intent: "build-carousel",
        productId: contentResult.productId,
        contentItemId: contentResult.contentItemId,
        creativeAngle: contentResult.brief.creativeAngle,
        format: contentResult.brief.format,
      },
      { method: "POST" },
    );
  };

  const runGenerateReel = () => {
    if (!contentResult) return;
    reelFetcher.submit(
      { intent: "generate-reel", contentItemId: contentResult.contentItemId },
      { method: "POST" },
    );
  };

  const runDiscardReel = () => {
    if (!contentResult) return;
    discardReelFetcher.submit(
      { intent: "discard-reel", contentItemId: contentResult.contentItemId },
      { method: "POST" },
    );
  };

  const runUploadReelVideo = (file: File) => {
    if (!contentResult) return;
    const formData = new FormData();
    formData.set("intent", "upload-reel-video");
    formData.set("contentItemId", contentResult.contentItemId);
    formData.set("videoFile", file);
    uploadReelFetcher.submit(formData, { method: "POST", encType: "multipart/form-data" });
  };

  const runPublishToInstagram = () => {
    if (!contentResult) return;
    publishFetcher.submit(
      { intent: "publish-instagram", contentItemId: contentResult.contentItemId },
      { method: "POST" },
    );
  };

  const runSaveImageToProduct = (creativeAssetId: string) => {
    if (!contentResult) return;
    saveToProductFetcher.submit(
      { intent: "save-image-to-product", creativeAssetId, productId: contentResult.productId },
      { method: "POST" },
    );
  };

  return (
    <s-page heading="Create content">
      {!hasBrandVoice && (
        <s-section heading="Store voice not set up yet">
          <s-paragraph>
            Content is being generated with a generic placeholder tone.{" "}
            <s-link href="/app/store-voice" onClick={goTo(navigate, "/app/store-voice")}>
              Set up your store voice
            </s-link>{" "}
            for copy that actually sounds like your store.
          </s-paragraph>
        </s-section>
      )}

      <s-section heading="1. Choose product and objective">
        <s-stack direction="block" gap="base">
          <select
            value={productId}
            onChange={(e) => setProductId(e.target.value)}
            style={{ padding: 8 }}
          >
            {products.map((product) => (
              <option key={product.id} value={product.id}>
                {product.title}
              </option>
            ))}
          </select>

          {usageForSelectedProduct && (
            <s-paragraph>
              You&apos;ve created {usageForSelectedProduct.timesUsed} post(s)
              for this product before, most recently on{" "}
              {new Date(usageForSelectedProduct.lastUsedAt).toLocaleDateString()}.
            </s-paragraph>
          )}

          <s-stack direction="inline" gap="base">
            <s-button
              onClick={runAssessQuality}
              variant="secondary"
              {...(isAssessingQuality ? { loading: true } : {})}
            >
              Is this product&apos;s existing photo good enough?
            </s-button>
          </s-stack>
          {qualityResult?.assessment && (
            <s-paragraph>
              <strong>{qualityResult.assessment.quality.toUpperCase()}</strong>
              {" — "}
              {qualityResult.assessment.recommendation}
            </s-paragraph>
          )}
          {qualityResult?.error && (
            <s-paragraph>{qualityResult.error}</s-paragraph>
          )}

          <select
            value={objective}
            onChange={(e) => setObjective(e.target.value)}
            style={{ padding: 8 }}
          >
            <option value="auto">Let AI decide</option>
            {COMMERCIAL_OBJECTIVES.map((obj) => (
              <option key={obj} value={obj}>
                {obj}
              </option>
            ))}
          </select>

          <s-paragraph>
            Publishing in:{" "}
            <strong>
              {CONTENT_LANGUAGES.find((l) => l.code === contentLanguagePrimary)?.label ??
                contentLanguagePrimary}
              {contentLanguageSecondary &&
                ` + ${CONTENT_LANGUAGES.find((l) => l.code === contentLanguageSecondary)?.label ?? contentLanguageSecondary}`}
            </strong>
            .{" "}
            <s-link href="/app/store-voice" onClick={goTo(navigate, "/app/store-voice")}>
              Change in Store voice
            </s-link>
            .
          </s-paragraph>

          <s-button
            onClick={runGenerate}
            {...(isGenerating ? { loading: true } : {})}
          >
            Generate content
          </s-button>
        </s-stack>
      </s-section>

      {contentResult && (
        <s-section heading="2. Decision brief (Stage 1)">
          {contentResult.wasAutoObjective && (
            <s-paragraph>
              Objective was inferred automatically: {contentResult.brief.objective}
            </s-paragraph>
          )}
          <s-box
            padding="base"
            borderWidth="base"
            borderRadius="base"
            background="subdued"
          >
            <pre style={{ margin: 0 }}>
              <code>{JSON.stringify(contentResult.brief, null, 2)}</code>
            </pre>
          </s-box>
        </s-section>
      )}

      {contentResult && (
        <s-section heading="3. Generated post (Stage 2)">
          <s-paragraph>
            Exactly what will be sent to Instagram when you publish — caption,
            CTA and hashtags together, same as the live post.
          </s-paragraph>
          <div
            style={{
              whiteSpace: "pre-wrap",
              padding: 12,
              border: "1px solid #ddd",
              borderRadius: 4,
            }}
          >
            {buildFinalCaption({
              captionText: contentResult.copy.captionText,
              cta: contentResult.copy.cta,
              hashtags: contentResult.copy.hashtags,
            })}
          </div>
          <s-paragraph>Saved as draft content item.</s-paragraph>
        </s-section>
      )}

      {contentResult && (
        <s-section heading="4. Product image">
          <s-paragraph>
            {contentResult.brief.usesAiImage
              ? "The Decision Engine flagged this post for an AI-generated image."
              : "The Decision Engine didn't flag this post for an AI image, but you can still generate one."}
          </s-paragraph>

          {imageResult && (
            <div>
              <s-paragraph>What would you like to change? (optional)</s-paragraph>
              <textarea
                value={correctionNote}
                onChange={(e) => setCorrectionNote(e.target.value)}
                placeholder="e.g. lighter background, model looking at the camera, no necklace"
                rows={2}
                style={{ width: "100%", padding: 8 }}
              />
              <s-paragraph>
                <s-text color="subdued">
                  Only this changes — everything else about the scene stays
                  the same, and it never overrides your store voice or the
                  editorial style rules.
                </s-text>
              </s-paragraph>
            </div>
          )}

          <s-button
            onClick={runGenerateImage}
            {...(isGeneratingImage ? { loading: true } : {})}
          >
            {imageResult ? "Regenerate image" : "Generate product image"}
          </s-button>

          {imageResult?.status === "success" && (
            <>
              <img
                src={imageResult.imageUrl}
                alt="AI-generated product creative"
                style={{ maxWidth: "100%", marginTop: 12 }}
              />
              <s-paragraph>
                Passed the fidelity check on attempt {imageResult.attempts}.
                Saved as a creative asset.
              </s-paragraph>
              <s-button
                variant="secondary"
                onClick={() => runSaveImageToProduct(imageResult.creativeAssetId)}
                {...(isSavingToProduct ? { loading: true } : {})}
              >
                Add to product photos
              </s-button>
              {saveToProductFetcher.data?.intent === "save-image-to-product" &&
                saveToProductFetcher.data.creativeAssetId === imageResult.creativeAssetId && (
                  <s-paragraph>
                    {saveToProductFetcher.data.result.status === "success"
                      ? "Added to the end of this product's photo gallery."
                      : `Couldn't add it: ${saveToProductFetcher.data.result.reason}`}
                  </s-paragraph>
                )}
            </>
          )}

          {imageResult?.status === "fallback" && (
            <s-paragraph>{imageResult.reason}</s-paragraph>
          )}
        </s-section>
      )}

      {contentResult && (
        <s-section heading="5. Carousel">
          <s-paragraph>
            Builds the full post sequence: a fresh editorial image first
            (never reused from a previous post for this product), followed
            by the product&apos;s existing Shopify still photos in order.
          </s-paragraph>

          <s-button
            onClick={runBuildCarousel}
            {...(isBuildingCarousel ? { loading: true } : {})}
          >
            Build carousel
          </s-button>

          {carouselResult?.status === "success" && (
            <>
              <s-paragraph>
                {carouselResult.heroWasReused
                  ? "Reused an existing unused editorial image as the cover."
                  : "Generated a new editorial image as the cover."}
              </s-paragraph>
              <s-stack direction="inline" gap="base">
                {carouselResult.images.map((image) => (
                  <s-stack key={image.position} direction="block" gap="small">
                    <img
                      src={image.url}
                      alt={`Carousel position ${image.position}`}
                      style={{ width: 160, height: 160, objectFit: "cover" }}
                    />
                    <s-paragraph>
                      {image.position}.{" "}
                      {image.source === "ai_generated" ? "Editorial" : "Still"}
                    </s-paragraph>
                  </s-stack>
                ))}
              </s-stack>
              <s-button
                variant="secondary"
                onClick={() => runSaveImageToProduct(carouselResult.heroAssetId)}
                {...(isSavingToProduct ? { loading: true } : {})}
              >
                Add cover to product photos
              </s-button>
              {saveToProductFetcher.data?.intent === "save-image-to-product" &&
                saveToProductFetcher.data.creativeAssetId === carouselResult.heroAssetId && (
                  <s-paragraph>
                    {saveToProductFetcher.data.result.status === "success"
                      ? "Added to the end of this product's photo gallery."
                      : `Couldn't add it: ${saveToProductFetcher.data.result.reason}`}
                  </s-paragraph>
                )}
            </>
          )}

          {carouselResult?.status === "fallback" && (
            <s-paragraph>{carouselResult.reason}</s-paragraph>
          )}
        </s-section>
      )}

      {contentResult && carouselResult?.status === "success" && (
        <s-section heading="5b. Reel (optional)">
          <s-paragraph>
            Turns the carousel images above into a vertical video (Ken Burns
            motion + crossfade) for Instagram Reels — no new pixels are
            generated, it only animates the images already built and
            approved above. Publishing below will post this as a Reel
            instead of a carousel until you discard it.
          </s-paragraph>

          <s-stack direction="inline" gap="base">
            <s-button
              onClick={runGenerateReel}
              {...(isGeneratingReel ? { loading: true } : {})}
            >
              {reelResult?.status === "success" ? "Regenerate reel" : "Generate reel"}
            </s-button>
            {reelResult?.status === "success" && (
              <s-button
                variant="secondary"
                onClick={runDiscardReel}
                {...(isDiscardingReel ? { loading: true } : {})}
              >
                Discard reel, publish as carousel instead
              </s-button>
            )}
          </s-stack>

          <s-paragraph>
            Or upload a video made elsewhere (e.g. an AI-avatar ad from
            Creatify) — publishing below will post this file as the Reel
            instead.
          </s-paragraph>
          <input
            type="file"
            accept="video/mp4,video/quicktime,video/webm"
            disabled={isUploadingReel}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) runUploadReelVideo(file);
            }}
          />
          {isUploadingReel && <s-paragraph>Uploading…</s-paragraph>}

          {reelResult?.status === "success" && (
            // eslint-disable-next-line jsx-a11y/media-has-caption
            <video
              src={reelResult.videoUrl}
              controls
              style={{ width: 240, marginTop: 12 }}
            />
          )}
          {reelResult?.status === "error" && (
            <s-paragraph>{reelResult.reason}</s-paragraph>
          )}
        </s-section>
      )}

      {contentResult && (
        <s-section heading="6. Publish">
          <s-paragraph>
            {reelResult?.status === "success"
              ? "This will publish as a Reel (vertical video), not a carousel. "
              : ""}
            Publishes this post for real on the connected Instagram account
            (build the carousel or generate an image above first — a post
            can&apos;t go out with no images), also shares the cover image
            as a Story — Instagram&apos;s API has no caption field for
            Stories, so it goes out with the image only — mirrors the same
            post (image and caption) to your connected Facebook Page, and
            pins the cover image to your connected Pinterest account, in
            the board matching this product&apos;s category.
          </s-paragraph>

          <s-button
            onClick={runPublishToInstagram}
            variant="primary"
            {...(isPublishing ? { loading: true } : {})}
          >
            {publishButtonLabel}
          </s-button>

          {publishResult?.status === "success" && (
            <>
              <s-paragraph>
                Published! Instagram media ID: {publishResult.igMediaId}
              </s-paragraph>
              {publishResult.story.status === "published" && (
                <s-paragraph>
                  Also shared as a Story (same cover image, no caption —
                  Instagram&apos;s API doesn&apos;t support Story captions).
                </s-paragraph>
              )}
              {publishResult.story.status === "failed" && (
                <s-paragraph>
                  Feed post published, but sharing to Story failed:{" "}
                  {publishResult.story.reason}
                </s-paragraph>
              )}
              {publishResult.facebook.status === "published" && (
                <s-paragraph>
                  Also posted to your Facebook Page (same image and
                  caption).
                </s-paragraph>
              )}
              {publishResult.facebook.status === "failed" && (
                <s-paragraph>
                  Instagram post published, but posting to Facebook failed:{" "}
                  {publishResult.facebook.reason}
                </s-paragraph>
              )}
              {publishResult.pinterest.status === "published" && (
                <s-paragraph>
                  Also pinned to your Pinterest board for this
                  product&apos;s category.
                </s-paragraph>
              )}
              {publishResult.pinterest.status === "failed" && (
                <s-paragraph>
                  Instagram post published, but pinning to Pinterest failed:{" "}
                  {publishResult.pinterest.reason}
                </s-paragraph>
              )}
              {publishResult.pinterest.status === "not_attempted" &&
                publishResult.pinterest.reason && (
                  <s-paragraph>{publishResult.pinterest.reason}</s-paragraph>
                )}
            </>
          )}
          {publishResult?.status === "error" && (
            <s-paragraph>{publishResult.reason}</s-paragraph>
          )}
        </s-section>
      )}
    </s-page>
  );
}
