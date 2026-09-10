import { useEffect, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { draftBrandVoice } from "../services/decisionEngine/draftBrandVoice.server";
import { fetchBrandSources } from "../services/brandSources.server";
import { prepareLogo, LogoNotTransparentError } from "../services/imageMvp/logoOverlay.server";
import { CONTENT_LANGUAGES } from "../services/decisionEngine/constants";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);

  const shop = await prisma.shop.findUnique({
    where: { shopifyDomain: session.shop },
  });

  const productCount = shop
    ? await prisma.productCache.count({ where: { shopId: shop.id } })
    : 0;

  const socialAccount = shop
    ? await prisma.socialAccount.findUnique({
        where: { shopId_platform: { shopId: shop.id, platform: "instagram" } },
      })
    : null;

  return {
    brandDescription: shop?.brandDescription ?? "",
    brandTone: shop?.brandTone ?? "",
    brandAvoid: shop?.brandAvoid ?? "",
    logoUrl: shop?.logoUrl ?? null,
    applyLogoOverlay: shop?.applyLogoOverlay ?? false,
    productCount,
    isInstagramConnected: Boolean(socialAccount?.igBusinessAccountId),
    contentLanguagePrimary: shop?.contentLanguagePrimary ?? "en",
    contentLanguageSecondary: shop?.contentLanguageSecondary ?? "",
  };
};

// Instagram conectado é obrigatório antes de gerar o rascunho de Brand Voice
// (Patricia, 10/09/2026 — ver nota em app.plan-week.tsx, mesma regra).
export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent");

  const shop = await prisma.shop.findUnique({
    where: { shopifyDomain: session.shop },
  });
  if (!shop) throw new Response("Shop not found", { status: 404 });

  if (intent === "draft") {
    const socialAccount = await prisma.socialAccount.findUnique({
      where: { shopId_platform: { shopId: shop.id, platform: "instagram" } },
    });
    if (!socialAccount?.igBusinessAccountId) {
      throw new Response("Connect Instagram first — see Social accounts.", { status: 400 });
    }

    const products = await prisma.productCache.findMany({
      where: { shopId: shop.id },
      select: { title: true, description: true, productType: true, price: true },
    });
    const sources = await fetchBrandSources(admin, shop.id);
    const draft = await draftBrandVoice(products, sources);
    return {
      intent,
      draft,
      sourcesFound: {
        aboutPage: Boolean(sources.aboutPageText),
        shopDescription: Boolean(sources.shopDescription),
        instagramBio: Boolean(sources.instagramBio),
        ownPosts: sources.ownRecentPosts.length > 0,
        competitors: sources.competitorSnapshots.length,
        competitorDataStatus: sources.competitorDataStatus,
      },
    };
  }

  // Idioma(s) de publicação (Patricia, 10/09/2026: "precisamos criar um
  // step onde a cliente escolhe o idioma... até 2 idiomas... aparece o
  // primeiro e na sequência o segundo, em todos os posts") — vale pra
  // Weekly Plan e Create Content, ver translateCaption.server.ts.
  if (intent === "save-language") {
    const primary = String(formData.get("contentLanguagePrimary") ?? "en");
    const secondaryRaw = String(formData.get("contentLanguageSecondary") ?? "");
    const secondary = secondaryRaw && secondaryRaw !== primary ? secondaryRaw : null;

    await prisma.shop.update({
      where: { shopifyDomain: session.shop },
      data: { contentLanguagePrimary: primary, contentLanguageSecondary: secondary },
    });

    return { intent, saved: true };
  }

  if (intent === "upload-logo") {
    const rawLogo = String(formData.get("logo") ?? "");

    try {
      const preparedLogo = await prepareLogo(rawLogo);

      await prisma.shop.update({
        where: { shopifyDomain: session.shop },
        data: { logoUrl: preparedLogo },
      });

      return { intent: "upload-logo" as const, logoUrl: preparedLogo, error: null };
    } catch (error) {
      if (error instanceof LogoNotTransparentError) {
        return { intent: "upload-logo" as const, logoUrl: null, error: error.message };
      }
      throw error;
    }
  }

  const brandDescription = String(formData.get("brandDescription") ?? "");
  const brandTone = String(formData.get("brandTone") ?? "");
  const brandAvoid = String(formData.get("brandAvoid") ?? "");
  const applyLogoOverlay = formData.get("applyLogoOverlay") === "true";

  await prisma.shop.update({
    where: { shopifyDomain: session.shop },
    data: { brandDescription, brandTone, brandAvoid, applyLogoOverlay },
  });

  return { intent: "save" as const, saved: true };
};

