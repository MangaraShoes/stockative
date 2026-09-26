import { z } from "zod";
import { generateStructuredForTask } from "../ai/index.server";
import { CONTENT_LANGUAGES, type ContentLanguageCode } from "./constants";

interface ProductSample {
  title: string;
  description: string | null;
  productType: string | null;
  price: number;
}

interface BrandVoiceInput {
  brandDescription: string | null;
  brandTone: string | null;
  brandAvoid: string | null;
}

const pillarSchema = z.object({
  name: z
    .string()
    .describe("Specific to this brand — never a generic label like 'Education' or 'Inspiration'"),
  function: z.string().describe("Why this pillar exists in the strategy"),
  attractsAudience: z.string().describe("Which slice of the ideal audience this pillar speaks to"),
  problemExplored: z.string().describe("The specific pain/need this pillar addresses"),
  promise: z.string().describe("What the audience gains by consuming this pillar"),
  // "single_image" removido das opções (Patricia, 22/09/2026: "nao queremos
  // posts de single imagem somente qdo o produto nao tiver imagens de
  // still") — o post publicado já inclui stills do produto sempre que
  // existem (buildCarousel.server.ts puxa até 3 sozinho, independente
  // desse campo), então esse valor nunca reduzia o número de imagens de
  // verdade, só confundia como um rótulo de "isso vai sair como 1 imagem
  // só". Um pilar antigo salvo com "single_image" continua funcionando
  // normalmente (stage1.server.ts ainda sabe interpretar esse valor); só a
  // IA para de sugerir esse valor pra pilar NOVO daqui pra frente.
  idealFormat: z
    .enum(["carousel", "reel"])
    .describe(
      "reel only for pillars whose content is naturally about motion or a moment unfolding (behind the scenes, founder story, styling/how-to, process, before/after) — not for pillars that are fundamentally about showing crisp product detail from multiple static angles. Every other pillar is carousel: the post always shows the product's still photos alongside the hero image when they exist, never just one image on purpose.",
    ),
  cta: z.string().describe("The action this pillar typically asks for"),
  growthCategory: z.enum(["atração", "autoridade", "relacionamento", "conversão"]),
  targetSharePct: z
    .number()
    .describe("Ideal percentage of the weekly content mix this pillar should occupy"),
  drivesReach: z.boolean(),
  drivesFollowers: z.boolean(),
  drivesPurchase: z.boolean(),
  postLess: z.boolean().describe("True if this pillar should be posted less often than the others"),
});

const pillarsDraftSchema = z.object({
  pillars: z.array(pillarSchema).min(4).max(6),
});

export type ContentPillarDraft = z.infer<typeof pillarSchema>;

// Fase 1 do sistema de crescimento (ver MARKETING-KNOWLEDGE.md) — 4 a 6
// pilares de conteúdo específicos da marca, gerados a partir do diagnóstico
// implícito (posicionamento + catálogo + vendas) e do Brand Voice já
// aprovado. Rascunho: a lojista revisa/edita/aprova antes de salvar, mesmo
// padrão do draftBrandVoice.
export async function draftContentPillars(
  shopId: string,
  products: ProductSample[],
  brandVoice: BrandVoiceInput,
  languageCode: ContentLanguageCode,
): Promise<ContentPillarDraft[]> {
  const languageLabel =
    CONTENT_LANGUAGES.find((l) => l.code === languageCode)?.label ?? "English";
  const sample = products.slice(0, 30);
  const productList = sample
    .map(
      (p) =>
        `- ${p.title}${p.productType ? ` (${p.productType})` : ""}, €${p.price.toFixed(2)}: ${p.description?.slice(0, 150) ?? "(no description)"}`,
    )
    .join("\n");

  const prompt = `You are a senior social media strategist. Before proposing content pillars, silently diagnose this brand's positioning: who they help, what problem they solve, what result they deliver, why someone should follow them. Do not output the diagnosis itself — use it to ground the pillars.

Brand voice (already approved by the merchant):
- Description: ${brandVoice.brandDescription ?? "(not set)"}
- Tone: ${brandVoice.brandTone ?? "(not set)"}
- Avoid: ${brandVoice.brandAvoid ?? "(not set)"}

Product catalog sample:
${productList}

Define 4 to 6 content pillars for this brand. Each pillar must be SPECIFIC to this brand — never a generic pillar name like "Education" or "Inspiration" that could belong to any brand in the niche. Ground every field in the actual products and brand voice above, not generic social media advice.

For each pillar, also classify it into exactly one growth category (atração | autoridade | relacionamento | conversão), and set an ideal target percentage of the weekly content mix — the percentages across all pillars should roughly sum to 100. Flag which pillars should drive reach, which should drive new followers, which should bring the audience closer to a purchase, and which should simply be posted less often than the others (not every pillar deserves equal frequency).

Write every field in ${languageLabel}, consistently. Never mix languages within a single field (e.g. a French phrase inserted into an otherwise English sentence) — pick ${languageLabel} for everything, including the pillar name and CTA.

Never use an em dash (—) anywhere in the output; use a comma, period, colon, or parentheses instead.`;

  // Conta contra a cota mensal (mesmo motivo do brand_analysis, ver
  // creditUsage.server.ts) — protege sobretudo contra reenvio repetido do
  // formulário, já que esta tela não tem botão de regenerar de verdade.
  const result = await generateStructuredForTask("content_pillars", pillarsDraftSchema, prompt, {
    shopId,
    countsAsCredit: true,
  });
  return result.pillars;
}
