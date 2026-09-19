import { pickWeighted, weightedRandomPick, type RepertoireOption, type SceneDecision, type CategoryRepertoire } from "./repertoire.server";

// Fallback pra qualquer categoria "worn"/"handheld" (ver
// productClassification.server.ts) sem repertório dedicado ainda — jóia,
// bolsa, beleza usada no corpo, etc. Deliberadamente neutro e conservador:
// nenhuma categoria tem repertório próprio até acumular evidência real (o
// mesmo processo que validou o de calçado), então isto existe pra nunca
// deixar uma categoria nova sem imagem nenhuma, não pra ser a versão final
// de repertório de ninguém.

const GENERIC_ACTIONS: RepertoireOption[] = [
  {
    id: "standing_natural",
    promptText: "standing in a relaxed, natural pose, the product clearly visible and well presented",
  },
  {
    id: "interacting_with_product",
    promptText:
      "naturally holding, wearing, or interacting with the product in a way that shows it clearly and believably",
  },
];

const GENERIC_ENVIRONMENTS: (RepertoireOption & { setting: "indoor" | "outdoor" })[] = [
  {
    id: "urban_street",
    setting: "outdoor",
    promptText: "a quiet European street with classic architecture, bathed in warm sunlight",
  },
  {
    id: "interior_window_light",
    setting: "indoor",
    promptText: "a warm, airy sunlit interior with a large window and clean neutral walls",
  },
];

const GENERIC_FRAMINGS: RepertoireOption[] = [
  { id: "mid_shot", promptText: "a mid-shot that keeps the product as the clear focal point" },
];

const GENERIC_LIGHTS: (RepertoireOption & { setting: ("indoor" | "outdoor")[] })[] = [
  { id: "golden_hour_warm", setting: ["outdoor"], promptText: "warm, soft golden-hour sunlight" },
  { id: "window_light_interior", setting: ["indoor"], promptText: "soft, warm natural window light" },
];

async function selectGenericWornScene(shopId: string, _productTitle: string): Promise<SceneDecision> {
  const environment = await pickWeighted(shopId, "other", "observedEnvironment", GENERIC_ENVIRONMENTS);
  const action = await pickWeighted(shopId, "other", "observedAction", GENERIC_ACTIONS);
  const framing = await pickWeighted(shopId, "other", "observedFraming", GENERIC_FRAMINGS);
  const compatibleLights = GENERIC_LIGHTS.filter((l) => l.setting.includes(environment.setting));
  const light = weightedRandomPick(compatibleLights.map((option) => ({ option, weight: 1 })));

  return { action, environment, framing, light, season: null };
}

const GENERIC_PROMPT_RULES = `- The product must remain the unmistakable hero of the composition — fully visible, well-lit, not a small or incidental detail.`;

export const genericWornRepertoire: CategoryRepertoire = {
  id: "other",
  selectScene: selectGenericWornScene,
  promptRules: GENERIC_PROMPT_RULES,
  sceneOptionIds: {
    actions: GENERIC_ACTIONS.map((a) => a.id),
    environments: GENERIC_ENVIRONMENTS.map((e) => e.id),
    framings: GENERIC_FRAMINGS.map((f) => f.id),
  },
};
