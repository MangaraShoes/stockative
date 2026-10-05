import { z } from "zod";
import prisma from "../../db.server";
import { generateStructuredForTask } from "../ai/index.server";
import type { BrandSources } from "../brandSources.server";
import { MODEL_LIST_VALUES, MODEL_SUBJECT_VALUES, type ModelProfileListField } from "../imageMvp/modelProfile";

function enumOf(values: string[]) {
  return z.enum(values as [string, ...string[]]);
}

const listField = (field: ModelProfileListField) => z.array(enumOf(MODEL_LIST_VALUES[field]));

// Sugestão de perfil de foto junto com o brand voice (Patricia, 05/10/2026:
// "criar uma sugestão de modelo no momento do brand analysis, quando cria o
// brand voice já define a modelo") — a lojista vê e pode mudar em Settings.
const photoProfileSuggestionSchema = z.object({
  subject: enumOf(MODEL_SUBJECT_VALUES),
  occasions: listField("occasions"),
  outfitStyles: listField("outfitStyles"),
  ageRanges: listField("ageRanges"),
  bodyTypes: listField("bodyTypes"),
  heights: listField("heights"),
  ethnicities: listField("ethnicities"),
  hairColors: listField("hairColors"),
  hairStyles: listField("hairStyles"),
  attitudes: listField("attitudes"),
  reason: z.string().describe("One short sentence: why this photo profile fits the brand"),
});

interface ProductSample {
  title: string;
  description: string | null;
  productType: string | null;
  price: number;
}

const brandDraftSchema = z.object({
  brandDescription: z
    .string()
    .describe("Two to three sentences describing who this brand is and what makes it different"),
  brandTone: z
    .string()
    .describe("A short phrase describing the tone of voice, e.g. 'warm, confident, never pushy'"),
  brandAvoid: z
    .string()
    .describe("Things this brand's copy should never say or imply"),
  photoProfile: photoProfileSuggestionSchema.describe(
    "Suggested people and settings for this brand's AI product photos",
  ),
});

export type BrandDraft = z.infer<typeof brandDraftSchema>;

