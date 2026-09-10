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

// Sinais reais que sustentam cada arquétipo (Patricia, 10/09/2026, depois de
// ver "Behind the Scenes" inventar um artesão tecendo o produto à mão sem
// nenhuma fonte real por trás — ver MARKETING-KNOWLEDGE.md seção 4 "Regras
// de evidência e alegações permitidas"). Um arquétipo só entra no shortlist
// elegível quando o dado que o sustenta existe de verdade; não é o texto do
// prompt sozinho que garante isso, é a lista de opções em si.
export interface ArchetypeEvidence {
  hasFounderFact: boolean; // Brand Voice preenchido — única fonte real de história de fundadora
  hasVerifiableSales: boolean; // unitsSold30d > 0 — número real, citável
  isLowStock: boolean; // escassez real (não "estoque parado", que é o oposto)
  isRecentProduct: boolean; // dentro da janela de recência real
}

const ARCHETYPE_EVIDENCE_REQUIREMENT: Partial<
  Record<CreativeArchetype, keyof ArchetypeEvidence>
> = {
  founder_story: "hasFounderFact",
  social_proof: "hasVerifiableSales",
  urgency: "isLowStock",
  newness: "isRecentProduct",
};

export function getEligibleArchetypes(
  objective: CommercialObjective,
  evidence: ArchetypeEvidence,
): CreativeArchetype[] {
  const base = ELIGIBLE_ARCHETYPES_BY_OBJECTIVE[objective];
  const filtered = base.filter((archetype) => {
    const requirementKey = ARCHETYPE_EVIDENCE_REQUIREMENT[archetype];
    return requirementKey === undefined || evidence[requirementKey];
  });

  // Nunca fica vazio: product_benefit exige só um atributo real do produto,
  // sempre disponível via o próprio cadastro (ver MARKETING-KNOWLEDGE.md
  // seção 4) — fallback de segurança, não deveria disparar na prática com a
  // tabela atual (todo objetivo tem pelo menos um arquétipo sem requisito).
  return filtered.length > 0 ? filtered : ["product_benefit"];
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