export default function Brand() {
  const data = useLoaderData<typeof loader>();
  const draftFetcher = useFetcher<typeof action>();
  const saveFetcher = useFetcher<typeof action>();
  const logoFetcher = useFetcher<typeof action>();
  const languageFetcher = useFetcher<typeof action>();

  const [brandDescription, setBrandDescription] = useState(data.brandDescription);
  const [brandTone, setBrandTone] = useState(data.brandTone);
  const [brandAvoid, setBrandAvoid] = useState(data.brandAvoid);
  const [applyLogoOverlay, setApplyLogoOverlay] = useState(data.applyLogoOverlay);
  const [contentLanguagePrimary, setContentLanguagePrimary] = useState(data.contentLanguagePrimary);
  const [contentLanguageSecondary, setContentLanguageSecondary] = useState(data.contentLanguageSecondary);

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
  const canDraft = data.productCount > 0 && data.isInstagramConnected;
  const hasSavedBefore = Boolean(
    data.brandDescription || data.brandTone || data.brandAvoid,
  );

  const generateDraft = () =>
    draftFetcher.submit({ intent: "draft" }, { method: "POST" });

  const save = () =>
    saveFetcher.submit(
      {
        brandDescription,
        brandTone,
        brandAvoid,
        applyLogoOverlay: String(applyLogoOverlay),
      },
      { method: "POST" },
    );

  const isSavingLanguage = languageFetcher.state !== "idle";
  const saveLanguage = () =>
    languageFetcher.submit(
      {
        intent: "save-language",
        contentLanguagePrimary,
        contentLanguageSecondary,
      },
      { method: "POST" },
    );

  const uploadLogo = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      logoFetcher.submit(
        { intent: "upload-logo", logo: String(reader.result) },
        { method: "POST" },
      );
    };
    reader.readAsDataURL(file);
  };

  const currentLogoUrl =
    logoFetcher.data?.intent === "upload-logo" && logoFetcher.data.logoUrl
      ? logoFetcher.data.logoUrl
      : data.logoUrl;
  const logoError =
    logoFetcher.data?.intent === "upload-logo" ? logoFetcher.data.error : null;
  const isUploadingLogo = logoFetcher.state !== "idle";

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
      <s-section heading="Publishing language">
        <s-paragraph>
          Every post is generated in your primary language. Add a second
          language and every post publishes with the full caption in your
          primary language, followed by the same caption translated into the
          second — in one post, same as how Mangará already posts today
          (e.g. French then Dutch).
        </s-paragraph>

        <s-stack direction="inline" gap="base">
          <div>
            <s-paragraph>Primary language</s-paragraph>
            <select
              value={contentLanguagePrimary}
              onChange={(e) => setContentLanguagePrimary(e.target.value)}
              style={{ padding: 8 }}
            >
              {CONTENT_LANGUAGES.map((lang) => (
                <option key={lang.code} value={lang.code}>
                  {lang.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <s-paragraph>Second language (optional)</s-paragraph>
            <select
              value={contentLanguageSecondary}
              onChange={(e) => setContentLanguageSecondary(e.target.value)}
              style={{ padding: 8 }}
            >
              <option value="">None</option>
              {CONTENT_LANGUAGES.filter((lang) => lang.code !== contentLanguagePrimary).map(
                (lang) => (
                  <option key={lang.code} value={lang.code}>
                    {lang.label}
                  </option>
                ),
              )}
            </select>
          </div>
        </s-stack>

        <s-button
          onClick={saveLanguage}
          {...(isSavingLanguage ? { loading: true } : {})}
        >
          Save publishing language
        </s-button>

        {languageFetcher.data?.intent === "save-language" && (
          <s-paragraph>Saved.</s-paragraph>
        )}
      </s-section>

      <s-section heading={sectionHeading}>
        <s-paragraph>
          This shapes how the AI writes for you — used every time content is
          generated (Stage 2 of the Content Decision Engine).
        </s-paragraph>

        <s-stack direction="block" gap="base">
          {data.productCount > 0 && !data.isInstagramConnected && (
            <s-paragraph>
              <strong>
                Connect Instagram first (Social accounts) — the draft is
                built from your real Instagram bio and post history together
                with your Shopify data, not just your product catalog.
              </strong>
            </s-paragraph>
          )}

          {data.productCount > 0 && (
            <s-button
              onClick={generateDraft}
              variant="tertiary"
              {...(isDrafting ? { loading: true } : {})}
              {...(!canDraft ? { disabled: true } : {})}
            >
              Generate draft with AI (based on your About Us page, Shopify
              store profile, Instagram account and competitors, plus your{" "}
              {data.productCount} synced products)
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
            </s-paragraph>
          )}

          {hasDraft && draftFetcher.data?.sourcesFound && (
            <s-paragraph>
              Grounded in: About Us page{" "}
              {draftFetcher.data.sourcesFound.aboutPage ? "✓ found" : "— not found"}
              , Shopify store description{" "}
              {draftFetcher.data.sourcesFound.shopDescription ? "✓ found" : "— not set"}
              , Instagram bio{" "}
              {draftFetcher.data.sourcesFound.instagramBio ? "✓ found" : "— empty"}
              , own post history{" "}
              {draftFetcher.data.sourcesFound.ownPosts ? "✓ found" : "— none yet"}
              , competitor reference:{" "}
              {draftFetcher.data.sourcesFound.competitorDataStatus === "ok"
                ? `✓ ${draftFetcher.data.sourcesFound.competitors} account(s)`
                : draftFetcher.data.sourcesFound.competitorDataStatus === "blocked"
                  ? "— added, but blocked pending Meta App Review"
                  : "— none added"}
              .
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

          <div>
            <s-paragraph>Logo (optional)</s-paragraph>
            <s-paragraph>
              Upload your logo to optionally add it to the corner of
              AI-generated product images. Must be a PNG with a transparent
              background.
            </s-paragraph>
            {logoError && (
              <s-paragraph>
                <strong>{logoError}</strong>
              </s-paragraph>
            )}
            {currentLogoUrl && (
              <img
                src={currentLogoUrl}
                alt="Your logo"
                style={{
                  maxWidth: 120,
                  maxHeight: 80,
                  marginTop: 8,
                  marginBottom: 8,
                  background:
                    "repeating-conic-gradient(#ccc 0% 25%, transparent 0% 50%) 50% / 16px 16px",
                }}
              />
            )}
            <input
              type="file"
              accept="image/*"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) uploadLogo(file);
              }}
            />
            {isUploadingLogo && <s-paragraph>Processing logo…</s-paragraph>}

            <div style={{ marginTop: 8 }}>
              <label>
                <input
                  type="checkbox"
                  checked={applyLogoOverlay}
                  disabled={!currentLogoUrl}
                  onChange={(e) => setApplyLogoOverlay(e.target.checked)}
                />{" "}
                Add my logo to the corner of AI-generated product images
              </label>
            </div>
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
