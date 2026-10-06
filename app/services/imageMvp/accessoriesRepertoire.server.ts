import {
  pickWeighted,
  weightedRandomPick,
  type CategoryRepertoire,
  type RepertoireOption,
  type SceneDecision,
  type SelectSceneOptions,
} from "./repertoire.server";
import type { VisualCategory } from "./productClassification.server";

// Repertório de bolsas, joias e acessórios (Patricia, 06/10/2026: "só
// calçado e roupa têm repertório próprio... bolsas, joias e acessórios
// caem no genérico" → "sim quero"). Antes eles caíam no genérico (2 ações,
// 2 ambientes, 1 enquadramento): imagens repetitivas e nada pensadas pro
// produto.
//
// Acessório não é uma coisa só: um colar se vende no colo, um brinco perto
// do rosto, um anel nas mãos, uma bolsa no ombro ou na mão com o look
// inteiro. O TIPO sai do nome do produto (palavras em EN/FR/NL/PT/DE, as
// línguas das lojas do nicho europeu) e decide pose e enquadramento; o
// ambiente e a luz são comuns a todos. Sem tipo reconhecido → pose e
// enquadramento genéricos que ainda põem o produto em destaque.
//
// PRIMEIRO RASCUNHO — mesmo status do repertório de roupa: sem rodada de
// correção ao vivo com lojista do nicho ainda. Cada erro real numa geração
// deve virar correção permanente aqui, como foi com calçado.

type AccessoryKind = "bag" | "neck" | "ear" | "hand" | "eyewear" | "hat" | "scarf" | "belt" | "other";

