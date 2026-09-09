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

  return { products, hasBrandVoice: Boolean(shop?.brandTone?.trim()) };
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
  const { products, hasBrandVoice } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const imageFetcher = useFetcher<typeof action>();

  const isGenerating = fetcher.state !== "idle";
  const isGeneratingImage = imageFetcher.state !== "idle";

  const contentResult =
    fetcher.data?.intent === "generate-content" ? fetcher.data : undefined;
  const imageResult =
    imageFetcher.data?.intent === "generate-image"
      ? imageFetcher.data.result
      : undefined;

  const [productId, setProductId] = useState(products[0]?.id ?? "");
  const [objective, setObjective] = useState("auto");
  const [language, setLanguage] = useState("en");

  const runGenerate = () =>
    fetcher.submit({ productId, objective, language }, { method: "POST" });

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
    </s-page>
  );
}
