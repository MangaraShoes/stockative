import type { VisualCategory } from "./productClassification.server";

// Antecipado (Patricia, 14/09/2026: "eu anteciparia as restrições
// estruturadas de fidelidade... quanto mais liberdade para posicionar,
// vestir ou usar um produto, maior a necessidade de deixar explícito o que
// deve ser preservado") — versão mínima de propósito, não uma arquitetura
// grande: uma lista curta de "preservar" e "nunca" por categoria, que
// entra tanto no prompt de geração quanto no prompt da checagem de
// fidelidade, e fica gravada em GenerationLog.fidelityConstraints pra
// auditoria. IMPORTANTE: isto orienta o que checar — a checagem de IA
// AJUDA a avaliar fidelidade, não a garante (ver checkImageFidelity).
export interface FidelityConstraints {
  preserve: string[];
  neverAlter: string[];
}

// 03/10/2026 (Patricia, depois de uma regeneração em que uma bota khaki/taupe
// voltou verde-oliva: "strict rule never change the color of the original
// product or any characteristic from the original item we are selling") —
// cor ganhou regra própria e explícita, incluindo desvio SUTIL de tom e o
// álibi da luz da cena, que era exatamente o que deixava passar.
const UNIVERSAL_CONSTRAINTS: FidelityConstraints = {
  preserve: [
    "exact shape and proportions",
    "the exact color — same hue, undertone, saturation and lightness as the reference",
    "material and surface finish (matte/glossy, texture, grain)",
    "any visible logo, label, or branding exactly as shown",
    "all components specific to this variant (stitching, seams, zips, buckles, hardware, toe and heel shape)",
  ],
  neverAlter: [
    "do not stretch, deform, or change the product's scale in a way that misrepresents it",
    "do not shift the product's color in any way, not even subtly — e.g. khaki/taupe turning olive or green, beige turning grey or yellow, black turning brown, cream turning white. The scene's lighting, color grade or mood must never change how the product's color reads; the product must look like the same color it is in the reference",
    "do not change the product's real material or finish, or invent an attribute not visible in the reference",
    "do not cover, crop out, or replace the logo/label/branding",
    "do not add straps, parts, or accessories that aren't part of the actual product",
    "do not remove, simplify or restyle any characteristic of the product — every detail visible in the reference stays exactly as it is",
  ],
};

// Adições por categoria — só pra calçado por enquanto (a categoria com
// evidência real de onde a fidelidade falhava, ver histórico do salto
// descolado). As demais herdam só o universal até haver o mesmo tipo de
// evidência.
const CATEGORY_ADDITIONS: Partial<Record<VisualCategory, FidelityConstraints>> = {
  footwear: {
    preserve: ["heel shape and how it connects to the sole", "sole shape and thickness"],
    neverAlter: ["do not render the heel as detached or floating away from the sole"],
  },
  apparel: {
    preserve: ["hemline length and silhouette", "neckline and closure details"],
    neverAlter: [],
  },
};

export function getFidelityConstraints(category: VisualCategory): FidelityConstraints {
  const addition = CATEGORY_ADDITIONS[category];
  if (!addition) return UNIVERSAL_CONSTRAINTS;
  return {
    preserve: [...UNIVERSAL_CONSTRAINTS.preserve, ...addition.preserve],
    neverAlter: [...UNIVERSAL_CONSTRAINTS.neverAlter, ...addition.neverAlter],
  };
}

export function describeFidelityConstraints(constraints: FidelityConstraints): string {
  return [
    `Preserve exactly: ${constraints.preserve.join("; ")}.`,
    ...constraints.neverAlter.map((rule) => `Never: ${rule}.`),
  ].join("\n");
}
