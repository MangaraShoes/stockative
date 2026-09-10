import { useEffect, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import {
  draftContentPillars,
  type ContentPillarDraft,
} from "../services/decisionEngine/draftContentPillars.server";

const GROWTH_CATEGORIES = ["atração", "autoridade", "relacionamento", "conversão"] as const;
const FORMATS = ["carousel", "single_image"] as const;

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);

  const shop = await prisma.shop.findUnique({
    where: { shopifyDomain: session.shop },
  });

  const pillars = shop
    ? await prisma.contentPillar.findMany({
        where: { shopId: shop.id },
        orderBy: { createdAt: "asc" },
      })
    : [];

  const productCount = shop
    ? await prisma.productCache.count({ where: { shopId: shop.id } })
    : 0;

  return {
    pillars,
    productCount,
    hasBrandVoice: Boolean(shop?.brandTone?.trim()),
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
    const draft = await draftContentPillars(products, {
      brandDescription: shop.brandDescription,
      brandTone: shop.brandTone,
      brandAvoid: shop.brandAvoid,
    });
    return { intent: "draft" as const, draft };
  }

  if (intent === "save") {
    const pillars = JSON.parse(String(formData.get("pillars"))) as ContentPillarDraft[];

    await prisma.$transaction([
      prisma.contentPillar.deleteMany({ where: { shopId: shop.id } }),
      prisma.contentPillar.createMany({
        data: pillars.map((p) => ({ ...p, shopId: shop.id })),
      }),
    ]);

    return { intent: "save" as const, saved: true };
  }

  throw new Response("Unknown intent", { status: 400 });
};

