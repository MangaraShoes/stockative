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

const UNIVERSAL_CONSTRAINTS: FidelityConstraints = {
  preserve: ["exact shape and proportions", "color, material, and surface finish", "any visible logo, label, or branding exactly as shown", "all components specific to this variant"],
  neverAlter: [
    "do not stretch, deform, or change the product's scale in a way that misrepresents it",
    "do not change the product's real color, material, or finish, or invent an attribute not visible in the reference",
    "do not cover, crop out, or replace the logo/label/branding",
    "do not add straps, parts, or accessories that aren't part of the actual product",
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
