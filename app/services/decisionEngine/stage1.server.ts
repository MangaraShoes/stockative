import { z } from "zod";
import { generateStructuredForTask } from "../ai/index.server";
import { NARRATIVE_FRAMEWORKS, type CommercialObjective } from "./constants";
import { getEligibleArchetypes } from "./archetypes.server";

interface Stage1Input {
  productTitle: string;
  productDescription: string | null;
  productType: string | null;
  price: number;
  inventoryQuantity: number;
  unitsSold30d: number;
  salesVelocity: number;
  daysSinceLastSale: number | null;
  objective: CommercialObjective;
}

// Saída do Estágio 1 — decisão estruturada, nunca texto de marketing.
// Campos batem com content_items.decision_brief documentado em ARCHITECTURE.md.
export function buildStage1Schema(objective: CommercialObjective) {
  const eligibleArchetypes = getEligibleArchetypes(objective);

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

export type Stage1Output = z.infer<ReturnType<typeof buildStage1Schema>>;

export async function decideContentBrief(
  input: Stage1Input,
): Promise<Stage1Output> {
  const eligibleArchetypes = getEligibleArchetypes(input.objective);
  const schema = buildStage1Schema(input.objective);

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

Commercial objective for this post: ${input.objective}

You MUST choose creativeArchetype from exactly this list (do not use any other value): ${eligibleArchetypes.join(", ")}.

Decide the full content strategy brief now.`;

  return generateStructuredForTask("decision_engine", schema, prompt);
}
