import prisma from "../../db.server";
import type { VisualCategory } from "./productClassification.server";

// Piloto do "Creative System" (Patricia, 12/09/2026) — repertório modular
// por eixo (ação / ambiente / enquadramento), não combinações fechadas
// tipo "cenas prontas". Cada opção é escolhida por ser visualmente distinta
// das outras no mesmo eixo — a checagem de diversidade compara IDs, então
// só funciona se cada ID já representar uma diferença relevante por si só.
//
// Calçado foi a primeira categoria (única com dado real quando isto nasceu,
// 12/09/2026) — category sempre foi campo de primeira classe em
// GenerationLog pra outras entrarem depois sem reescrever nada disto.
// Passou a valer de verdade em 14/09/2026 (Patricia: "queremos vender o app
// para todo o tipo de loja", depois refinado: "interação e modo visual são
// dimensões diferentes"): CategoryRepertoire abaixo é o contrato que
// qualquer categoria nova implementa; getRepertoireForInteraction (ver
// categoryDispatch.server.ts) despacha pra ela por categoria E por
// interação (worn/held/applied/standalone — ver
// productClassification.server.ts), nunca só por categoria. O
// repertório de calçado abaixo NÃO virou o repertório universal do
// Stockative — é o vocabulário de USO possível pra calçado (qualquer marca
// de calçado pode compartilhar), a energia e atmosfera de cada marca
// continuam vindo do Brand Voice no prompt, não daqui.
export interface RepertoireOption {
  id: string;
  promptText: string;
  // Multiplicador aplicado ANTES do ajuste de diversidade (ver pickWeighted)
  // — ausente = 1, peso neutro. Existe hoje só pra dar preferência real à
  // pose sentada de pernas cruzadas (ver seated_crossed_legs), a única
  // composição já validada como a que faz o sapato vender de verdade
  // (Patricia, 14/09/2026, ao ver um lote em pé: "não geram vontade de
  // comprar o sapato que não está em destaque"). Em pé/andando/etc.
  // continuam elegíveis como variedade ocasional, só deixam de ter peso
  // igual a uma pose que nunca foi provada como a que mais vende.
  baseWeight?: number;
}

export type ProductSeason = "summer" | "winter";
export type Setting = "indoor" | "outdoor";

// Achado ao vivo, 12/09/2026: uma sandália de verão saiu numa rua de pedra
// cinzenta, pedindo "luz de janela" (interior) pra um ambiente de exterior
// — a incompatibilidade entre eixo de luz e de ambiente produziu uma cena
// nem-lá-nem-cá, fria e sem graça, e o ambiente em si não tinha nada de
// verão. Escolher ambiente/luz como eixos totalmente independentes, sem
// checar estação nem compatibilidade indoor/outdoor entre eles, foi o erro
// — corrigido abaixo.
const OPEN_FOOTWEAR_PATTERN = /(sandal|sandália|sandalia|slide|espadrille|flip.?flop|mule)/;

function inferProductSeason(productTitle: string): ProductSeason | null {
  const text = productTitle.toLowerCase();
  if (OPEN_FOOTWEAR_PATTERN.test(text)) return "summer";
  if (/(boot|bota|chelsea|bootie)/.test(text)) return "winter";
  return null; // mocassim, sapatilha etc. — sem restrição de estação
}

// Prefixos de fuso IANA no hemisfério sul — cobre os países onde o app
// vende hoje (Brasil, e mercados de língua portuguesa/espanhola do
// hemisfério sul) mais os grandes mercados do hemisfério sul em geral.
// Fuso horário é só uma aproximação de hemisfério, não de estação exata
// (paralelo mais preciso exigiria lat/long reais, que a Admin API não
// expõe) — o bastante pra não errar o hemisfério inteiro.
const SOUTHERN_HEMISPHERE_TIMEZONE_PREFIXES = [
  "America/Sao_Paulo",
  "America/Argentina",
  "America/Santiago",
  "America/Montevideo",
  "America/Asuncion",
  "America/La_Paz",
  "Australia/",
  "Pacific/Auckland",
  "Pacific/Fiji",
  "Africa/Johannesburg",
  "Africa/Windhoek",
  "Indian/Antananarivo",
];

