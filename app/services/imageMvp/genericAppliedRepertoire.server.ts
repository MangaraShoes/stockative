import { pickWeighted, weightedRandomPick, type RepertoireOption, type SceneDecision, type CategoryRepertoire } from "./repertoire.server";

// Fallback pra interação "applied" (ver productClassification.server.ts) —
// produto sendo aplicado/usado ativamente (skincare, maquiagem, uma vela
// sendo acesa), distinto de só "held" (segurar sem usar). PRIMEIRO
// RASCUNHO, 14/09/2026, zero validação real — existe pra "applied" não
// cair sem repertório nenhum, o exemplo do próprio documento de estratégia
// era exatamente um sérum sendo aplicado.

const APPLIED_ACTIONS: RepertoireOption[] = [
  {
    id: "applying_with_hand",
    promptText:
      "a hand naturally applying or using the product in a close, believable gesture — a real, everyday motion, not a stiff or staged demonstration",
  },
];

const APPLIED_ENVIRONMENTS: (RepertoireOption & { setting: "indoor" | "outdoor" })[] = [
  {
    id: "bathroom_vanity",
    setting: "indoor",
    promptText: "a bright, clean bathroom vanity or counter with soft natural light",
  },
  {
    id: "interior_window_light",
    setting: "indoor",
    promptText: "a warm, airy sunlit interior with a large window and clean neutral surfaces",
  },
];

const APPLIED_FRAMINGS: RepertoireOption[] = [
  {
    id: "close_crop_application",
    promptText: "a close crop centered on the application itself, the product and the hand/skin interaction both clearly visible",
  },
];

const APPLIED_LIGHTS: (RepertoireOption & { setting: ("indoor" | "outdoor")[] })[] = [
  { id: "window_light_interior", setting: ["indoor"], promptText: "soft, warm natural window light" },
];

async function selectAppliedScene(shopId: string, _productTitle: string): Promise<SceneDecision> {
  const environment = await pickWeighted(shopId, "other", "observedEnvironment", APPLIED_ENVIRONMENTS);
  const action = await pickWeighted(shopId, "other", "observedAction", APPLIED_ACTIONS);
  const framing = await pickWeighted(shopId, "other", "observedFraming", APPLIED_FRAMINGS);
  const compatibleLights = APPLIED_LIGHTS.filter((l) => l.setting.includes(environment.setting));
  const light = weightedRandomPick(compatibleLights.map((option) => ({ option, weight: 1 })));

  return { action, environment, framing, light, season: null };
}

const APPLIED_PROMPT_RULES = `- The hand/skin interaction with the product must look anatomically real — a natural grip or gesture, a plausible number of fingers, nothing floating or warped.
- The product itself must remain identifiable and in focus even while shown in use — never so close or motion-blurred that its packaging/shape becomes unclear.`;

export const genericAppliedRepertoire: CategoryRepertoire = {
  id: "other",
  selectScene: selectAppliedScene,
  promptRules: APPLIED_PROMPT_RULES,
  sceneOptionIds: {
    actions: APPLIED_ACTIONS.map((a) => a.id),
    environments: APPLIED_ENVIRONMENTS.map((e) => e.id),
    framings: APPLIED_FRAMINGS.map((f) => f.id),
  },
};