const KIND_PATTERNS: [AccessoryKind, RegExp][] = [
  ["bag", /(?<!\p{L})(bag|handbag|tote|clutch|purse|backpack|crossbody|shopper|tas|handtas|sac|pochette|cabas|bolsa|mala|tasche|handtasche)(?!\p{L})/iu],
  ["ear", /(?<!\p{L})(earrings?|ear cuffs?|studs|hoops|oorbellen|oorbel|boucles? d'oreilles?|brincos?|argolas?|ohrringe?|creolen)(?!\p{L})/iu],
  ["neck", /(?<!\p{L})(necklace|pendant|choker|chain|collier|sautoir|pendentif|ketting|hanger|colar|gargantilha|pingente|halskette|kette|anhänger)(?!\p{L})/iu],
  ["hand", /(?<!\p{L})(ring|rings|bracelet|bangle|cuff|watch|armband|horloge|bague|montre|pulseira|anel|relógio|uhr)(?!\p{L})/iu],
  ["eyewear", /(?<!\p{L})(sunglasses|glasses|eyewear|zonnebril|bril|lunettes|óculos|sonnenbrille|brille)(?!\p{L})/iu],
  ["hat", /(?<!\p{L})(hat|cap|beanie|beret|hoed|pet|muts|chapeau|bonnet|béret|chapéu|boné|gorro|hut|mütze)(?!\p{L})/iu],
  ["scarf", /(?<!\p{L})(scarf|shawl|stole|sjaal|omslagdoek|foulard|écharpe|étole|lenço|cachecol|xale|schal|tuch)(?!\p{L})/iu],
  ["belt", /(?<!\p{L})(belt|riem|ceinture|cinto|gürtel)(?!\p{L})/iu],
];

export function detectAccessoryKind(productTitle: string): AccessoryKind {
  return KIND_PATTERNS.find(([, pattern]) => pattern.test(productTitle))?.[0] ?? "other";
}

interface KindScene {
  actions: RepertoireOption[];
  framings: RepertoireOption[];
}

const KIND_SCENES: Record<AccessoryKind, KindScene> = {
  bag: {
    actions: [
      { id: "bag_on_shoulder_walking", promptText: "walking naturally with the bag carried on the shoulder, arm relaxed, the bag hanging at hip height and facing the camera" },
      { id: "bag_in_hand_standing", promptText: "standing in a relaxed pose holding the bag by its handle at the side, the bag's front and shape fully visible" },
      { id: "bag_on_lap_seated", promptText: "seated with the bag resting on the lap or on the seat beside them, one hand lightly on it, front of the bag toward the camera" },
    ],
    framings: [
      { id: "bag_three_quarter", promptText: "a three-quarter length shot where the bag sits near the center of the frame, large and sharp, with the outfit around it" },
      { id: "bag_waist_level_close", promptText: "a closer shot framed from the chest to mid-thigh, so the bag fills a real share of the frame while the torso stays in view" },
    ],
  },
  neck: {
    actions: [
      { id: "neck_gaze_away", promptText: "standing or seated in a calm, upright pose, head turned slightly away from the camera so the neckline and the piece are open to the light" },
      { id: "neck_hand_at_collarbone", promptText: "one hand resting lightly near the collarbone, not covering the piece, a soft natural gesture" },
    ],
    framings: [
      { id: "neck_bust_close", promptText: "a close shot from the chin to just below the chest, the necklace centered and sharp on an open neckline (a plain, open collar or bare neckline that never hides the piece)" },
      { id: "neck_portrait", promptText: "a head-and-shoulders portrait with the necklace clearly visible and in sharp focus on an open neckline" },
    ],
  },
  ear: {
    actions: [
      { id: "ear_profile_turn", promptText: "head turned to a three-quarter profile, hair tucked behind the ear or pulled back so the earring is fully visible" },
      { id: "ear_hand_in_hair", promptText: "one hand gently brushing the hair back from the face, revealing the earring, a soft natural gesture" },
    ],
    framings: [
      { id: "ear_face_close", promptText: "a close portrait of the face and neck where the earring is sharp and clearly visible — the ear is never covered by hair" },
    ],
  },
  hand: {
    actions: [
      { id: "hand_holding_cup", promptText: "hands relaxed around a simple ceramic cup on a table, the piece on the wrist or finger facing the camera" },
      { id: "hand_at_face", promptText: "one hand resting lightly near the jaw or chin, the piece on the wrist or finger clearly visible" },
      { id: "hand_on_knee_seated", promptText: "seated, hands resting naturally one over the other on the knee, the piece turned toward the camera" },
    ],
    framings: [
      { id: "hand_close", promptText: "a close shot of the hands and forearms where the piece is large and sharp, with part of the outfit and torso in soft focus behind" },
      { id: "hand_mid", promptText: "a mid-shot from the shoulders to the hands, the hand with the piece placed in the foreground" },
    ],
  },
  eyewear: {
    actions: [
      { id: "eyewear_looking_away", promptText: "wearing the glasses, face turned slightly away from the camera with a relaxed, confident expression" },
      { id: "eyewear_adjusting", promptText: "one hand lightly touching the temple of the glasses, a natural gesture" },
    ],
    framings: [
      { id: "eyewear_portrait", promptText: "a head-and-shoulders portrait with the frames sharp, their shape and color clearly visible, no glare hiding the lenses" },
    ],
  },
  hat: {
    actions: [
      { id: "hat_walking", promptText: "walking naturally wearing the hat, face partly lifted toward the light" },
      { id: "hat_hand_on_brim", promptText: "standing, one hand lightly on the brim or crown, a relaxed natural gesture" },
    ],
    framings: [
      { id: "hat_portrait", promptText: "a portrait from the chest up, the whole hat in frame and sharp, never cropped at the top" },
    ],
  },
  scarf: {
    actions: [
      { id: "scarf_draped", promptText: "standing with the scarf draped or loosely knotted around the neck and shoulders, its pattern and fabric falling naturally" },
      { id: "scarf_walking", promptText: "walking naturally, the scarf moving slightly with the motion" },
    ],
    framings: [
      { id: "scarf_waist_up", promptText: "a waist-up shot where the scarf is large and its pattern, color and texture read clearly" },
    ],
  },
  belt: {
    actions: [
      { id: "belt_standing_hand_hip", promptText: "standing in a relaxed pose, one hand near the hip, never covering the buckle" },
      { id: "belt_walking", promptText: "walking naturally, the belt and buckle facing the camera" },
    ],
    framings: [
      { id: "belt_midsection", promptText: "a shot framed from the chest to the knee, so the belt and buckle sit near the center and are large and sharp" },
    ],
  },
  other: {
    actions: [
      { id: "accessory_natural_use", promptText: "wearing or using the accessory in a natural, relaxed way, turned toward the camera" },
    ],
    framings: [
      { id: "accessory_close_mid", promptText: "a mid-shot close enough that the accessory is large, sharp and clearly the hero of the frame" },
    ],
  },
};

interface AccessoryEnvironment extends RepertoireOption {
  setting: "indoor" | "outdoor";
}

// Ambientes calmos e de fundo limpo — acessório é pequeno, qualquer fundo
// carregado o engole (ver o "simple scene" do padrão de foto).
const ACCESSORY_ENVIRONMENTS: AccessoryEnvironment[] = [
  { id: "interior_window_light", setting: "indoor", promptText: "a calm, airy interior with a large window, light plain walls and one piece of furniture" },
  { id: "cafe_table", setting: "indoor", promptText: "a quiet, elegant café corner with a small marble table and light walls" },
  { id: "urban_street", setting: "outdoor", promptText: "a quiet European street with light stone facades and a touch of greenery" },
  { id: "garden_courtyard", setting: "outdoor", promptText: "a calm garden courtyard with light stone, soft greenery and open sky" },
];

interface AccessoryLight extends RepertoireOption {
  setting: ("indoor" | "outdoor")[];
}

const ACCESSORY_LIGHTS: AccessoryLight[] = [
  { id: "window_light_interior", setting: ["indoor"], promptText: "soft, warm natural window light from one side" },
  { id: "warm_lamp_light", setting: ["indoor"], promptText: "soft, warm lamp light from one side" },
  { id: "golden_hour_warm", setting: ["outdoor"], promptText: "warm, soft golden-hour sunlight" },
  { id: "bright_warm_daylight", setting: ["outdoor"], promptText: "bright, warm daylight with soft shadows" },
];

function makeSelectScene(category: VisualCategory) {
  return async function selectAccessoryScene(
    shopId: string,
    productTitle: string,
    options: SelectSceneOptions = {},
  ): Promise<SceneDecision> {
    const scene = KIND_SCENES[detectAccessoryKind(productTitle)];
    // Regeneração: nunca o mesmo ambiente da imagem rejeitada, enquanto
    // houver outro (mesma regra do calçado).
    const fresh = ACCESSORY_ENVIRONMENTS.filter((e) => !options.excludeEnvironmentIds?.includes(e.id));
    const environment = await pickWeighted(
      shopId,
      category,
      "observedEnvironment",
      fresh.length > 0 ? fresh : ACCESSORY_ENVIRONMENTS,
    );
    const action = await pickWeighted(shopId, category, "observedAction", scene.actions);
    const framing = await pickWeighted(shopId, category, "observedFraming", scene.framings);
    const light = weightedRandomPick(
      ACCESSORY_LIGHTS.filter((l) => l.setting.includes(environment.setting)).map((option) => ({ option, weight: 1 })),
    );
    return { action, environment, framing, light, season: null };
  };
}

const ACCESSORY_PROMPT_RULES = `- The accessory is the hero even though it is small: it sits where the eye lands first, large enough in the frame to show its shape, finish and details, in sharp focus — never a tiny detail lost in a wide shot.
- Real-world scale: the piece keeps its true size relative to the body — never enlarged or shrunk to fill the frame.
- Exact finish: metal tone (gold, silver, rose gold), stones, leather grain, hardware, clasps, chains, stitching and any logo stay exactly as in the reference — never swapped, added or simplified.
- Nothing covers it: no hair, sleeve, collar, hand or strap in front of the piece. Any other jewelry or accessory in frame is minimal and plain, so it never competes with the product.
- Skin and hands near the piece look natural and well cared for — relaxed fingers, a plausible number of them, neutral nails.`;

const ALL_ACTION_IDS = Object.values(KIND_SCENES).flatMap((scene) => scene.actions.map((a) => a.id));
const ALL_FRAMING_IDS = Object.values(KIND_SCENES).flatMap((scene) => scene.framings.map((f) => f.id));

function buildRepertoire(category: VisualCategory): CategoryRepertoire {
  return {
    id: category,
    selectScene: makeSelectScene(category),
    promptRules: ACCESSORY_PROMPT_RULES,
    sceneOptionIds: {
      actions: ALL_ACTION_IDS,
      environments: ACCESSORY_ENVIRONMENTS.map((e) => e.id),
      framings: ALL_FRAMING_IDS,
    },
  };
}

export const bagsAccessoriesRepertoire = buildRepertoire("bags_accessories");
export const jewelryRepertoire = buildRepertoire("jewelry");
