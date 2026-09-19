import { useEffect, useRef, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect, useFetcher, useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { draftBrandVoice } from "../services/decisionEngine/draftBrandVoice.server";
import { fetchBrandSources } from "../services/brandSources.server";
import { prepareLogo, LogoNotTransparentError } from "../services/imageMvp/logoOverlay.server";
import { CONTENT_LANGUAGES } from "../services/decisionEngine/constants";
import { getOnboardingStatus, type OnboardingStatus } from "../services/onboardingStatus.server";
import { OnboardingStepper } from "../components/OnboardingStepper";
import { GeneratingProgressBar } from "../components/GeneratingProgressBar";

const EMPTY_ONBOARDING_STATUS: OnboardingStatus = {
  hasStock: false,
  hasBrand: false,
  hasSocial: false,
  hasCompetitors: false,
  hasContentPillars: false,
  hasPublished: false,
};

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

  const onboardingStatus = shop ? await getOnboardingStatus(shop.id) : EMPTY_ONBOARDING_STATUS;

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
    languageConfirmed: shop?.languageConfirmed ?? false,
    onboardingStatus,
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
    const feedback = String(formData.get("feedback") ?? "").trim() || undefined;

    // Nunca deixar um erro daqui derrubar a página inteira sem mensagem
    // (Patricia, 12/09/2026: clicou em "Regenerate" e a tela ficou em
    // branco) — a causa raiz era a IA às vezes devolver um JSON malformado
    // (já corrigido em parseJsonResponse), mas qualquer outra falha aqui
    // agora também vira um erro visível na tela, nunca um crash silencioso.
    try {
      const draft = await draftBrandVoice(products, sources, feedback);
      return {
        intent,
        draft,
        error: null,
        sourcesFound: {
          aboutPage: Boolean(sources.aboutPageText),
          shopDescription: Boolean(sources.shopDescription),
          instagramBio: Boolean(sources.instagramBio),
          ownPosts: sources.ownRecentPosts.length > 0,
          competitors: sources.competitorSnapshots.length,
          competitorDataStatus: sources.competitorDataStatus,
        },
      };
    } catch (error) {
      console.error("draftBrandVoice failed:", error);
      return {
        intent,
        draft: null,
        error: "Something went wrong generating your draft. Try again.",
        sourcesFound: null,
      };
    }
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
      data: {
        contentLanguagePrimary: primary,
        contentLanguageSecondary: secondary,
        languageConfirmed: true,
      },
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

  // Mesma trava do botão no cliente, reforçada aqui — nunca confiar só no
  // disabled (Patricia, 12/09/2026: "precisa ser passo obrigatório salvar a
  // linguagem antes de aprovar o brand voice").
  if (!shop.languageConfirmed) {
    throw new Response("Save your publishing language first.", { status: 400 });
  }

  const brandDescription = String(formData.get("brandDescription") ?? "").trim();
  const brandTone = String(formData.get("brandTone") ?? "").trim();
  const brandAvoid = String(formData.get("brandAvoid") ?? "").trim();
  const applyLogoOverlay = formData.get("applyLogoOverlay") === "true";

  await prisma.shop.update({
    where: { shopifyDomain: session.shop },
    data: { brandDescription, brandTone, brandAvoid, applyLogoOverlay },
  });

  // Leva direto pra próxima tela quando é a única coisa que falta pra essa
  // etapa — o aviso de "next step" ficava escondido lá embaixo, depois do
  // Logo (Patricia, 12/09/2026: "ficou bem escondidinho... deveria abrir
  // nova tela com este botão").
  const pillarsCount = await prisma.contentPillar.count({ where: { shopId: shop.id } });
  if (pillarsCount === 0) {
    throw redirect("/app/content-pillars");
  }

  return { intent: "save" as const, saved: true };
};

