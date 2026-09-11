import { z } from "zod";
import { generateStructuredForTask } from "../ai/index.server";
import { NARRATIVE_FRAMEWORKS, type CommercialObjective } from "./constants";
import { getEligibleArchetypes, type ArchetypeEvidence } from "./archetypes.server";

const LOW_STOCK_THRESHOLD = 5; // escassez real — ver MARKETING-KNOWLEDGE.md seção 4
const NEWNESS_WINDOW_DAYS = 21;

interface Stage1Input {
  productTitle: string;
  productDescription: string | null;
  productType: string | null;
  price: number;
  inventoryQuantity: number;
  unitsSold30d: number;
  salesVelocity: number;
  daysSinceLastSale: number | null;
  daysSinceCreated: number | null;
  objective: CommercialObjective;
  // Única fonte real pra fundamentar founder_story/behind_the_scenes — sem
  // isso, esses arquétipos não podem citar fato nenhum, só o que já está no
  // cadastro do produto (ver regras de evidência abaixo).
  brandDescription: string | null;
  // Pilar (Fase 1, ver MARKETING-KNOWLEDGE.md) que este post deve servir —
  // opcional: nem toda loja tem pilares salvos ainda, nem todo post precisa
  // vir de um (Patricia, 11/09/2026: "implementa os pilares influenciando o
  // weekly planner"). Quando presente, ancora problema/promessa/CTA/formato
  // do post — o Estágio 1 continua decidindo arquétipo/ângulo/framework
  // livremente dentro dessa moldura, não o contrário.
  pillar?: {
    name: string;
    function: string;
    problemExplored: string;
    promise: string;
    idealFormat: string;
    cta: string;
    growthCategory: string;
  } | null;
}

function computeEvidence(input: Stage1Input): ArchetypeEvidence {
  return {
    hasFounderFact: Boolean(input.brandDescription?.trim()),
    hasVerifiableSales: input.unitsSold30d > 0,
    isLowStock: input.inventoryQuantity > 0 && input.inventoryQuantity <= LOW_STOCK_THRESHOLD,
    isRecentProduct: input.daysSinceCreated !== null && input.daysSinceCreated <= NEWNESS_WINDOW_DAYS,
  };
}

// Resumo determinístico (não julgado pela IA) do que está de fato disponível
// — passado pro Estágio 2 também, pra ele nunca precisar adivinhar o que é
// real (Patricia, 11/09/2026: "Evidence is not carried through into
// final-copy validation" — o Estágio 2 só recebia o brief e a Brand Voice,
// sem saber quais campos do brief já eram evidência verificada). Também
// existe pra nunca mais confundir "produto listado há N dias" com "sem
// vendas há N dias" — achado real no post publicado ("Zero sales velocity
// over 829 days", quando na verdade eram 829 dias desde o cadastro e ZERO
// vendas nos últimos 30, dois fatos diferentes que o texto livre da IA
// fundiu num só).
export function describeEvidence(input: Stage1Input): string {
  const evidence = computeEvidence(input);
  const lines = [
    `- Founder/brand facts: ${evidence.hasFounderFact ? "available — the brand description below is real and can be cited" : "NOT available — do not state any founder or brand-history fact"}`,
    `- Verifiable sales: ${evidence.hasVerifiableSales ? `available — ${input.unitsSold30d} unit(s) sold in the last 30 days, may be cited as a real number` : "NOT available — do not imply the product is popular or selling well"}`,
    `- Real scarcity: ${evidence.isLowStock ? `available — only ${input.inventoryQuantity} unit(s) left, may be cited as real urgency` : "NOT available — never imply the product is running out"}`,
    `- Product recency: ${evidence.isRecentProduct ? `available — listed ${input.daysSinceCreated} day(s) ago, may be called new/recent` : "NOT available — do not call this a new or recent arrival"}`,
    `- Days since last sale (${input.daysSinceLastSale ?? "no recorded sale"}) and days since listed (${input.daysSinceCreated ?? "unknown"}) are DIFFERENT numbers measuring different things — never combine them into one figure or one claim (e.g. never say "no sales in N days" using the listing age).`,
  ];
  return lines.join("\n");
}