function isSouthernHemisphere(ianaTimezone: string): boolean {
  return SOUTHERN_HEMISPHERE_TIMEZONE_PREFIXES.some((prefix) => ianaTimezone.startsWith(prefix));
}

// A estação de VERDADE onde a loja está agora — usada só como desempate
// quando o produto em si não pede uma estação fixa (ver inferProductSeason;
// "o cenário segue a estação do sapato, não o contrário" continua valendo
// pra sandália/bota). Patricia, 13/09/2026: "ele tem a informação da
// geolocalização da loja, ele sabe que estou na bélgica e que agora aqui é
// outono, então ele deve adaptar isso aos posts" — pra mocassim, sapatilha
// etc., que hoje caíam num repertório sem filtro nenhum de estação, isso os
// alinha com a estação real da lojista em vez de deixar ao acaso.
// Simplificado pro binário summer/winter que o repertório já tem:
// primavera/verão → "summer" (externo, luz quente), outono/inverno →
// "winter" (interior aconchegante, luz de janela) — combina melhor com o
// que os dois grupos de ambiente já representam do que introduzir 2
// estações novas sem repertório visual próprio ainda.
function inferRealCurrentSeason(ianaTimezone: string | null): ProductSeason {
  const month = new Date().getUTCMonth(); // 0 = janeiro
  const isNorthernWarm = month >= 2 && month <= 7; // março a agosto: primavera/verão no hemisfério norte
  const isNorthern = !ianaTimezone || !isSouthernHemisphere(ianaTimezone);
  const isWarmSeasonHere = isNorthern ? isNorthernWarm : !isNorthernWarm;
  return isWarmSeasonHere ? "summer" : "winter";
}

// Calçado ABERTO (sandália, tira, espadrille) é o único que faz sentido numa
// cena de praia/resort com pé à mostra — um mocassim, oxford ou sapatilha
// FECHADO nunca é calçado de praia, mesmo sendo "de verão" em sentido amplo
// (Patricia, 13/09/2026: "um sapato preto fechado de outono pq esta numa
// paisagem de praia? nosso prompt esta falho, deve levar a categoria, as
// cores, o estilo do produto em consideração"). Antes disso, "sem estação
// definida" (mocassim etc.) liberava a lista INTEIRA de ambientes sem
// filtro nenhum, incluindo praia — é como um mocassim fechado foi parar lá.
function isOpenFootwear(productTitle: string): boolean {
  return OPEN_FOOTWEAR_PATTERN.test(productTitle.toLowerCase());
}

interface FootwearAction extends RepertoireOption {
  requiresSeated: boolean; // só pode ser sorteada pra um ambiente com assento de verdade
  motion: boolean; // pra casar com enquadramento de movimento
}

// Achado ao vivo, 12/09/2026 (Patricia: "ela esta sentada em uma cadeira no
// meio da rua, isso nao existe") — ação e ambiente eram sorteados
// totalmente independentes, sem checar se existe onde sentar naquele
// cenário. "Sentada" agora só é compatível com ambiente marcado
// `supportsSeated: true` — ver FOOTWEAR_ENVIRONMENTS abaixo.
export const FOOTWEAR_ACTIONS: FootwearAction[] = [
  {
    id: "seated_crossed_legs",
    requiresSeated: true,
    motion: false,
    baseWeight: 8, // ver comentário em RepertoireOption — a regra, não a exceção
    promptText:
      "seated toward the back of the seat with the back supported, legs elegantly crossed at the knee, both feet settled",
  },
  {
    id: "standing_walking",
    requiresSeated: false,
    motion: true,
    promptText:
      "captured mid-stride, walking naturally with a relaxed, confident gait, at the exact instant in the stride where the front foot is planted and the shoe's profile is fully visible and in sharp focus, not blurred by the motion",
  },
  {
    id: "arriving_entering",
    requiresSeated: false,
    motion: true,
    promptText:
      "arriving at the scene, caught mid-motion stepping into or turning toward the space, timed so the shoe on the forward or weight-bearing foot is clearly visible, unobstructed and in sharp focus",
  },
  {
    id: "leaning_against_structure",
    requiresSeated: false,
    motion: false,
    promptText: "leaning casually against a wall, railing, or archway, weight shifted onto one leg",
  },
  {
    id: "interacting_with_object",
    requiresSeated: false,
    motion: false,
    promptText:
      "interacting with something in the scene (opening a door, resting a hand on furniture, holding a cup), with the product still the visual focus",
  },
];

