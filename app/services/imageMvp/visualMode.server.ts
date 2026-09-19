import type { CommercialObjective } from "../decisionEngine/constants";
import type { ProductInteraction } from "./productClassification.server";

// Segunda dimensão, ORTOGONAL à interação (ver productClassification.server.ts)
// — interação é um FATO sobre o produto (como ele pode ser mostrado), modo
// visual é uma ESCOLHA CRIATIVA (como a cena é tratada). A mesma interação
// ("held") pode virar uma foto Editorial ou uma Lifestyle; a mesma cena
// still-life pode ser o único jeito de mostrar um produto standalone.
// Conjunto reduzido em relação aos 8 modos do documento de estratégia
// (Product Hero / Lifestyle / In Use / Editorial / Styled Still Life /
// Detail-Macro / Flat Lay / Environment-Interior) — só os 4 que este
// pipeline já sabe produzir de verdade hoje; os demais entram quando
// houver repertório real pra sustentá-los, não antes.
export const VISUAL_MODES = ["product_hero", "lifestyle", "editorial", "styled_still_life"] as const;
export type VisualMode = (typeof VISUAL_MODES)[number];

// Bloco de prompt específico do MODO — inserido junto do bloco específico
// da CATEGORIA (ver CategoryRepertoire.promptRules), nunca no lugar dele.
export const VISUAL_MODE_GUIDANCE: Record<VisualMode, string> = {
  product_hero: `- Visual mode: PRODUCT HERO. Keep the composition clean and product-forward — minimal distraction, nothing in the scene competing with the product for attention. This is about clear, confident introduction of the product, not a lived-in moment.`,
  lifestyle: `- Visual mode: LIFESTYLE. The product appears in a real, believable everyday moment — the kind of situation the customer could picture herself in. Candid energy, not an obviously posed campaign shot.`,
  editorial: `- Visual mode: EDITORIAL. An aspirational, elevated campaign photograph — deliberate styling, a considered scene, the quality bar of a real fashion/lifestyle campaign rather than a candid moment.`,
  styled_still_life: `- Visual mode: STYLED STILL LIFE. A considered, editorial product photograph with no person in frame — see the category rules below for what "considered" means here.`,
};

// Compatibilidade modo × interação — "styled_still_life" SÓ existe sem
// modelo (é literalmente a definição do modo); os outros 3 pressupõem
// alguém vestindo/segurando/aplicando o produto, então não combinam com
// "standalone".
export function isModeCompatibleWithInteraction(mode: VisualMode, interaction: ProductInteraction): boolean {
  if (mode === "styled_still_life") return interaction === "standalone";
  return interaction !== "standalone";
}

// Preferência de modo por objetivo — hipótese de campanha inspirada na
// tabela do documento de estratégia (Patricia, 14/09/2026, seção
// "Campaign Intelligence": produto novo → Product Hero; estoque parado →
// Lifestyle aspiracional ou Editorial; bestseller → Lifestyle/In Use).
// Como este pipeline só tem 4 modos (não 8), "in use" e "lifestyle" se
// fundem no mesmo modo aqui. NÃO é regra fixa nem garantia de conversão —
// é o ponto de partida até existir dado real de desempenho por modo (ver
// o learning loop visual, ainda não construído).
const MODE_PREFERENCE_BY_OBJECTIVE: Record<CommercialObjective, VisualMode> = {
  awareness: "product_hero", // produto novo — apresentação limpa
  engagement: "lifestyle", // momento real e relatable
  traffic: "lifestyle",
  conversion: "lifestyle", // prova de uso real, não still genérico
  inventory: "editorial", // aspiracional, mantém o produto em destaque
};

// Prioridade fixa pra escolher a interação, dado o conjunto REAL válido do
// produto (Patricia, 14/09/2026: "o produto precisa admitir várias
// possibilidades... a campanha escolhe entre elas"). Prefere sempre mostrar
// o produto em uso de verdade (worn > held > applied) antes de cair pra
// standalone — sem variar por objetivo ainda, por falta de evidência real
// de que isso deveria mudar por objetivo (diferente do modo visual, que a
// tabela de referência acima já sustenta variar).
const INTERACTION_PRIORITY: ProductInteraction[] = ["worn", "held", "applied", "standalone"];

export interface SelectedVisualStrategy {
  interaction: ProductInteraction;
  mode: VisualMode;
}

// Ponto único de decisão: dado o objetivo comercial do post e o que É
// REALMENTE válido pra este produto (ver getOrClassifyProductVisuals),
// escolhe UMA interação e UM modo compatíveis entre si.
export function selectVisualStrategy(
  objective: CommercialObjective,
  validInteractions: ProductInteraction[],
): SelectedVisualStrategy {
  const interaction =
    INTERACTION_PRIORITY.find((candidate) => validInteractions.includes(candidate)) ??
    validInteractions[0] ??
    "standalone";

  const preferredMode = MODE_PREFERENCE_BY_OBJECTIVE[objective];
  const mode = isModeCompatibleWithInteraction(preferredMode, interaction)
    ? preferredMode
    : interaction === "standalone"
      ? "styled_still_life"
      : "product_hero"; // fallback universal, compatível com qualquer interação com modelo

  return { interaction, mode };
}
