import {
  type CommercialObjective,
  type CreativeArchetype,
} from "./constants";

// Shortlist de arquétipos elegíveis por objetivo (regra v0, não aprendida —
// mesma limitação de cold start da Camada 3). O Estágio 1 escolhe DENTRO
// dessa lista, nunca livremente entre os 12 — ver "Como o Estágio 1 escolhe"
// em MARKETING-KNOWLEDGE.md.
const ELIGIBLE_ARCHETYPES_BY_OBJECTIVE: Record<
  CommercialObjective,
  CreativeArchetype[]
> = {
  awareness: ["lifestyle_aspiration", "founder_story", "newness"],
  engagement: ["behind_the_scenes", "founder_story", "educational", "ugc_style"],
  traffic: ["educational", "problem_solution", "social_proof", "newness"],
  conversion: ["product_benefit", "social_proof", "comparison", "objection_handling"],
  inventory: ["urgency", "comparison", "product_benefit", "lifestyle_aspiration"],
};

export function getEligibleArchetypes(
  objective: CommercialObjective,
): CreativeArchetype[] {
  return ELIGIBLE_ARCHETYPES_BY_OBJECTIVE[objective];
}

// Regra v0 pra inferir objetivo quando o merchant escolhe "Let AI decide" —
// baseada em regra, não aprendida (mesma lógica de cold start documentada).
export function inferObjective(params: {
  inventoryQuantity: number;
  salesVelocity: number | null;
  daysSinceCreated: number | null;
}): CommercialObjective {
  const { inventoryQuantity, salesVelocity, daysSinceCreated } = params;

  if (daysSinceCreated !== null && daysSinceCreated <= 14) {
    return "awareness"; // produto recém-lançado
  }

  if (inventoryQuantity > 20 && (salesVelocity ?? 0) < 0.3) {
    return "inventory"; // estoque alto, vendendo pouco
  }

  return "engagement"; // fallback seguro quando não há sinal forte
}