// Saída do Estágio 1 — decisão estruturada, nunca texto de marketing.
// Campos batem com content_items.decision_brief documentado em ARCHITECTURE.md.
export function buildStage1Schema(objective: CommercialObjective, evidence: ArchetypeEvidence) {
  const eligibleArchetypes = getEligibleArchetypes(objective, evidence);

  return z.object({
    objective: z.literal(objective),
    product: z.string().describe("Nome do produto, como referência no brief"),
    audience: z.string().describe("Público-alvo desse post, ex.: 'Women 28-50 who value quality'"),
    reason: z.string().describe("Por que este produto/objetivo agora, em uma frase"),
    channel: z.enum(["instagram", "facebook"]),
    funnelStage: z.enum(["awareness", "consideration", "conversion", "retention"]),
    creativeArchetype: z.enum(
      eligibleArchetypes as [string, ...string[]],
    ),
    creativeAngle: z
      .string()
      .describe("Mensagem específica dentro do arquétipo escolhido, para este produto"),
    narrativeFramework: z.enum(NARRATIVE_FRAMEWORKS),
    format: z.enum(["lifestyle", "studio", "close_up"]),
    cta: z.string().describe("Chamada para ação curta, ex.: 'Shop now'"),
    usesAiImage: z.boolean(),
  });
}

// O tipo inferido não depende dos valores reais passados em runtime — o
// enum de creativeArchetype já vira string via o cast em buildStage1Schema.
export type Stage1Output = z.infer<ReturnType<typeof buildStage1Schema>>;

export async function decideContentBrief(
  input: Stage1Input,
): Promise<Stage1Output> {
  const evidence = computeEvidence(input);
  const eligibleArchetypes = getEligibleArchetypes(input.objective, evidence);
  const schema = buildStage1Schema(input.objective, evidence);

  const prompt = `You are the Content Decision Engine for a Shopify AI marketing app. You decide the STRATEGY for one social media post — you do NOT write the caption itself.

Product:
- Title: ${input.productTitle}
- Description: ${input.productDescription ?? "(none)"}
- Type: ${input.productType ?? "(unknown)"}
- Price: €${input.price.toFixed(2)}
- Inventory: ${input.inventoryQuantity} units
- Units sold (last 30 days): ${input.unitsSold30d}
- Sales velocity: ${input.salesVelocity.toFixed(2)} units/day
- Days since last sale: ${input.daysSinceLastSale ?? "no recorded sale"}
- Days since listed: ${input.daysSinceCreated ?? "unknown"}

Brand description (source of truth for founder_story and behind_the_scenes claims — do NOT state anything beyond what's written here):
${input.brandDescription?.trim() || "(not set — founder_story and behind_the_scenes must stay fully generic, no specific unverified detail)"}

${
  input.pillar
    ? `Content pillar this post must serve (a strategic content theme the merchant already approved — ground creativeAngle and audience in this pillar's problem/promise for THIS specific product, don't drift into an unrelated angle):
- Name: ${input.pillar.name}
- Function: ${input.pillar.function}
- Problem it explores: ${input.pillar.problemExplored}
- Promise: ${input.pillar.promise}
- Ideal format: ${input.pillar.idealFormat}
- Typical CTA: ${input.pillar.cta}
- Growth category: ${input.pillar.growthCategory} (atração=reach/new eyes, autoridade=trust/expertise, relacionamento=deepen with existing followers, conversão=drive purchase — let this bias your archetype/format choice toward what naturally serves that category, without overriding the eligible-archetype list below)
Prefer format "${input.pillar.idealFormat === "carousel" ? "lifestyle or studio, suited to a multi-image carousel" : "close_up or studio, suited to a single image"}" unless the product genuinely calls for something else.
`
    : ""
}Commercial objective for this post: ${input.objective}

You MUST choose creativeArchetype from exactly this list (do not use any other value): ${eligibleArchetypes.join(", ")}. This list is already filtered to archetypes this product/shop actually has evidence for — never argue around the restriction.

Evidence rules — creativeAngle and reason become the seed for the actual caption, so nothing invented or muddled here can be undone later:
- Ground every specific claim in the product info or brand description above. If a detail isn't stated there, don't invent it.
- "Days since last sale" and "days since listed" are DIFFERENT numbers measuring different things — never combine them into one figure or one claim in the reason field (e.g. never say "no sales in N days" using the listing-age number; if there's no recorded sale, say so as its own fact, separate from how long the product has existed).
- behind_the_scenes: describe only process/material facts explicitly stated above — never invent artisan names, hand gestures, step-by-step crafting rituals, or phrases like "real hands and real time" that aren't literally stated. Do not frame the brand as artisanal/handmade-by-individuals unless the brand description explicitly says so.
- founder_story: use only real facts from the brand description above — never invent biography details.
- objection_handling: reference only generic objection categories (fit, sizing, returns, price) — never invent a specific policy detail (like an exact return window) unless it's stated above.
- comparison: keep any contrast implicit/generic — never state a specific fact about a named competitor without a source.
- Even when craftsmanship, heritage, or sustainability is a real sourced fact, don't make it the LEAD of creativeAngle — lead with the most concrete differentiating claim instead (a specific design point, a real price-to-quality argument), mention heritage only as secondary support.

Decide the full content strategy brief now.`;

  return generateStructuredForTask("decision_engine", schema, prompt);
}
