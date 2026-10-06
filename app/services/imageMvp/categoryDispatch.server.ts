import type { VisualCategory, ProductInteraction } from "./productClassification.server";
import { footwearRepertoire, type CategoryRepertoire } from "./repertoire.server";
import { apparelRepertoire } from "./apparelRepertoire.server";
import { genericWornRepertoire } from "./genericWornRepertoire.server";
import { bagsAccessoriesRepertoire, jewelryRepertoire } from "./accessoriesRepertoire.server";
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
  bags_accessories: bagsAccessoriesRepertoire,
  jewelry: jewelryRepertoire,
};

// Bolsa e joia também são "segurados" (bolsa na mão, anel na mão) — o
// repertório de acessórios cobre os dois casos (06/10/2026).
const HELD_REPERTOIRES: Partial<Record<VisualCategory, CategoryRepertoire>> = {
  bags_accessories: bagsAccessoriesRepertoire,
  jewelry: jewelryRepertoire,
};

export function getRepertoireForInteraction(
  category: VisualCategory,
  interaction: ProductInteraction,
): CategoryRepertoire {
  if (interaction === "standalone") return genericStandaloneRepertoire;
  if (interaction === "applied") return genericAppliedRepertoire;
  if (interaction === "worn") return WORN_REPERTOIRES[category] ?? genericWornRepertoire;
  if (interaction === "held") return HELD_REPERTOIRES[category] ?? genericWornRepertoire;
  return genericWornRepertoire;
}