interface FootwearEnvironment extends RepertoireOption {
  seasons: ProductSeason[]; // em quais estações de produto isso pode aparecer
  setting: Setting;
  // Se true, o promptText JÁ inclui um assento real e específico (banco,
  // cadeira de café, poltrona) — nunca deixar o modelo generativo inventar
  // um móvel sozinho, que é como surge o "cadeira no meio da rua".
  supportsSeated: boolean;
  // Só pra cena de praia/resort — nunca combina com calçado fechado
  // (mocassim, oxford, sapatilha), mesmo sendo tecnicamente "verão".
  requiresOpenFootwear?: boolean;
}

// Ambientes de verão sempre com sol/luz quente explícita no texto — não
// basta ser "exterior", precisa ler como verão de verdade (Patricia,
// 12/09/2026: "quando falamos em verão isso remete a mais alegria, calor,
// algo leve" — brand voice da Mangará, belga com raízes brasileiras).
export const FOOTWEAR_ENVIRONMENTS: FootwearEnvironment[] = [
  {
    id: "garden_courtyard",
    seasons: ["summer"],
    setting: "outdoor",
    supportsSeated: true,
    promptText:
      "a classic garden courtyard in full warm sunlight, trimmed hedges, greenery, stone paving, and a stone bench",
  },
  {
    id: "cafe_terrace",
    seasons: ["summer"],
    setting: "outdoor",
    supportsSeated: true,
    promptText:
      "a sun-drenched café terrace with light-colored paving, a café chair and small table, potted plants nearby, bright and inviting",
  },
  {
    id: "stone_staircase",
    seasons: ["summer"],
    setting: "outdoor",
    supportsSeated: true,
    promptText:
      "a wide stone staircase or terrace with a balustrade, warm afternoon sun, climbing ivy or a potted olive tree nearby — sitting on the wide steps or the balustrade ledge itself, no separate chair needed",
  },
  {
    id: "urban_street",
    seasons: ["summer", "winter"],
    setting: "outdoor",
    supportsSeated: false,
    promptText:
      "a quiet European street with classic architecture, bathed in warm sunlight, never grey or overcast, with a tree or window boxes with greenery visible in frame",
  },
  // Adicionados por pedido direto da Patricia, 12/09/2026: "estas sandalias
  // de verao porque nao estar em um ambiente de resort saida da praia,
  // jantar de holiday na praia? ninguem quer comprar esta sandalia a
  // partir deste visual" — o repertório de verão até aqui era todo
  // europeu/arquitetônico; faltava a narrativa de viagem/resort que já é
  // válida no playbook da própria Mangará ("product_destination").
  {
    id: "beach_boardwalk_departure",
    seasons: ["summer"],
    setting: "outdoor",
    supportsSeated: false,
    requiresOpenFootwear: true,
    promptText:
      "a wooden beach boardwalk, golden sand and turquoise sea visible just behind, as if stepping away from the beach at late afternoon, warm holiday light",
  },
  {
    id: "seaside_resort_terrace",
    seasons: ["summer"],
    setting: "outdoor",
    requiresOpenFootwear: true,
    supportsSeated: true,
    promptText:
      "an open-air seaside resort dinner terrace at golden hour, sea view in the background, a relaxed dining chair, warm string lights just starting to glow, effortless holiday elegance",
  },
  {
    id: "interior_window_light",
    seasons: ["winter"],
    setting: "indoor",
    supportsSeated: true,
    promptText:
      "a warm, cozy sunlit interior with wood tones, a large window, a deep armchair, and a potted plant near the light",
  },
  {
    id: "dining_room_atelier",
    seasons: ["winter"],
    setting: "indoor",
    supportsSeated: true,
    promptText:
      "an airy, warmly lit dining room or atelier-style interior, with a chair at a table and fresh flowers or a plant nearby",
  },
];

