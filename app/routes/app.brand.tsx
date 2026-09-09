import { useEffect, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { draftBrandVoice } from "../services/decisionEngine/draftBrandVoice.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);

  const shop = await prisma.shop.findUnique({
    where: { shopifyDomain: session.shop },
  });

  const productCount = shop
    ? await prisma.productCache.count({ where: { shopId: shop.id } })
    : 0;

  return {
    brandDescription: shop?.brandDescription ?? "",
    brandTone: shop?.brandTone ?? "",
    brandAvoid: shop?.brandAvoid ?? "",
    productCount,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent");

  const shop = await prisma.shop.findUnique({
    where: { shopifyDomain: session.shop },
  });
  if (!shop) throw new Response("Shop not found", { status: 404 });

  if (intent === "draft") {
    const products = await prisma.productCache.findMany({
      where: { shopId: shop.id },
      select: { title: true, description: true, productType: true, price: true },
    });
    const draft = await draftBrandVoice(products);
    return { intent, draft };
  }

  const brandDescription = String(formData.get("brandDescription") ?? "");
  const brandTone = String(formData.get("brandTone") ?? "");
  const brandAvoid = String(formData.get("brandAvoid") ?? "");

  await prisma.shop.update({
    where: { shopifyDomain: session.shop },
    data: { brandDescription, brandTone, brandAvoid },
  });

  return { intent: "save", saved: true };
};

export default function Brand() {
  const data = useLoaderData<typeof loader>();
  const draftFetcher = useFetcher<typeof action>();
  const saveFetcher = useFetcher<typeof action>();

  const [brandDescription, setBrandDescription] = useState(data.brandDescription);
  const [brandTone, setBrandTone] = useState(data.brandTone);
  const [brandAvoid, setBrandAvoid] = useState(data.brandAvoid);

  useEffect(() => {
    if (draftFetcher.data?.intent === "draft" && draftFetcher.data.draft) {
      setBrandDescription(draftFetcher.data.draft.brandDescription);
      setBrandTone(draftFetcher.data.draft.brandTone);
      setBrandAvoid(draftFetcher.data.draft.brandAvoid);
    }
  }, [draftFetcher.data]);

  const isDrafting = draftFetcher.state !== "idle";
  const isSaving = saveFetcher.state !== "idle";
  const hasDraft = draftFetcher.data?.intent === "draft";
  const hasSavedBefore = Boolean(
    data.brandDescription || data.brandTone || data.brandAvoid,
  );

  const generateDraft = () =>
    draftFetcher.submit({ intent: "draft" }, { method: "POST" });

  const save = () =>
    saveFetcher.submit(
      { brandDescription, brandTone, brandAvoid },
      { method: "POST" },
    );

  const sectionHeading = hasDraft
    ? "Review the AI's draft — edit anything you'd like, then approve"
    : "Tell us about your brand";
  const saveButtonLabel = hasDraft
    ? "Approve & save"
    : hasSavedBefore
      ? "Save changes"
      : "Save brand voice";

  return (
    <s-page heading="Brand voice">
      <s-section heading={sectionHeading}>
        <s-paragraph>
          This shapes how the AI writes for you — used every time content is
          generated (Stage 2 of the Content Decision Engine).
        </s-paragraph>

        <s-stack direction="block" gap="base">
          {data.productCount > 0 && (
            <s-button
              onClick={generateDraft}
              variant="tertiary"
              {...(isDrafting ? { loading: true } : {})}
            >
              Generate draft with AI (based on your {data.productCount}{" "}
              synced products)
            </s-button>
          )}
          {hasDraft && (
            <s-paragraph>
              <strong>
                This is a starting point, not a final answer — nothing is
                saved yet.
              </strong>{" "}
              Edit any of the three fields below freely, then click
              &quot;Approve &amp; save&quot; when you&apos;re happy with it.
              It also doesn&apos;t look at your competitors yet — that needs
              Instagram integration, which isn&apos;t built yet.
            </s-paragraph>
          )}

          <div>
            <s-paragraph>Brand description</s-paragraph>
            <textarea
              value={brandDescription}
              onChange={(e) => setBrandDescription(e.target.value)}
              placeholder="Who are you, in a few sentences? What makes your products different?"
              rows={3}
              style={{ width: "100%", padding: 8 }}
            />
          </div>

          <div>
            <s-paragraph>Tone of voice</s-paragraph>
            <textarea
              value={brandTone}
              onChange={(e) => setBrandTone(e.target.value)}
              placeholder="e.g. warm, confident, never pushy, no exclamation marks"
              rows={2}
              style={{ width: "100%", padding: 8 }}
            />
          </div>

          <div>
            <s-paragraph>Things to never say</s-paragraph>
            <textarea
              value={brandAvoid}
              onChange={(e) => setBrandAvoid(e.target.value)}
              placeholder="e.g. never say 'cheap', never use slang, no discount-focused language"
              rows={2}
              style={{ width: "100%", padding: 8 }}
            />
          </div>

          <s-button onClick={save} {...(isSaving ? { loading: true } : {})}>
            {saveButtonLabel}
          </s-button>

          {saveFetcher.data?.intent === "save" && (
            <s-paragraph>Approved and saved.</s-paragraph>
          )}
        </s-stack>
      </s-section>
    </s-page>
  );
}