export default function StoreVoice() {
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
  const [regenerateFeedback, setRegenerateFeedback] = useState("");

  useEffect(() => {
    if (draftFetcher.data?.intent === "draft" && draftFetcher.data.draft) {
      setBrandDescription(draftFetcher.data.draft.brandDescription);
      setBrandTone(draftFetcher.data.draft.brandTone);
      setBrandAvoid(draftFetcher.data.draft.brandAvoid);
      setRegenerateFeedback("");
    }
  }, [draftFetcher.data]);

  const isDrafting = draftFetcher.state !== "idle";
  const isSaving = saveFetcher.state !== "idle";
  const hasDraft = draftFetcher.data?.intent === "draft" && Boolean(draftFetcher.data.draft);
  const draftError = draftFetcher.data?.intent === "draft" ? draftFetcher.data.error : null;
  const canDraft = data.productCount > 0 && data.isInstagramConnected;
  const hasSavedBefore = Boolean(
    data.brandDescription || data.brandTone || data.brandAvoid,
  );

  const generateDraft = (feedback?: string) =>
    draftFetcher.submit({ intent: "draft", ...(feedback ? { feedback } : {}) }, { method: "POST" });

  // Gera o rascunho sozinho assim que a página carrega, sem exigir clique
  // nenhum — a cliente só revisa e aprova (ou pede ajuste) (Patricia,
  // 12/09/2026: "deve ser preenchido automaticamente sem precisar clicar em
  // nenhum botão"). Só dispara uma vez, e só quando ainda não existe nada
  // salvo nem gerado.
  const autoDraftTriggered = useRef(false);
  useEffect(() => {
    if (
      canDraft &&
      !hasSavedBefore &&
      !hasDraft &&
      draftFetcher.state === "idle" &&
      !autoDraftTriggered.current
    ) {
      autoDraftTriggered.current = true;
      generateDraft();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canDraft, hasSavedBefore]);

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
    : "Store voice";
  const saveButtonLabel = "Approve and save";

  return (
    <s-page heading="Store voice">
      <OnboardingStepper status={data.onboardingStatus} currentStepHref="/app/store-voice" />

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

        {/* Botão com fundo cinza de verdade e espaçamento próprio — a
            variante padrão do s-button não tem preenchimento sólido e
            ficava colado nos dropdowns acima (Patricia, 12/09/2026: "mal
            posicionado e deve ser cinza também"), mesmo padrão do botão
            Skip em app.competitors.tsx. */}
        <div style={{ marginTop: 12 }}>
          <button
            type="button"
            onClick={saveLanguage}
            disabled={isSavingLanguage}
            style={{
              display: "inline-block",
              padding: "8px 16px",
              border: "1px solid #a8abae",
              borderRadius: 8,
              background: "#c9cccf",
              color: "#202223",
              fontWeight: 500,
              cursor: isSavingLanguage ? "default" : "pointer",
            }}
          >
            Save publishing language
          </button>
        </div>

        {languageFetcher.data?.intent === "save-language" && (
          <s-paragraph>Saved.</s-paragraph>
        )}
      </s-section>

      <s-section>
        {/* s-heading avulso em vez do heading do s-section — fica maior e
            com mais destaque (Patricia, 12/09/2026: "Store voice pode ser
            maior em mais destaque"). */}
        <s-heading>{sectionHeading}</s-heading>
        <s-paragraph>
          Built from a real analysis of your store and social accounts:
          your products, your Instagram, your Shopify About Us page, and
          your competitors&apos; voice, so every post the AI writes
          actually sounds like you.
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

          {/* Sem botão pra gerar o primeiro rascunho — ele já é gerado
              sozinho assim que a página carrega (ver useEffect acima). A
              cliente só revisa, aprova, edita à mão, ou pede pra regenerar
              explicando o que mudar (Patricia, 12/09/2026: "deve ser
              preenchido automaticamente... apenas a cliente precisa
              confirmar se concorda, se não, ter a opção de modificar ou
              regenerar explicando o porquê"). */}
          {isDrafting && !hasDraft && !hasSavedBefore && (
            <>
              <s-paragraph>
                Writing your first draft from your store, Instagram and About
                Us page…
              </s-paragraph>
              <GeneratingProgressBar label="Reading your store, Instagram and About Us page…" />
            </>
          )}
          {draftError && (
            <s-paragraph>
              <strong>{draftError}</strong>
            </s-paragraph>
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
            <s-paragraph>Store description</s-paragraph>
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

          {canDraft && (hasDraft || hasSavedBefore) && (
            <div>
              <s-paragraph>
                Not quite right? Tell us what to change, or simply ask to
                regenerate.
              </s-paragraph>
              <textarea
                value={regenerateFeedback}
                onChange={(e) => setRegenerateFeedback(e.target.value)}
                placeholder="e.g. make the tone warmer, mention we're a family business, don't focus on price"
                rows={2}
                style={{ width: "100%", padding: 8 }}
              />
              {/* Fundo cinza de verdade — mesmo padrão do Skip em
                  app.competitors.tsx e do Save publishing language acima:
                  variant="secondary" do s-button não tem preenchimento
                  sólido (Patricia, 12/09/2026). */}
              <div style={{ marginTop: 8 }}>
                <button
                  type="button"
                  onClick={() => generateDraft(regenerateFeedback || undefined)}
                  disabled={isDrafting}
                  style={{
                    display: "inline-block",
                    padding: "8px 16px",
                    border: "1px solid #a8abae",
                    borderRadius: 8,
                    background: "#c9cccf",
                    color: "#202223",
                    fontWeight: 500,
                    opacity: isDrafting ? 0.5 : 1,
                    cursor: isDrafting ? "default" : "pointer",
                  }}
                >
                  {isDrafting ? "Regenerating…" : "Regenerate"}
                </button>
                {isDrafting && <GeneratingProgressBar label="Regenerating your store voice…" />}
              </div>
            </div>
          )}

          <div>
            <s-paragraph>Logo (optional)</s-paragraph>
            <s-paragraph>
              Adds it to the corner of AI-generated product images. Must be
              a PNG with a transparent background.
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
                Add my logo to the top-right corner of AI-generated product images
              </label>
            </div>
          </div>

          {/* Bem no final, depois do Logo — é a ação de confirmação de tudo
              acima (Patricia, 12/09/2026: "deve vir depois da logo bem no
              final"). */}
          {!data.languageConfirmed && (
            <s-paragraph>
              <strong>
                Save your publishing language above first — it&apos;s
                required before you can approve your store voice.
              </strong>
            </s-paragraph>
          )}

          {/* Preto, não cinza — é a ação obrigatória pra destravar o próximo
              passo do onboarding, diferente de Regenerate (opcional), então
              precisa ficar visualmente clara como "a que eu tenho que
              clicar" (Patricia, 13/09/2026). */}
          <button
            type="button"
            onClick={save}
            disabled={isSaving || !data.languageConfirmed}
            style={{
              display: "inline-block",
              alignSelf: "flex-start",
              padding: "8px 16px",
              border: "1px solid #000",
              borderRadius: 8,
              background: "#000",
              color: "#fff",
              fontWeight: 500,
              opacity: !data.languageConfirmed ? 0.5 : 1,
              cursor: isSaving || !data.languageConfirmed ? "default" : "pointer",
            }}
          >
            {saveButtonLabel}
          </button>

          {saveFetcher.data?.intent === "save" && (
            <s-paragraph>Approved and saved.</s-paragraph>
          )}
        </s-stack>
      </s-section>
    </s-page>
  );
}
