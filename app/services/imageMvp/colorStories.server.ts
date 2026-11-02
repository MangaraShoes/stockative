import prisma from "../../db.server";
import type { ProductColorFamily } from "./productClassification.server";
import type { ProductSeason } from "./repertoire.server";

// Histórias de cor da roupa e da cena (Patricia, 06/10/2026). Substituem a
// paleta fixa "cream, camel, black, off-white, stone", que o modelo lia como
// cardápio — 4 das 5 cores são bege, e toda imagem saía bege/off-white ("a
// cor da roupa estamos repetindo muito bege off white"). Ela pediu variedade
// com bom gosto: "não queremos excesso ou cores estranhas mas queremos
// impressionar pelo bom gosto, elegância e a variedade".
//
// Cada história é um look pensado (2-3 tons + tecidos), não uma cor solta: é
// a combinação planeada que dá o ar de bom gosto. Tudo dessaturado, e sem
// cinza no outfit (rejeitado na Mangará como "triste").
//
// Como escolhe (ver pickColorStory):
// - produto NEUTRO (preto, castanho, bege, branco...) aceita quase qualquer
//   cor, então a roda de cores não diz nada útil: escolhe na biblioteca
//   inteira, tirando as histórias da mesma família do produto;
// - produto de COR: harmonias filtradas pela marca — as histórias neutras
//   mais as complementares/análogas suaves daquela família. Cor forte
//   (vermelho, coral, rosa...) fica com o outfit só neutro: o produto é o
//   único ponto de cor, regra validada na Mangará;
// - produto ESCURO (bordô) nunca recebe roupa escura — só clara;
// - as cores valem o ano todo; a estação só decide o tecido (02/11/2026);
// - rotação: nunca repete uma história das últimas ROTATION_WINDOW imagens
//   da loja enquanto houver alternativa, e as menos usadas pesam mais.
//
// A direção da lojista na regeneração continua acima de tudo isto (ver
// merchantDirectionBlock): se ela pede "vestido chocolate", vale o pedido.

export interface ColorStory {
  id: string;
  // Tom dominante da roupa. Produto escuro só recebe roupa clara (ver
  // DARK_PRODUCT_FAMILIES).
  tone: "light" | "dark";
  // Neutra = sem cor de verdade. É a única escolha pra produto de cor forte,
  // e nunca é sorteada pra produto neutro (senão o bege volta a dominar).
  neutral?: boolean;
  // Famílias de produto com que esta roupa se confunde — fora da escolha.
  clashesWith: ProductColorFamily[];
  // Só as cores. O tecido vem da estação (ver seasonFabrics) — Patricia,
  // 02/11/2026: "as cores de verão também funcionam no inverno, mas em um
  // look mais inverno ou ambiente interno".
  promptText: string;
}

