import { pickWeighted, weightedRandomPick, type RepertoireOption, type SceneDecision, type CategoryRepertoire } from "./repertoire.server";

// Repertório pra produtos fotografados SEM modelo nenhum (casa/decoração,
// eletrônico, beleza, móveis, comida, brinquedo, etc. — paradigm
// "standalone", ver productClassification.server.ts). PRIMEIRO RASCUNHO
// (14/09/2026), zero validação real — nenhum produto assim existe na
// Mangará hoje pra testar contra. Existe pra nenhuma loja fora de
// moda/calçado ficar sem NENHUMA imagem, não como regra final.
//
// Reaproveita a forma de SceneDecision/CategoryRepertoire já existente em
// vez de inventar tipos novos — os eixos só significam outra coisa aqui:
// "environment" = superfície/cenário onde o produto está apoiado, "action" =
// abordagem de styling (produto sozinho vs. com props vs. em uso), "framing"
// = ângulo de câmera. Isso também evita qualquer migração de banco: os
// mesmos campos requestedAction/Environment/Framing/Light de GenerationLog
// já servem pra este paradigma também.

const STANDALONE_SURFACES: (RepertoireOption & { setting: "indoor" | "outdoor" })[] = [
  {
    id: "neutral_studio_surface",
    setting: "indoor",
    promptText: "a clean, neutral studio surface (matte stone, plaster, or soft fabric) in a soft off-white or warm beige tone",
  },
  {
    id: "natural_wood_surface",
    setting: "indoor",
    promptText: "a warm natural wood surface, like an oak table or shelf, with soft ambient light",
  },
  {
    id: "styled_tabletop_scene",
    setting: "indoor",
    promptText: "a lightly styled tabletop scene — a linen cloth, a small plant, or a ceramic dish nearby, never crowded",
  },
];

const STANDALONE_STYLES: RepertoireOption[] = [
  {
    id: "minimal_single_object",
    baseWeight: 6, // regra: produto sozinho, sem nada competindo pela atenção
    promptText: "the product alone, with nothing else in frame competing for attention",
  },
  {
    id: "styled_with_props",
    promptText:
      "the product styled with one or two small, complementary objects nearby that support the product's use or mood without upstaging it",
  },
  {
    id: "in_use_context",
    promptText:
      "the product shown in a believable moment of real use or context (e.g. steam rising from a filled mug, a candle lit, a book open) without any person visible",
  },
];

const STANDALONE_ANGLES: RepertoireOption[] = [
  { id: "overhead_flat_lay", promptText: "a clean overhead flat-lay angle, directly from above" },
  { id: "three_quarter_angle", promptText: "a three-quarter angle, slightly above eye level, showing depth and dimension" },
  { id: "eye_level_close", promptText: "an eye-level close shot, filling most of the frame with the product" },
];

const STANDALONE_LIGHTS: (RepertoireOption & { setting: ("indoor" | "outdoor")[] })[] = [
  { id: "soft_studio_light", setting: ["indoor"], promptText: "soft, diffused studio-style light with gentle shadows" },
  { id: "warm_natural_light", setting: ["indoor"], promptText: "warm natural window light falling across the surface" },
];

async function selectStandaloneScene(shopId: string, _productTitle: string): Promise<SceneDecision> {
  const environment = await pickWeighted(shopId, "other", "observedEnvironment", STANDALONE_SURFACES);
  const action = await pickWeighted(shopId, "other", "observedAction", STANDALONE_STYLES);
  const framing = await pickWeighted(shopId, "other", "observedFraming", STANDALONE_ANGLES);
  const compatibleLights = STANDALONE_LIGHTS.filter((l) => l.setting.includes(environment.setting));
  const light = weightedRandomPick(compatibleLights.map((option) => ({ option, weight: 1 })));

  return { action, environment, framing, light, season: null };
}

const STANDALONE_PROMPT_RULES = `- This is a still-life product photograph — there is NO person, model, hand, or body part in frame anywhere. The product itself is the entire subject.
- The product is in sharp focus, fully visible, and clearly the hero of the frame — never partially cropped out or obscured by a prop.
- Strong, clean contrast between the product and the surface behind it, so its shape and color read clearly.
- Composition should feel like a real, considered product photograph — not cluttered, not staged-looking, not a busy scene.`;

export const genericStandaloneRepertoire: CategoryRepertoire = {
  id: "other",
  selectScene: selectStandaloneScene,
  promptRules: STANDALONE_PROMPT_RULES,
  sceneOptionIds: {
    actions: STANDALONE_STYLES.map((a) => a.id),
    environments: STANDALONE_SURFACES.map((e) => e.id),
    framings: STANDALONE_ANGLES.map((f) => f.id),
  },
};