interface FootwearFraming extends RepertoireOption {
  // "any" combina com qualquer ação; "seated"/"motion" só com ação
  // compatível — mesmo princípio da ação x ambiente, pra nunca pedir um
  // enquadramento de movimento numa pose parada ou vice-versa.
  compatibleWith: "any" | "seated" | "motion";
}

// "TRUNCATION_SAFETY" repetido em toda opção de propósito (Patricia,
// 13/09/2026, achado ao vivo: "a pessoa do imagem so existe da cintura para
// baixo") — um framing tipo "from the knee up" ou "thigh down" é uma
// instrução de ENQUADRAMENTO DE CÂMERA sobre uma pessoa inteira, mas o
// modelo às vezes interpreta como "gere uma pessoa que só tem perna",
// principalmente quando o ambiente ao redor é um cômodo inteiro e espaçoso
// (a cena "pede" um corpo inteiro, e o corte no meio lê como corpo
// incompleto, não como foto bem enquadrada).
const TRUNCATION_SAFETY =
  "this is a photographic crop of a complete, whole person — her body continues naturally beyond the frame exactly as in a real photograph, never an anatomically incomplete or truncated figure";

export const FOOTWEAR_FRAMINGS: FootwearFraming[] = [
  {
    id: "mid_shot_knee_up",
    compatibleWith: "any",
    promptText: `framed from roughly the knee up (${TRUNCATION_SAFETY})`,
  },
  {
    id: "close_crop_thigh_down",
    compatibleWith: "any",
    promptText: `a closer crop from the thigh down (${TRUNCATION_SAFETY})`,
  },
  {
    id: "seated_wide_environment",
    compatibleWith: "seated",
    promptText: "a slightly wider shot that also shows the surrounding environment",
  },
  {
    id: "walking_motion_crop",
    compatibleWith: "motion",
    promptText:
      "a crop that captures the leg mid-motion, framed so the shoe stays fully inside the frame and is the sharpest, most prominent element in it — never cropped off, turned away from camera, or lost in motion blur",
  },
];

interface FootwearLight extends RepertoireOption {
  setting: Setting[]; // com quais ambientes isso combina
}

// Luz NÃO entra na exigência de diversidade de propósito (Patricia,
// 12/09/2026: "não obrigar variedade em todas as dimensões... luz e
// tratamento fotográfico [podem] manter... identidade") — escolhida livre
// entre as compatíveis com o AMBIENTE já escolhido (nunca luz de janela
// pra cena de rua, por exemplo), sem pesar pelo histórico.
export const FOOTWEAR_LIGHTS: FootwearLight[] = [
  { id: "golden_hour_warm", setting: ["outdoor"], promptText: "warm, soft golden-hour sunlight" },
  {
    id: "bright_warm_daylight",
    setting: ["outdoor"],
    promptText: "bright, warm daylight with soft shadows — never flat, grey, or overcast-looking",
  },
  { id: "window_light_interior", setting: ["indoor"], promptText: "soft, warm natural window light" },
];

export interface SceneDecision {
  action: RepertoireOption;
  environment: RepertoireOption;
  framing: RepertoireOption;
  light: RepertoireOption;
  season: ProductSeason | null;
}

// Não é "unknown"/"not_applicable" propriamente — essas duas strings nunca
// aparecem como IDs de repertório, só como resposta possível da
// classificação observada (ver checkImageComposition). Usado aqui só pra
// nunca confundir as duas listas.
export const OBSERVED_INCONCLUSIVE = ["unknown", "not_applicable"] as const;