export default function ContentPillars() {
  const data = useLoaderData<typeof loader>();
  const draftFetcher = useFetcher<typeof action>();
  const saveFetcher = useFetcher<typeof action>();

  const [editablePillars, setEditablePillars] = useState<ContentPillarDraft[] | null>(null);

  const isDrafting = draftFetcher.state !== "idle";
  const isSaving = saveFetcher.state !== "idle";

  const generateDraft = () => {
    setEditablePillars(null);
    draftFetcher.submit({ intent: "draft" }, { method: "POST" });
  };

  useEffect(() => {
    if (draftFetcher.data?.intent === "draft") {
      setEditablePillars(draftFetcher.data.draft);
    }
  }, [draftFetcher.data]);

  const updatePillar = (index: number, field: keyof ContentPillarDraft, value: unknown) => {
    if (!editablePillars) return;
    const next = [...editablePillars];
    next[index] = { ...next[index], [field]: value };
    setEditablePillars(next);
  };

  const save = () => {
    if (!editablePillars) return;
    saveFetcher.submit(
      { intent: "save", pillars: JSON.stringify(editablePillars) },
      { method: "POST" },
    );
  };

  const displayedPillars = editablePillars ?? data.pillars;
  const isDraftMode = Boolean(editablePillars);

  return (
    <s-page heading="Content pillars">
      <s-section heading="Your brand's content pillars">
        <s-paragraph>
          4 to 6 pillars specific to your brand — never generic ones like
          &quot;education&quot; or &quot;inspiration&quot;. These decide how
          your weekly content mix is split, and which pillar should drive
          reach, followers, purchases, or be posted less often.
        </s-paragraph>

        {!data.hasBrandVoice && (
          <s-paragraph>
            <strong>
              Set up your Brand voice first for pillars that actually sound
              like your brand, not generic ones.
            </strong>
          </s-paragraph>
        )}

        <s-button
          onClick={generateDraft}
          variant="tertiary"
          {...(isDrafting ? { loading: true } : {})}
        >
          {data.pillars.length > 0 ? "Regenerate with AI" : "Generate draft with AI"}
        </s-button>

        {isDraftMode && (
          <s-paragraph>
            <strong>
              This is a starting point, not a final answer — nothing is saved
              yet.
            </strong>{" "}
            Edit any field below, then click &quot;Approve &amp; save&quot;.
          </s-paragraph>
        )}

        {displayedPillars.length === 0 && !isDrafting && (
          <s-paragraph>No pillars yet — generate a draft to get started.</s-paragraph>
        )}

        <s-stack direction="block" gap="base">
          {displayedPillars.map((pillar, index) => (
            <s-box
              key={index}
              padding="base"
              borderWidth="base"
              borderRadius="base"
              background="subdued"
            >
              <s-stack direction="block" gap="small">
                {isDraftMode ? (
                  <>
                    <s-paragraph>Name</s-paragraph>
                    <input
                      value={pillar.name}
                      onChange={(e) => updatePillar(index, "name", e.target.value)}
                      style={{ width: "100%", padding: 8 }}
                    />
                    <s-paragraph>Function</s-paragraph>
                    <input
                      value={pillar.function}
                      onChange={(e) => updatePillar(index, "function", e.target.value)}
                      style={{ width: "100%", padding: 8 }}
                    />
                    <s-paragraph>Attracts audience</s-paragraph>
                    <input
                      value={pillar.attractsAudience}
                      onChange={(e) => updatePillar(index, "attractsAudience", e.target.value)}
                      style={{ width: "100%", padding: 8 }}
                    />
                    <s-paragraph>Problem explored</s-paragraph>
                    <input
                      value={pillar.problemExplored}
                      onChange={(e) => updatePillar(index, "problemExplored", e.target.value)}
                      style={{ width: "100%", padding: 8 }}
                    />
                    <s-paragraph>Promise</s-paragraph>
                    <input
                      value={pillar.promise}
                      onChange={(e) => updatePillar(index, "promise", e.target.value)}
                      style={{ width: "100%", padding: 8 }}
                    />
                    <s-paragraph>CTA</s-paragraph>
                    <input
                      value={pillar.cta}
                      onChange={(e) => updatePillar(index, "cta", e.target.value)}
                      style={{ width: "100%", padding: 8 }}
                    />

                    <s-stack direction="inline" gap="base">
                      <select
                        value={pillar.idealFormat}
                        onChange={(e) => updatePillar(index, "idealFormat", e.target.value)}
                        style={{ padding: 8 }}
                      >
                        {FORMATS.map((f) => (
                          <option key={f} value={f}>
                            {f}
                          </option>
                        ))}
                      </select>

                      <select
                        value={pillar.growthCategory}
                        onChange={(e) => updatePillar(index, "growthCategory", e.target.value)}
                        style={{ padding: 8 }}
                      >
                        {GROWTH_CATEGORIES.map((c) => (
                          <option key={c} value={c}>
                            {c}
                          </option>
                        ))}
                      </select>

                      <input
                        type="number"
                        value={pillar.targetSharePct}
                        onChange={(e) =>
                          updatePillar(index, "targetSharePct", Number(e.target.value))
                        }
                        style={{ width: 80, padding: 8 }}
                      />
                      <s-paragraph>%</s-paragraph>
                    </s-stack>

                    <s-stack direction="inline" gap="base">
                      <label>
                        <input
                          type="checkbox"
                          checked={pillar.drivesReach}
                          onChange={(e) => updatePillar(index, "drivesReach", e.target.checked)}
                        />{" "}
                        Drives reach
                      </label>
                      <label>
                        <input
                          type="checkbox"
                          checked={pillar.drivesFollowers}
                          onChange={(e) =>
                            updatePillar(index, "drivesFollowers", e.target.checked)
                          }
                        />{" "}
                        Drives followers
                      </label>
                      <label>
                        <input
                          type="checkbox"
                          checked={pillar.drivesPurchase}
                          onChange={(e) =>
                            updatePillar(index, "drivesPurchase", e.target.checked)
                          }
                        />{" "}
                        Drives purchase
                      </label>
                      <label>
                        <input
                          type="checkbox"
                          checked={pillar.postLess}
                          onChange={(e) => updatePillar(index, "postLess", e.target.checked)}
                        />{" "}
                        Post less often
                      </label>
                    </s-stack>
                  </>
                ) : (
                  <>
                    <s-paragraph>
                      <strong>{pillar.name}</strong> — {pillar.growthCategory} (
                      {pillar.targetSharePct}%)
                    </s-paragraph>
                    <s-paragraph>{pillar.function}</s-paragraph>
                    <s-paragraph>
                      Attracts: {pillar.attractsAudience} · Problem: {pillar.problemExplored}
                    </s-paragraph>
                    <s-paragraph>
                      Promise: {pillar.promise} · Format: {pillar.idealFormat} · CTA: {pillar.cta}
                    </s-paragraph>
                    <s-paragraph>
                      {pillar.drivesReach && "Drives reach · "}
                      {pillar.drivesFollowers && "Drives followers · "}
                      {pillar.drivesPurchase && "Drives purchase · "}
                      {pillar.postLess && "Post less often"}
                    </s-paragraph>
                  </>
                )}
              </s-stack>
            </s-box>
          ))}
        </s-stack>

        {isDraftMode && (
          <s-button onClick={save} {...(isSaving ? { loading: true } : {})}>
            Approve &amp; save
          </s-button>
        )}

        {saveFetcher.data?.intent === "save" && (
          <s-paragraph>Saved.</s-paragraph>
        )}
      </s-section>
    </s-page>
  );
}