// Rascunho de Brand Intelligence — o merchant revisa e edita antes de
// salvar, nunca é salvo automaticamente (decisão de Patricia, 09/09/2026).
//
// A narrativa vem das fontes reais que a própria marca já escreveu sobre si
// (Patricia, 10/09/2026: "a narrativa da marca deve vir da análise do about
// us do site, da descrição da marca no Shopify e no IG", ver
// brandSources.server.ts) — não mais inferida livremente do catálogo, que
// antes produzia narrativa inventada (ex.: "handmade by named artisans")
// sem nenhuma fonte real por trás. O catálogo continua entrando, mas só
// como evidência de fato material (o que o produto é de fato), nunca como
// origem da história da marca.
export async function draftBrandVoice(
  shopId: string,
  products: ProductSample[],
  sources: BrandSources,
  // Comentário livre da lojista quando ela pede pra regenerar um rascunho
  // que já não agradou (Patricia, 12/09/2026: "ter a opção de modificar ou
  // regenerar explicando o porquê") — mesmo padrão do correctionNote em
  // generateProductImage.server.ts.
  feedback?: string,
): Promise<BrandDraft> {
  const sample = products.slice(0, 20);
  // Fotos lifestyle da própria loja (já classificadas, ver
  // imageCandidates.server.ts) — a melhor evidência de que pessoas e
  // cenários a marca já usa, pra sugestão do perfil de foto.
  const lifestyleImageUrls = (
    await prisma.productImage.findMany({
      where: { shotType: "lifestyle", product: { shopId } },
      orderBy: { createdAt: "desc" },
      take: 4,
      select: { url: true },
    })
  ).map((image) => image.url);
  const lifestyleImageCount = lifestyleImageUrls.length;
  const priceRange =
    sample.length > 0
      ? `€${Math.min(...sample.map((p) => p.price)).toFixed(2)} - €${Math.max(...sample.map((p) => p.price)).toFixed(2)}`
      : "unknown";

  const productList = sample
    .map(
      (p) =>
        `- ${p.title}${p.productType ? ` (${p.productType})` : ""}: ${p.description?.slice(0, 200) ?? "(no description)"}`,
    )
    .join("\n");

  const sourceBlocks: string[] = [];
  if (sources.aboutPageText) {
    sourceBlocks.push(`About Us page (from the brand's own website):\n${sources.aboutPageText}`);
  }
  if (sources.shopDescription) {
    sourceBlocks.push(`Shopify store description:\n${sources.shopDescription}`);
  }
  if (sources.instagramBio) {
    sourceBlocks.push(`Instagram bio:\n${sources.instagramBio}`);
  }
  const sourcesText =
    sourceBlocks.length > 0
      ? sourceBlocks.join("\n\n")
      : "(none available — no About Us page found, no Shopify store description set, Instagram not connected yet)";

  // Posts próprios e de concorrentes são referência de estilo/nicho, nunca
  // fonte de alegação factual sobre a marca — não entram nos sourceBlocks
  // acima de propósito (MARKETING-KNOWLEDGE.md seção 4: nunca confundir
  // proxy de engajamento público com fato sobre a marca).
  const ownPostsText =
    sources.ownRecentPosts.length > 0
      ? sources.ownRecentPosts
          .slice(0, 8)
          .map((p) => `- "${p.caption?.slice(0, 150) ?? "(no caption)"}" (${p.likeCount} likes, ${p.commentsCount} comments)`)
          .join("\n")
      : "(none available — no post history synced, or Instagram not connected)";

  const competitorText =
    sources.competitorSnapshots.length > 0
      ? sources.competitorSnapshots
          .map(
            (c) =>
              `@${c.username} (${c.followersCount ?? "?"} followers):\n` +
              c.recentPosts
                .slice(0, 5)
                .map((p) => `  - "${p.caption?.slice(0, 150) ?? "(no caption)"}" (${p.likeCount} likes)`)
                .join("\n"),
          )
          .join("\n\n")
      : "(none available — no competitor accounts added yet)";

  const prompt = `Based on this brand's own self-description, draft a brand voice profile. This is a DRAFT the merchant will review and edit.

The brand's own narrative (PRIMARY source — this is how the brand actually describes itself; ground the description and tone in this, don't override it with your own invention):
${sourcesText}

Price range: ${priceRange}

Products (SECONDARY source — use only to confirm concrete material/design facts and the price tier, not to invent narrative):
${productList}

This brand's own recent Instagram captions (style/voice reference only — shows how the brand actually writes today, not a source of new factual claims):
${ownPostsText}

Niche competitor reference (style/positioning context only — what similar accounts in this niche post about; NEVER attribute their claims, products, or results to this brand):
${competitorText}

Ground the brand description in what the PRIMARY sources actually say. If those are empty or thin, fall back to only what the product catalog concretely supports (materials, design details, price tier) — never invent a production story, founder narrative, or manufacturing claim (no "handmade by artisans," "small-batch," "family workshop") that isn't stated somewhere in the sources above. Use the brand's own captions to calibrate tone (do they actually sound the way the About Us page implies?) and the competitor reference only to understand what's already saturated/generic in this niche, so the tone stands out rather than blending in — never to borrow a competitor's claims.

Even when the sources mention craftsmanship, heritage, or sustainability, don't let that become the LEAD of the brand description — those are supporting proof of quality, never the main hook. Lead with the brand's most concrete, differentiating claim instead (a specific design point of view, a real price-to-quality argument, something distinctive about the product itself). If craftsmanship/sustainability appear in the sources, mention them as secondary support, not the opening idea (Patricia, 10/09/2026 — decided explicitly after seeing this exact pattern happen once already).

Also suggest a photoProfile for the brand's AI product photos: who appears (subject — "auto" when the catalog mixes products for different people), the occasions and outfit style that fit the brand's positioning and price tier, and the look of the people (age, body type, height, hair, mood). Pick 1 to 3 values per list where the brand clearly points somewhere, and leave a list empty when nothing in the sources supports a choice (empty = the app varies freely). Leave ethnicities empty unless the brand's own sources explicitly define it — diverse by default, never inferred from the brand's country or origin story. Base it on the brand's audience and positioning, not on stereotypes.${
    lifestyleImageCount
      ? ` The attached images are this brand's own lifestyle product photos: match the people and settings shown there.`
      : ""
  }

Draft the brand description, tone of voice, and things to avoid saying. Never use an em dash (—) anywhere in the output; use a comma, period, colon, or parentheses instead.${
    feedback
      ? `\n\nThe merchant reviewed a previous draft and asked for this specific change: "${feedback}". Address that directly in this new draft, while still respecting the grounding rules above.`
      : ""
  }`;

  // Conta contra a cota mensal (achado ao vivo, 26/09/2026: rodava
  // ilimitado até aqui — o botão Regenerate fica disponível pra sempre na
  // tela, não só no onboarding, ver getMonthlyLimit em creditUsage.server.ts).
  return generateStructuredForTask("brand_analysis", brandDraftSchema, prompt, {
    shopId,
    countsAsCredit: true,
    ...(lifestyleImageUrls.length ? { imageUrls: lifestyleImageUrls } : {}),
  });
}