export function isInconclusiveObservation(value: string | null | undefined): boolean {
  return !value || (OBSERVED_INCONCLUSIVE as readonly string[]).includes(value);
}

export const HISTORY_WINDOW = 8;

export function weightedRandomPick<T>(items: { option: T; weight: number }[]): T {
  const total = items.reduce((sum, item) => sum + item.weight, 0);
  let roll = Math.random() * total;
  for (const item of items) {
    roll -= item.weight;
    if (roll <= 0) return item.option;
  }
  return items[items.length - 1].option;
}

// Favorece o que apareceu MENOS nas últimas HISTORY_WINDOW gerações
// OBSERVADAS da loja PARA ESTA CATEGORIA (nunca as solicitadas — ver
// comentário em GenerationLog) — mesmo princípio já usado pro
// rebalanceamento de pilares em planWeek.server.ts. Isso reduz drasticamente
// uma oscilação simples tipo A→B→A→B: depois de usar B, tanto A quanto B
// ficam "recentes" e um terceiro valor passa a pesar mais, então o ciclo não
// fecha em só duas opções.
//
// Filtro por `category` adicionado em 14/09/2026 — antes de existir mais de
// uma categoria, uma loja que vendesse sapato E vestido ao mesmo tempo
// misturaria os dois vocabulários (IDs de ação/ambiente diferentes) na
// mesma janela de 8, diluindo o sinal de diversidade de cada categoria.
export async function pickWeighted<T extends RepertoireOption>(
  shopId: string,
  category: VisualCategory,
  observedField: "observedAction" | "observedEnvironment" | "observedFraming",
  options: T[],
): Promise<T> {
  const recent = await prisma.generationLog.findMany({
    where: { shopId, taskType: "image", category, [observedField]: { not: null } },
    orderBy: { createdAt: "desc" },
    take: HISTORY_WINDOW,
    select: { [observedField]: true },
  });

  const counts = new Map<string, number>();
  for (const row of recent) {
    const value = (row as Record<string, string | null>)[observedField];
    if (value && !isInconclusiveObservation(value)) {
      counts.set(value, (counts.get(value) ?? 0) + 1);
    }
  }

  const weighted = options.map((option) => ({
    option,
    weight:
      Math.max(HISTORY_WINDOW - (counts.get(option.id) ?? 0) * 3, 1) * (option.baseWeight ?? 1),
  }));

  return weightedRandomPick(weighted);
}

async function selectFootwearScene(shopId: string, productTitle: string): Promise<SceneDecision> {
  // "O cenário segue a estação do sapato, não o contrário" continua valendo
  // pra sandália/bota (inferProductSeason). Só quando o produto não pede
  // uma estação fixa (mocassim, sapatilha) é que a estação REAL da loja
  // entra como desempate, em vez de deixar a lista inteira sem filtro.
  const shop = await prisma.shop.findUnique({ where: { id: shopId }, select: { ianaTimezone: true } });
  const season = inferProductSeason(productTitle) ?? inferRealCurrentSeason(shop?.ianaTimezone ?? null);
  const openFootwear = isOpenFootwear(productTitle);

  // Ambiente escolhido PRIMEIRO agora — ação, enquadramento e luz dependem
  // dele (assento existe? é indoor/outdoor?), não são mais eixos
  // independentes escolhidos em paralelo (achado ao vivo, 12/09/2026: uma
  // cadeira surgindo sozinha no meio da rua, porque "sentada" e "rua" nunca
  // se checavam entre si). Praia/resort também exige calçado aberto, senão
  // um mocassim fechado pode acabar lá só por não ter estação definida (ver
  // requiresOpenFootwear).
  const compatibleEnvironments = FOOTWEAR_ENVIRONMENTS.filter(
    (e) => e.seasons.includes(season) && (!e.requiresOpenFootwear || openFootwear),
  );
  const environment = await pickWeighted(shopId, "footwear", "observedEnvironment", compatibleEnvironments);

  const compatibleActions = environment.supportsSeated
    ? FOOTWEAR_ACTIONS
    : FOOTWEAR_ACTIONS.filter((a) => !a.requiresSeated);
  const action = await pickWeighted(shopId, "footwear", "observedAction", compatibleActions);

  const compatibleFramings = FOOTWEAR_FRAMINGS.filter(
    (f) =>
      f.compatibleWith === "any" ||
      (f.compatibleWith === "seated" && action.requiresSeated) ||
      (f.compatibleWith === "motion" && action.motion),
  );
  const framing = await pickWeighted(shopId, "footwear", "observedFraming", compatibleFramings);

  // Luz sempre compatível com o ambiente já escolhido (indoor/outdoor) —
  // nunca "luz de janela" pra uma cena de rua, por exemplo.
  const compatibleLights = FOOTWEAR_LIGHTS.filter((l) => l.setting.includes(environment.setting));
  const light = compatibleLights[Math.floor(Math.random() * compatibleLights.length)];

  return { action, environment, framing, light, season };
}

