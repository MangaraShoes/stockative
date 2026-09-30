import { useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { getRemainingCredits } from "../services/decisionEngine/creditUsage.server";
import { EXTRA_CREDIT_PRICING, estimateExtraCreditsPriceCents } from "../services/decisionEngine/extrasPricing";

// Compra avulsa de crédito extra de imagem/vídeo (Patricia, 30/09/2026).
// Fora do menu de propósito ("nem precisa aparecer ali, só aparecer quando
// a pessoa usar o limite de imagens e vídeos") — só se chega aqui pelo
// aviso de cota esgotada no Weekly plan. Não existe cobrança real ainda
// (Fase 7, Shopify Billing): a compra só grava o crédito, igual a troca de
// plano em app.settings.tsx.

const formatEuro = (cents: number) => `€${(cents / 100).toFixed(2)}`;

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await prisma.shop.findUnique({ where: { shopifyDomain: session.shop } });

  return {
    remainingImageCredits: shop ? await getRemainingCredits(shop, "image") : 0,
    remainingVideoCredits: shop ? await getRemainingCredits(shop, "video") : 0,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await prisma.shop.findUnique({ where: { shopifyDomain: session.shop } });
  if (!shop) throw new Response("Shop not found", { status: 404 });

  const formData = await request.formData();
  const images = Number(formData.get("images"));
  const videos = Number(formData.get("videos"));

  if (!Number.isInteger(images) || images < 0 || !Number.isInteger(videos) || videos < 0) {
    return { error: "Enter a valid number of extra images and videos." };
  }
  if (images === 0 && videos === 0) {
    return { error: "Add at least one extra image or video." };
  }

  const purchases = [
    { taskType: "image", credits: images, cents: images * EXTRA_CREDIT_PRICING.pricePerImageCents },
    { taskType: "video", credits: videos, cents: videos * EXTRA_CREDIT_PRICING.pricePerVideoCents },
  ].filter((purchase) => purchase.credits > 0);

  await prisma.imageCreditPurchase.createMany({
    data: purchases.map((purchase) => ({
      shopId: shop.id,
      taskType: purchase.taskType,
      creditsPurchased: purchase.credits,
      pricePaid: purchase.cents / 100,
    })),
  });

  return { error: null };
};

export default function Extras() {
  const data = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();

  const [images, setImages] = useState("0");
  const [videos, setVideos] = useState("0");

  const parsedImages = Number(images);
  const parsedVideos = Number(videos);
  const isValid =
    Number.isInteger(parsedImages) &&
    parsedImages >= 0 &&
    Number.isInteger(parsedVideos) &&
    parsedVideos >= 0 &&
    parsedImages + parsedVideos > 0;
  const totalCents = isValid ? estimateExtraCreditsPriceCents(parsedImages, parsedVideos) : null;
  const isSaving = fetcher.state !== "idle";

  return (
    <s-page heading="Extra credits">
      <s-section heading="Need more this month?">
        <s-paragraph>
          You have {data.remainingImageCredits} image
          {data.remainingImageCredits === 1 ? "" : "s"} and {data.remainingVideoCredits} video
          {data.remainingVideoCredits === 1 ? "" : "s"} left this month. Extra credits are
          a one-time purchase, valid until the end of this month. Extra image:{" "}
          {formatEuro(EXTRA_CREDIT_PRICING.pricePerImageCents)} · Extra video:{" "}
          {formatEuro(EXTRA_CREDIT_PRICING.pricePerVideoCents)}.
        </s-paragraph>

        <s-stack direction="inline" gap="base">
          <div>
            <s-paragraph>Extra images</s-paragraph>
            <input
              type="number"
              min={0}
              step={1}
              value={images}
              onChange={(e) => setImages(e.target.value)}
              style={{ padding: 8, width: 120 }}
            />
          </div>
          <div>
            <s-paragraph>Extra videos</s-paragraph>
            <input
              type="number"
              min={0}
              step={1}
              value={videos}
              onChange={(e) => setVideos(e.target.value)}
              style={{ padding: 8, width: 120 }}
            />
          </div>
        </s-stack>

        {totalCents !== null && <s-paragraph>Total: {formatEuro(totalCents)}</s-paragraph>}

        <div style={{ marginTop: 12 }}>
          <button
            type="button"
            onClick={() => fetcher.submit({ images, videos }, { method: "POST" })}
            disabled={isSaving || !isValid}
            style={{
              display: "inline-block",
              padding: "8px 16px",
              border: "1px solid #000",
              borderRadius: 8,
              background: "#000",
              color: "#fff",
              fontWeight: 500,
              opacity: isSaving || !isValid ? 0.5 : 1,
              cursor: isSaving || !isValid ? "default" : "pointer",
            }}
          >
            {isSaving ? "Adding…" : "Add credits"}
          </button>
        </div>

        {fetcher.data && !fetcher.data.error && <s-paragraph>Credits added.</s-paragraph>}
        {fetcher.data?.error && (
          <s-paragraph>
            <strong>{fetcher.data.error}</strong>
          </s-paragraph>
        )}
      </s-section>
    </s-page>
  );
}
