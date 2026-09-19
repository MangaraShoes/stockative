import { pickWeighted, weightedRandomPick, type RepertoireOption, type SceneDecision, type CategoryRepertoire } from "./repertoire.server";

// PRIMEIRO RASCUNHO (14/09/2026) — ao contrário do repertório de calçado,
// isto NÃO passou por rodadas de correção ao vivo com um lojista real de
// vestuário ainda. É um ponto de partida razoável baseado no princípio que
// motivou a criação disto (Patricia: "se for vender vestidos o melhor é a
// posição em pé... o sapato precisa estar sentado, o vestido precisa estar
// em pé pra mostrar o caimento") — não uma regra validada como a de calçado.
// Cada erro real que aparecer numa geração de vestuário deve virar uma
// correção permanente aqui, do mesmo jeito que aconteceu com calçado.

interface ApparelAction extends RepertoireOption {
  motion: boolean;
}

// Em pé é a REGRA aqui (inverso do calçado) — mostra caimento, silhueta e
// movimento do tecido, que é o que vende uma peça de vestuário. Sentada vira
// a exceção ocasional, não o padrão.
const APPAREL_ACTIONS: ApparelAction[] = [
  {
    id: "standing_full_length",
    motion: false,
    baseWeight: 6,
    promptText:
      "standing tall in a relaxed, natural full-length pose, weight settled on one leg, the garment's silhouette and drape clearly visible from shoulder to hem",
  },
  {
    id: "walking_motion",
    motion: true,
    baseWeight: 3,
    promptText:
      "captured mid-stride, walking naturally so the fabric shows real movement and drape, not stiff or static",
  },
  {
    id: "turning_three_quarter",
    motion: false,
    promptText: "turned slightly to a three-quarter angle, one shoulder toward camera, showing how the garment moves with the body",
  },
  {
    id: "seated_relaxed",
    motion: false,
    promptText: "seated in a relaxed, natural pose, the garment's shape still clearly visible and not bunched or hidden by the seated position",
  },
];

interface ApparelEnvironment extends RepertoireOption {
  setting: "indoor" | "outdoor";
}

// Vocabulário menor e mais neutro que o de calçado de propósito — ainda não
// passou pela mesma validação real, então evita especificidade demais (tipo
// as cenas de praia/resort do calçado) até haver evidência de que funciona
// pra vestuário também.
const APPAREL_ENVIRONMENTS: ApparelEnvironment[] = [
  {
    id: "urban_street",
    setting: "outdoor",
    promptText:
      "a quiet European street with classic architecture, bathed in warm sunlight, a tree or window boxes with greenery visible in frame",
  },
  {
    id: "garden_courtyard",
    setting: "outdoor",
    promptText: "a classic garden courtyard in full warm sunlight, trimmed hedges, greenery, stone paving",
  },
  {
    id: "interior_window_light",
    setting: "indoor",
    promptText: "a warm, airy sunlit interior with a large window, minimal furniture, clean neutral walls",
  },
];

interface ApparelFraming extends RepertoireOption {
  compatibleWith: "any" | "motion";
}

// Full-body ou três-quartos, NUNCA um corte apertado tipo o de calçado — um
// corte na altura do joelho esconderia justamente o que vende a peça (o
// caimento inteiro).
const APPAREL_FRAMINGS: ApparelFraming[] = [
  {
    id: "full_body",
    compatibleWith: "any",
    promptText:
      "a full-body shot from head to at least mid-calf, showing the garment's complete silhouette and drape",
  },
  {
    id: "three_quarter_length",
    compatibleWith: "any",
    promptText: "a three-quarter length shot from roughly the knee up, showing the garment's fit through the torso and how it falls",
  },
  {
    id: "walking_motion_crop",
    compatibleWith: "motion",
    promptText: "a full-body crop that captures the garment's fabric in motion mid-stride, never cropped so tight that the hem is cut off",
  },
];

interface ApparelLight extends RepertoireOption {
  setting: ("indoor" | "outdoor")[];
}

const APPAREL_LIGHTS: ApparelLight[] = [
  { id: "golden_hour_warm", setting: ["outdoor"], promptText: "warm, soft golden-hour sunlight" },
  { id: "bright_warm_daylight", setting: ["outdoor"], promptText: "bright, warm daylight with soft shadows" },
  { id: "window_light_interior", setting: ["indoor"], promptText: "soft, warm natural window light" },
];

async function selectApparelScene(shopId: string, _productTitle: string): Promise<SceneDecision> {
  const environment = await pickWeighted(shopId, "apparel", "observedEnvironment", APPAREL_ENVIRONMENTS);
  const action = await pickWeighted(shopId, "apparel", "observedAction", APPAREL_ACTIONS);
  const compatibleFramings = APPAREL_FRAMINGS.filter(
    (f) => f.compatibleWith === "any" || (f.compatibleWith === "motion" && action.motion),
  );
  const framing = await pickWeighted(shopId, "apparel", "observedFraming", compatibleFramings);
  const compatibleLights = APPAREL_LIGHTS.filter((l) => l.setting.includes(environment.setting));
  const light = weightedRandomPick(compatibleLights.map((option) => ({ option, weight: 1 })));

  return { action, environment, framing, light, season: null };
}

const APPAREL_PROMPT_RULES = `- The garment is the clear hero: its silhouette, drape, and how the fabric falls must be fully visible, not obscured by an unnatural pose, cropped-off hem, or bulky layering on top of it. Show the complete length of the piece (dress, skirt, trousers) whenever the framing allows.
- The fabric should read as having real weight and movement — never stiff, flat, or mannequin-like.`;

export const apparelRepertoire: CategoryRepertoire = {
  id: "apparel",
  selectScene: selectApparelScene,
  promptRules: APPAREL_PROMPT_RULES,
  sceneOptionIds: {
    actions: APPAREL_ACTIONS.map((a) => a.id),
    environments: APPAREL_ENVIRONMENTS.map((e) => e.id),
    framings: APPAREL_FRAMINGS.map((f) => f.id),
  },
};
