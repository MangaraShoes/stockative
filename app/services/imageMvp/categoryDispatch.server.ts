import type { VisualCategory, ProductInteraction } from "./productClassification.server";
import { footwearRepertoire, type CategoryRepertoire } from "./repertoire.server";
import { apparelRepertoire } from "./apparelRepertoire.server";
import { genericWornRepertoire } from "./genericWornRepertoire.server";
import { genericAppliedRepertoire } from "./genericAppliedRepertoire.server";
import { genericStandaloneRepertoire } from "./standaloneRepertoire.server";

// Ponto único de despacho — por CATEGORIA e por INTERAÇÃO, já que as duas
// são dimensões separadas (Patricia, 14/09/2026: "held descreve como
// alguém interage com o produto... separar essas dimensões evita trocar
// uma classificação rígida por outra"). Um repertório dedicado só existe
// pra uma categoria QUANDO a interação combina com ele — calçado dedicado
// é sempre "worn" (é a única interação validada de verdade pra ele até
// hoje); pedir "standalone" pra um sapato cai no genérico, nunca inventa um
// repertório de still-life de calçado que não existe.
const WORN_REPERTOIRES: Partial<Record<VisualCategory, CategoryRepertoire>> = {
  footwear: footwearRepertoire,
  apparel: apparelRepertoire,
};

export function getRepertoireForInteraction(
  category: VisualCategory,
  interaction: ProductInteraction,
): CategoryRepertoire {
  if (interaction === "standalone") return genericStandaloneRepertoire;
  if (interaction === "applied") return genericAppliedRepertoire;
  if (interaction === "worn") return WORN_REPERTOIRES[category] ?? genericWornRepertoire;
  return genericWornRepertoire; // held, ou worn sem repertório dedicado
}
