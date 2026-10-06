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
//   cor, então a roda de cores não diz nada útil: escolhe na biblioteca da
//   estação, tirando as histórias da mesma família do produto;
// - produto de COR: harmonias filtradas pela marca — as histórias neutras
//   mais as complementares/análogas suaves daquela família. Cor forte
//   (vermelho, coral, rosa...) fica com o outfit só neutro: o produto é o
//   único ponto de cor, regra validada na Mangará;
// - rotação: nunca repete uma história das últimas ROTATION_WINDOW imagens
//   da loja enquanto houver alternativa, e as menos usadas pesam mais.
//
// A direção da lojista na regeneração continua acima de tudo isto (ver
// merchantDirectionBlock): se ela pede "vestido chocolate", vale o pedido.

export interface ColorStory {
  id: string;
  seasons: ProductSeason[];
  // Neutra = sem cor de verdade. É a única escolha pra produto de cor forte,
  // e nunca é sorteada pra produto neutro (senão o bege volta a dominar).
  neutral?: boolean;
  // Famílias de produto com que esta roupa se confunde — fora da escolha.
  clashesWith: ProductColorFamily[];
  promptText: string;
}

export const COLOR_STORIES: ColorStory[] = [
  // Outono / inverno
  {
    id: "khaki_tonal",
    seasons: ["winter"],
    clashesWith: ["khaki_olive", "green", "beige_cream", "tan_camel"],
    promptText:
      "khaki tone on tone — a fluid silk piece in khaki with a sandier, lighter khaki cashmere layer; the texture difference between silk and cashmere creates the depth, warm gold jewelry",
  },
  {
    id: "chocolate_cream",
    seasons: ["winter"],
    clashesWith: ["brown"],
    promptText: "deep chocolate brown and cream — for example a chocolate silk or fine-knit dress with a cream cashmere layer",
  },
  {
    id: "bordeaux_camel",
    seasons: ["winter"],
    clashesWith: ["red_burgundy", "tan_camel"],
    promptText: "soft, muted bordeaux with camel — a bordeaux knit or silk piece paired with a camel tailored layer",
  },
  {
    id: "bottle_green_ivory",
    seasons: ["winter"],
    clashesWith: ["khaki_olive", "green"],
    promptText: "a muted, dusty bottle green with ivory — a bottle-green knit or skirt with ivory silk or wool",
  },
  {
    id: "navy_offwhite",
    seasons: ["winter"],
    clashesWith: ["blue"],
    promptText: "deep navy with off-white — crisp navy tailoring or knit with off-white silk or poplin",
  },
  {
    id: "caramel_chocolate",
    seasons: ["winter"],
    clashesWith: ["brown", "tan_camel"],
    promptText: "warm tone on tone in caramel and chocolate — a caramel piece layered with chocolate, rich and warm",
  },
  {
    id: "plum_rosebeige",
    seasons: ["winter"],
    clashesWith: ["purple", "pink"],
    promptText: "a muted, greyed plum with a soft rosy beige — a plum knit or silk with rose-beige wool",
  },
  {
    id: "mustard_chocolate",
    seasons: ["winter"],
    clashesWith: ["yellow"],
    promptText: "a faded, muted mustard with chocolate brown — never bright yellow, closer to old gold",
  },
  // Primavera / verão
  {
    id: "dusty_blue_ivory",
    seasons: ["summer"],
    clashesWith: ["blue"],
    promptText: "dusty blue with ivory — a dusty-blue linen or silk piece with ivory",
  },
  {
    id: "sage_raw_linen",
    seasons: ["summer"],
    clashesWith: ["khaki_olive", "green"],
    promptText: "soft sage green with raw, undyed linen — airy and natural",
  },
  {
    id: "dusty_rose_tonal",
    seasons: ["summer"],
    clashesWith: ["pink", "red_burgundy"],
    promptText: "dusty rose tone on tone — two close shades of muted, powdery rose in fluid fabrics",
  },
  {
    id: "terracotta_cream",
    seasons: ["summer"],
    clashesWith: ["orange_coral", "tan_camel"],
    promptText: "a soft, sun-faded terracotta with cream — never bright orange",
  },
  {
    id: "lavender_warm_white",
    seasons: ["summer"],
    clashesWith: ["purple"],
    promptText: "a greyed, muted lavender with warm white",
  },
  {
    id: "washed_sky_sand",
    seasons: ["summer"],
    clashesWith: ["blue", "beige_cream"],
    promptText: "a washed, pale sky blue with sand",
  },
  {
    id: "all_white_textures",
    seasons: ["summer"],
    clashesWith: ["white"],
    promptText: "all white — warm whites and ivory only, the interest coming from mixed textures (linen, poplin, crochet or silk)",
  },
  {
    id: "butter_camel",
    seasons: ["summer"],
    clashesWith: ["yellow", "tan_camel"],
    promptText: "a soft butter yellow with camel — pale and creamy, never a bright yellow",
  },
  // Neutras: só pra produto de cor, que deve ser o único ponto de cor.
  {
    id: "ivory_camel",
    seasons: ["summer", "winter"],
    neutral: true,
    clashesWith: ["tan_camel", "beige_cream"],
    promptText: "ivory and camel only, fully neutral so the product is the only point of color",
  },
  {
    id: "raw_linen_tonal",
    seasons: ["summer"],
    neutral: true,
    clashesWith: ["beige_cream", "white"],
    promptText: "raw linen tone on tone — undyed linen and ecru, fully neutral so the product is the only point of color",
  },
  {
    id: "black_ivory",
    seasons: ["winter"],
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
// produto de cor forte só teria 2 histórias por estação.
const DEEP_NEUTRAL_STORIES = ["chocolate_cream", "navy_offwhite", "all_white_textures"];

// Produto de cor suave → neutras + as histórias que harmonizam com ela
// (complementar dessaturada ou análoga terrosa).
const HARMONIES: Partial<Record<ProductColorFamily, string[]>> = {
  green: ["chocolate_cream", "caramel_chocolate", "bordeaux_camel", "terracotta_cream", "dusty_rose_tonal"],
  blue: ["chocolate_cream", "caramel_chocolate", "terracotta_cream", "butter_camel", "all_white_textures"],
};

export const ROTATION_WINDOW = 8;

export function candidateStories(colorFamily: ProductColorFamily, season: ProductSeason): ColorStory[] {
  const inSeason = COLOR_STORIES.filter((s) => s.seasons.includes(season) && !s.clashesWith.includes(colorFamily));
  if (NEUTRAL_PRODUCT_FAMILIES.includes(colorFamily)) return inSeason.filter((s) => !s.neutral);
  if (STRONG_COLOR_FAMILIES.includes(colorFamily)) {
    return inSeason.filter((s) => s.neutral || DEEP_NEUTRAL_STORIES.includes(s.id));
  }
  const harmonies = HARMONIES[colorFamily] ?? [];
  return inSeason.filter((s) => s.neutral || harmonies.includes(s.id));
}

export async function pickColorStory(
  shopId: string,
  colorFamily: ProductColorFamily,
  season: ProductSeason,
): Promise<ColorStory> {
  let candidates = candidateStories(colorFamily, season);
  // Nunca deveria acontecer com a biblioteca atual, mas uma estação sem
  // opção não pode travar a geração.
  if (candidates.length === 0) candidates = COLOR_STORIES.filter((s) => s.seasons.includes(season));

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
  return pool[Math.floor(Math.random() * pool.length)];
}

export function describeColorStory(story: ColorStory): string {
  return `- Color story for the outfit (unless the merchant's direction above asks for other colors): ${story.promptText}. All tones muted and desaturated, never loud. The outfit color must clearly differ from the product's own color so the product stands out. Echo one of these tones in one small scene detail (flowers, a cushion, a book or a ceramic) so the whole image feels composed; the walls and floor stay calm and light.`;
}