export const COLOR_STORIES: ColorStory[] = [
  {
    id: "khaki_tonal",
    tone: "light",
    clashesWith: ["khaki_olive", "green", "beige_cream", "tan_camel"],
    promptText:
      "khaki tone on tone — a khaki piece with a sandier, lighter khaki layer; the texture difference between the two fabrics creates the depth, warm gold jewelry",
  },
  {
    id: "chocolate_cream",
    tone: "dark",
    clashesWith: ["brown"],
    promptText: "deep chocolate brown and cream — for example a chocolate dress with a cream layer",
  },
  {
    id: "bordeaux_camel",
    tone: "dark",
    clashesWith: ["red_burgundy", "tan_camel", "brown"],
    promptText: "soft, muted bordeaux with camel — a bordeaux piece paired with a camel layer",
  },
  {
    id: "bottle_green_ivory",
    tone: "dark",
    clashesWith: ["khaki_olive", "green"],
    promptText: "a muted, dusty bottle green with ivory",
  },
  {
    id: "navy_offwhite",
    tone: "dark",
    clashesWith: ["blue"],
    promptText: "deep navy with off-white — crisp navy with off-white",
  },
  {
    id: "caramel_chocolate",
    tone: "dark",
    clashesWith: ["brown", "tan_camel"],
    promptText: "warm tone on tone in caramel and chocolate — a caramel piece layered with chocolate, rich and warm",
  },
  {
    id: "plum_rosebeige",
    tone: "dark",
    clashesWith: ["purple", "pink"],
    promptText: "a muted, greyed plum with a soft rosy beige",
  },
  {
    id: "mustard_chocolate",
    tone: "dark",
    // Mostarda/ocre camufla bolsa caramelo/conhaque (Patricia, 28/10/2026).
    clashesWith: ["yellow", "tan_camel", "brown", "orange_coral"],
    promptText: "a faded, muted mustard with chocolate brown — never bright yellow, closer to old gold",
  },
  {
    id: "dusty_blue_ivory",
    tone: "light",
    clashesWith: ["blue"],
    promptText: "a soft, light dusty blue with ivory — greyed and pale, never navy or bright",
  },
  {
    id: "sage_raw_linen",
    tone: "light",
    clashesWith: ["khaki_olive", "green"],
    promptText: "soft sage green with raw, undyed ecru — natural and calm",
  },
  {
    id: "dusty_rose_tonal",
    tone: "light",
    // Rosa antigo com produto bordô liberado (Patricia, 02/11/2026).
    clashesWith: ["pink"],
    promptText: "dusty rose (old rose) tone on tone — two close shades of muted, powdery rose",
  },
  {
    id: "terracotta_cream",
    tone: "light",
    clashesWith: ["orange_coral", "tan_camel", "brown"],
    promptText: "a soft, sun-faded terracotta with cream — never bright orange",
  },
  {
    id: "lavender_warm_white",
    tone: "light",
    clashesWith: ["purple"],
    promptText: "a greyed, muted lavender with warm white",
  },
  {
    id: "washed_sky_sand",
    tone: "light",
    clashesWith: ["blue", "beige_cream"],
    promptText: "a washed, pale sky blue with sand",
  },
  {
    id: "all_white_textures",
    tone: "light",
    clashesWith: ["white"],
    promptText: "all white — warm whites and ivory only, the interest coming from mixed textures",
  },
  {
    id: "butter_camel",
    tone: "light",
    clashesWith: ["yellow", "tan_camel", "brown"],
    promptText: "a soft butter yellow with camel — pale and creamy, never a bright yellow",
  },
  // Neutras: só pra produto de cor, que deve ser o único ponto de cor.
  {
    id: "ivory_camel",
    tone: "light",
    neutral: true,
    clashesWith: ["tan_camel", "beige_cream"],
    promptText: "ivory and camel only, fully neutral so the product is the only point of color",
  },
  {
    id: "raw_linen_tonal",
    tone: "light",
    neutral: true,
    clashesWith: ["beige_cream", "white"],
    promptText: "raw ecru tone on tone — undyed, natural off-whites, fully neutral so the product is the only point of color",
  },
  {
    id: "nude_blush",
    tone: "light",
    neutral: true,
    // Nude com produto bordô (Patricia, 02/11/2026).
    clashesWith: ["beige_cream", "tan_camel", "pink"],
    promptText: "nude tone on tone — soft nude, blush and rosy beige, fully neutral so the product is the only point of color",
  },
  {
    id: "black_ivory",
    tone: "dark",
    neutral: true,
    clashesWith: ["black"],
    promptText: "black and ivory, sharp and graphic, fully neutral so the product is the only point of color",
  },
];

const NEUTRAL_PRODUCT_FAMILIES: ProductColorFamily[] = [
  "black",
  "brown",
  "tan_camel",
  "beige_cream",
  "white",
  "grey",
  "metallic",
  "khaki_olive", // cáqui funciona como neutro na moda
];

// Produto de cor forte → outfit só neutro (o produto é o único ponto de cor).
const STRONG_COLOR_FAMILIES: ProductColorFamily[] = ["red_burgundy", "pink", "orange_coral", "yellow", "purple", "multicolor"];

// Marinho, chocolate e branco funcionam como neutros na moda — sem eles, um
// produto de cor forte só teria poucas histórias.
const DEEP_NEUTRAL_STORIES = ["chocolate_cream", "navy_offwhite", "all_white_textures"];

