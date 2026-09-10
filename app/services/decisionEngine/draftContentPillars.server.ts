import { z } from "zod";
import { generateStructuredForTask } from "../ai/index.server";

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
  idealFormat: z.enum(["carousel", "single_image"]),
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
  products: ProductSample[],
  brandVoice: BrandVoiceInput,
): Promise<ContentPillarDraft[]> {
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

For each pillar, also classify it into exactly one growth category (atração | autoridade | relacionamento | conversão), and set an ideal target percentage of the weekly content mix — the percentages across all pillars should roughly sum to 100. Flag which pillars should drive reach, which should drive new followers, which should bring the audience closer to a purchase, and which should simply be posted less often than the others (not every pillar deserves equal frequency).`;

  const result = await generateStructuredForTask("content_pillars", pillarsDraftSchema, prompt);
  return result.pillars;
}