// Contrato que todo repertório implementa, seja com modelo (worn/held/
// applied) ou sem (standalone) — a mesma forma serve pros dois porque a
// diferença real está em QUAL interação foi escolhida antes de chegar
// aqui, não na forma da cena em si (ver getRepertoireForInteraction em
// categoryDispatch.server.ts pro despacho por categoria + interação).
export interface CategoryRepertoire {
  id: VisualCategory;
  selectScene(shopId: string, productTitle: string): Promise<SceneDecision>;
  // Bloco de regras de composição ESPECÍFICAS da categoria, inserido no
  // prompt de geração junto das regras universais (humor, luz, tom de
  // marca) que valem pra qualquer produto — ver buildWornOrHandheldPrompt
  // em generateProductImage.server.ts.
  promptRules: string;
  // IDs pro guardrail de composição classificar o que a imagem REALMENTE
  // mostra (ver checkImageComposition) e pra checagem de descompasso
  // estrutural (ver hasStructuralMismatch) — cada categoria informa os seus.
  sceneOptionIds: { actions: string[]; environments: string[]; framings: string[] };
}

// Extraída ipsis litteris do prompt condicional que existia em
// generateProductImage.server.ts ("If the product is footwear: ...") —
// playbook validado em dezenas de iterações reais pra Mangará (ver
// /Users/patriciacossettin/Mangara-Nano-Banana/CLAUDE.md), só reorganizada
// pra virar o bloco de UMA categoria entre várias, não mais uma condicional
// solta dentro do prompt universal.
const FOOTWEAR_PROMPT_RULES = `- Frame the footwear so its side silhouette is visible (never toe pointed straight at camera, which foreshortens it). Any pants, skirt, or dress hem MUST end above the ankle, leaving the ankle bare — never a long/midi/maxi length that covers the ankle or shoe, even partially. The shoe needs to occupy a real, noticeable portion of the frame, not just be a small detail at the bottom of a full-body shot — if the environment is spacious (a large room, an architectural exterior), move the camera close enough that the product still dominates the frame instead of shrinking into a wide establishing shot. BOTH shoes/feet must be fully and clearly inside the frame — never let one foot get cut off at the edge of the image. This still applies fully in a walking/motion pose: choose the instant in the stride where the shoe is clearest (front foot planted or the trailing foot's side profile clearly visible), in sharp focus, not blurred by motion and not the leg turned away from camera.`;

export const footwearRepertoire: CategoryRepertoire = {
  id: "footwear",
  selectScene: selectFootwearScene,
  promptRules: FOOTWEAR_PROMPT_RULES,
  sceneOptionIds: {
    actions: FOOTWEAR_ACTIONS.map((a) => a.id),
    environments: FOOTWEAR_ENVIRONMENTS.map((e) => e.id),
    framings: FOOTWEAR_FRAMINGS.map((f) => f.id),
  },
};