// Cores suaves que também valem com um produto de cor forte (Patricia,
// 02/11/2026: com bordô, rosa antigo e um azul mais claro ficam bons).
const STRONG_HARMONIES: Partial<Record<ProductColorFamily, string[]>> = {
  red_burgundy: ["dusty_rose_tonal", "dusty_blue_ivory", "washed_sky_sand"],
};

// Produto escuro só com roupa clara (Patricia, 02/11/2026, depois de uma
// bolsa bordô sumir contra um vestido chocolate: escuro contra escuro não dá
// destaque). Decidido aqui, não no prompt — instrução em texto o gerador
// ignora metade das vezes. "purple" fica de fora porque mistura ameixa
// (escuro) com lavanda (claro).
const DARK_PRODUCT_FAMILIES: ProductColorFamily[] = ["red_burgundy"];

// Produto de cor suave → neutras + as histórias que harmonizam com ela
// (complementar dessaturada ou análoga terrosa).
const HARMONIES: Partial<Record<ProductColorFamily, string[]>> = {
  green: ["chocolate_cream", "caramel_chocolate", "bordeaux_camel", "terracotta_cream", "dusty_rose_tonal"],
  blue: ["chocolate_cream", "caramel_chocolate", "terracotta_cream", "butter_camel", "all_white_textures"],
};

export const ROTATION_WINDOW = 8;

export function candidateStories(colorFamily: ProductColorFamily): ColorStory[] {
  const allowed = COLOR_STORIES.filter(
    (s) => !s.clashesWith.includes(colorFamily) && !(DARK_PRODUCT_FAMILIES.includes(colorFamily) && s.tone === "dark"),
  );
  if (NEUTRAL_PRODUCT_FAMILIES.includes(colorFamily)) return allowed.filter((s) => !s.neutral);
  if (STRONG_COLOR_FAMILIES.includes(colorFamily)) {
    const harmonies = STRONG_HARMONIES[colorFamily] ?? [];
    return allowed.filter((s) => s.neutral || DEEP_NEUTRAL_STORIES.includes(s.id) || harmonies.includes(s.id));
  }
  const harmonies = HARMONIES[colorFamily] ?? [];
  return allowed.filter((s) => s.neutral || harmonies.includes(s.id));
}

export async function pickColorStory(
  shopId: string,
  colorFamily: ProductColorFamily,
  season: ProductSeason,
): Promise<ColorStory> {
  let candidates = candidateStories(colorFamily);
  // Nunca deveria acontecer com a biblioteca atual, mas uma família sem
  // opção não pode travar a geração.
  if (candidates.length === 0) candidates = COLOR_STORIES;

  const recent = await prisma.generationLog.findMany({
    where: { shopId, taskType: "image", requestedPalette: { not: null } },
    orderBy: { createdAt: "desc" },
    take: ROTATION_WINDOW,
    select: { requestedPalette: true },
  });
  const counts = new Map<string, number>();
  for (const { requestedPalette } of recent) {
    counts.set(requestedPalette!, (counts.get(requestedPalette!) ?? 0) + 1);
  }

  // Sem repetir enquanto houver alternativa; se todas já saíram, as menos
  // usadas na janela.
  const unused = candidates.filter((s) => !counts.has(s.id));
  const minCount = Math.min(...candidates.map((s) => counts.get(s.id) ?? 0));
  const pool = unused.length > 0 ? unused : candidates.filter((s) => (counts.get(s.id) ?? 0) === minCount);
  const story = pool[Math.floor(Math.random() * pool.length)];
  return { ...story, promptText: `${story.promptText}, ${seasonFabrics(season)}` };
}

// A mesma cor em qualquer estação; o tecido é que muda.
function seasonFabrics(season: ProductSeason): string {
  return season === "winter"
    ? "worn in winter fabrics — fine knits, fine wool or cashmere, soft layers suited to a warm indoor scene"
    : "worn in light, airy fabrics — linen, cotton or silk";
}

export function describeColorStory(story: ColorStory): string {
  return `- Color story for the outfit (unless the merchant's direction above asks for other colors): ${story.promptText}. All tones muted and desaturated, never loud. The outfit color must clearly differ from the product's own color so the product stands out. Echo one of these tones in one small scene detail (flowers, a cushion, a book or a ceramic) so the whole image feels composed; the walls and floor stay calm and light.`;
}
