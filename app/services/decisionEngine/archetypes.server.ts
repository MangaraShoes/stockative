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
  // urgency entrou aqui em 13/09/2026 — MARKETING-KNOWLEDGE.md já documentava
  // Urgency como objetivo típico "Conversion" (e só secundariamente
  // "Inventory"), mas a lista aqui só liberava pra inventory. Ficou
  // inconsistente até a Promotion (ver archetypes abaixo) precisar dele em
  // posts de "conversion" de verdade.
  conversion: ["product_benefit", "social_proof", "comparison", "objection_handling", "urgency"],
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
  // Promoção real declarada pela lojista, com desconto e prazo (ver model
  // Promotion) — Patricia, 13/09/2026, MARKETING-KNOWLEDGE.md seção 4: "Se a
  // intenção comercial for de fato escoar estoque, a ação correta é o
  // lojista criar uma promoção real (com prazo). Só então Urgency fica
  // elegível de novo, com evidência." Antes disso não existia NENHUMA fonte
  // de evidência pra Urgency além de estoque baixo.
  hasActivePromotion: boolean;
}

// Cada arquétipo pode aceitar mais de uma fonte de evidência (OR, não AND) —
// Urgency é legítimo com escassez real OU promoção real com prazo, nunca
// precisa das duas ao mesmo tempo.
const ARCHETYPE_EVIDENCE_REQUIREMENT: Partial<
  Record<CreativeArchetype, (keyof ArchetypeEvidence)[]>
> = {
  founder_story: ["hasFounderFact"],
  social_proof: ["hasVerifiableSales"],
  urgency: ["isLowStock", "hasActivePromotion"],
  newness: ["isRecentProduct"],
};

export function getEligibleArchetypes(
  objective: CommercialObjective,
  evidence: ArchetypeEvidence,
): CreativeArchetype[] {
  const base = ELIGIBLE_ARCHETYPES_BY_OBJECTIVE[objective];
  const filtered = base.filter((archetype) => {
    const requirementKeys = ARCHETYPE_EVIDENCE_REQUIREMENT[archetype];
    return requirementKeys === undefined || requirementKeys.some((key) => evidence[key]);
  });

  // Nunca fica vazio: product_benefit exige só um atributo real do produto,
  // sempre disponível via o próprio cadastro (ver MARKETING-KNOWLEDGE.md
  // seção 4) — fallback de segurança, não deveria disparar na prática com a
  // tabela atual (todo objetivo tem pelo menos um arquétipo sem requisito).
  return filtered.length > 0 ? filtered : ["product_benefit"];
}

// Quanto tempo o estoque atual dura no ritmo de venda de hoje, e quanto
// dinheiro está parado nele — Product Opportunity Score (Patricia,
// 13/09/2026, depois de revisar o Growth & Creative Intelligence Roadmap):
// "estoque alto e vendas baixas, isoladamente, não justificam promoção" só
// vira sinal confiável quando comparado à cobertura real, não a um limiar
// fixo de unidades. O limiar antigo (inventoryQuantity > 20 && salesVelocity
// < 0.3) tratava um produto de €30 com 21 unidades igual a um de €300 com
// 21 unidades — o segundo tem 10x mais capital parado e merece prioridade
// maior, não a mesma.
export interface SlowMoverSignal {
  isSlowMover: boolean;
  daysOfCover: number | null; // null = zero venda no período, cobertura efetivamente infinita
  tiedUpCapital: number; // inventoryQuantity * price — quanto valor está parado, não só quantas unidades
}

const SLOW_MOVER_COVERAGE_DAYS = 60; // mais de 60 dias de estoque no ritmo atual = parado

export function computeSlowMoverSignal(params: {
  inventoryQuantity: number;
  salesVelocity: number | null; // unidades/dia, ver computeCommerceSignals.server.ts
  price: number;
}): SlowMoverSignal {
  const velocity = params.salesVelocity ?? 0;
  const daysOfCover = velocity > 0 ? params.inventoryQuantity / velocity : null;
  const isSlowMover =
    params.inventoryQuantity > 0 && (daysOfCover === null || daysOfCover > SLOW_MOVER_COVERAGE_DAYS);
  return {
    isSlowMover,
    daysOfCover,
    tiedUpCapital: params.inventoryQuantity * params.price,
  };
}

// Regra v0 pra inferir objetivo quando o merchant escolhe "Let AI decide" —
// baseada em regra, não aprendida (mesma lógica de cold start documentada).
export function inferObjective(params: {
  inventoryQuantity: number;
  salesVelocity: number | null;
  daysSinceCreated: number | null;
  price: number;
}): CommercialObjective {
  const { inventoryQuantity, salesVelocity, daysSinceCreated, price } = params;

  if (daysSinceCreated !== null && daysSinceCreated <= 14) {
    return "awareness"; // produto recém-lançado
  }

  if (computeSlowMoverSignal({ inventoryQuantity, salesVelocity, price }).isSlowMover) {
    return "inventory"; // estoque parado de verdade, por cobertura real, não limiar fixo de unidades
  }

  return "engagement"; // fallback seguro quando não há sinal forte
}
