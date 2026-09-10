import { useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import {
  COMMERCIAL_OBJECTIVES,
  CONTENT_LANGUAGES,
  type CommercialObjective,
  type ContentLanguageCode,
} from "../services/decisionEngine/constants";
import { inferObjective } from "../services/decisionEngine/archetypes.server";
import { decideContentBrief } from "../services/decisionEngine/stage1.server";
import { generateCreativeCopy } from "../services/decisionEngine/stage2.server";
import { generateProductImage } from "../services/imageMvp/generateProductImage.server";
import { assessProductImageQuality } from "../services/imageMvp/assessProductImageQuality.server";
import { getProductUsageStats } from "../services/decisionEngine/contentHistory.server";
import { buildCarousel } from "../services/imageMvp/buildCarousel.server";
import { publishContentItemToInstagram } from "../services/meta/publishContentItem.server";

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

  return { products, hasBrandVoice: Boolean(shop?.brandTone?.trim()), usageStats };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
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

    const product = await prisma.productCache.findUnique({
      where: { id: productId },
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

    const result = await buildCarousel({
      shopId: shop.id,
      productId,
      contentItemId,
      creativeAngle,
      format,
    });

    return { intent: "build-carousel" as const, result };
  }

  if (intent === "publish-instagram") {
    const contentItemId = String(formData.get("contentItemId"));
    const result = await publishContentItemToInstagram(contentItemId);
    return { intent: "publish-instagram" as const, result };
  }

  if (intent === "assess-image-quality") {
    const productId = String(formData.get("productId"));

    const product = await prisma.productCache.findUnique({
      where: { id: productId },
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
  const language = String(formData.get("language")) as ContentLanguageCode;

  const product = await prisma.productCache.findUnique({
    where: { id: productId },
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
        })
      : (objectiveInput as CommercialObjective);

  const brief = await decideContentBrief({
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
  });

  const copy = await generateCreativeCopy(brief, language, {
    brandDescription: shop.brandDescription,
    brandTone: shop.brandTone,
    brandAvoid: shop.brandAvoid,
  });

  const contentItem = await prisma.contentItem.create({
    data: {
      shopId: shop.id,
      productId: product.id,
      platform: brief.channel,
      commercialObjective: objective,
      decisionBrief: brief,
      captionText: copy.captionText,
      hashtags: copy.hashtags.join(", "),
      cta: copy.cta,
      status: "draft",
    },
  });

  return {
    intent: "generate-content" as const,
    productId: product.id,
    brief,
    copy,
    contentItemId: contentItem.id,
    wasAutoObjective: objectiveInput === "auto",
  };
};

export default function CreateContent() {
  const { products, hasBrandVoice, usageStats } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const imageFetcher = useFetcher<typeof action>();
  const qualityFetcher = useFetcher<typeof action>();
  const carouselFetcher = useFetcher<typeof action>();
  const publishFetcher = useFetcher<typeof action>();

  const isGenerating = fetcher.state !== "idle";
  const isGeneratingImage = imageFetcher.state !== "idle";
  const isAssessingQuality = qualityFetcher.state !== "idle";
  const isBuildingCarousel = carouselFetcher.state !== "idle";
  const isPublishing = publishFetcher.state !== "idle";

  const contentResult =
    fetcher.data?.intent === "generate-content" ? fetcher.data : undefined;
  const imageResult =
    imageFetcher.data?.intent === "generate-image"
      ? imageFetcher.data.result
      : undefined;
  const qualityResult =
    qualityFetcher.data?.intent === "assess-image-quality"
      ? qualityFetcher.data
      : undefined;
  const carouselResult =
    carouselFetcher.data?.intent === "build-carousel"
      ? carouselFetcher.data.result
      : undefined;
  const publishResult =
    publishFetcher.data?.intent === "publish-instagram"
      ? publishFetcher.data.result
      : undefined;

  const [productId, setProductId] = useState(products[0]?.id ?? "");
  const [objective, setObjective] = useState("auto");
  const [language, setLanguage] = useState("en");

  const usageForSelectedProduct = usageStats[productId];

  const runGenerate = () =>
    fetcher.submit({ productId, objective, language }, { method: "POST" });

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

  const runPublishToInstagram = () => {
    if (!contentResult) return;
    publishFetcher.submit(
      { intent: "publish-instagram", contentItemId: contentResult.contentItemId },
      { method: "POST" },
    );
  };

  return (
    <s-page heading="Create content">
      {!hasBrandVoice && (
        <s-section heading="Brand voice not set up yet">
          <s-paragraph>
            Content is being generated with a generic placeholder tone.{" "}
            <s-link href="/app/brand">Set up your brand voice</s-link> for
            copy that actually sounds like your brand.
          </s-paragraph>
        </s-section>
      )}

      <s-section heading="1. Choose product, objective and language">
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
              variant="tertiary"
              {...(isAssessingQuality ? { loading: true } : {})}
            >
              Is this product's existing photo good enough?
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

          <select
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
            style={{ padding: 8 }}
          >
            {CONTENT_LANGUAGES.map((lang) => (
              <option key={lang.code} value={lang.code}>
                {lang.label}
              </option>
            ))}
          </select>

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
          <s-paragraph>{contentResult.copy.captionText}</s-paragraph>
          <s-paragraph>
            {contentResult.copy.hashtags.map((tag) => `#${tag}`).join(" ")}
          </s-paragraph>
          <s-paragraph>
            <strong>CTA:</strong> {contentResult.copy.cta}
          </s-paragraph>
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

          <s-button
            onClick={runGenerateImage}
            variant="tertiary"
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
            variant="tertiary"
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
            </>
          )}

          {carouselResult?.status === "fallback" && (
            <s-paragraph>{carouselResult.reason}</s-paragraph>
          )}
        </s-section>
      )}

      {contentResult && (
        <s-section heading="6. Publish">
          <s-paragraph>
            Publishes this post for real on the connected Instagram account
            (build the carousel or generate an image above first — a post
            can&apos;t go out with no images).
          </s-paragraph>

          <s-button
            onClick={runPublishToInstagram}
            variant="primary"
            {...(isPublishing ? { loading: true } : {})}
          >
            Publish to Instagram
          </s-button>

          {publishResult?.status === "success" && (
            <s-paragraph>
              Published! Instagram media ID: {publishResult.igMediaId}
            </s-paragraph>
          )}
          {publishResult?.status === "error" && (
            <s-paragraph>{publishResult.reason}</s-paragraph>
          )}
        </s-section>
      )}
    </s-page>
  );
}
