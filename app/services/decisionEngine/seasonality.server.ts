// Sinal de estação pro ranking semanal de produtos (Patricia, 24/09/2026:
// "ele nao esta considerando a estação do ano... nao adianta so olhar para
// o estoque sao multiplos fatores... precisa mesclar com produtos de
// outono, tipo loafers"). Não exclui produto fora de estação (uma sandália
// com estoque real ainda pode entrar) — só empurra o ranking pra dar mais
// espaço a peças que combinam com a estação atual, então o lote da semana
// tende a misturar categorias em vez de ficar 100% sandália em pleno
// outono europeu.
//
// A loja pode ser do hemisfério norte (Europa) ou sul (Brasil) — setembro
// é outono na Europa e primavera no Brasil, o oposto. A estação é sempre
// calculada a partir do hemisfério real da loja, nunca assumida fixa.

export type Season = "spring" | "summer" | "fall" | "winter";
type Hemisphere = "north" | "south";

// Cobertura focada nos 2 mercados-alvo do produto (Brasil e Europa, ver
// CLAUDE.md) — lista de fusos do hemisfério sul conhecidos; qualquer fuso
// fora dessa lista assume hemisfério norte (cobre a Europa inteira e a
// maior parte do resto do mundo). Não é exaustiva pra todo fuso do
// planeta, mas correta pros mercados que o produto realmente atende hoje.
const SOUTHERN_HEMISPHERE_PATTERNS = [
  /^America\/Argentina\//,
  /^America\/Sao_Paulo$/,
  /^America\/Bahia$/,
  /^America\/Fortaleza$/,
  /^America\/Recife$/,
  /^America\/Maceio$/,
  /^America\/Araguaina$/,
  /^America\/Belem$/,
  /^America\/Santarem$/,
  /^America\/Manaus$/,
  /^America\/Boa_Vista$/,
  /^America\/Porto_Velho$/,
  /^America\/Rio_Branco$/,
  /^America\/Cuiaba$/,
  /^America\/Campo_Grande$/,
  /^America\/Noronha$/,
  /^America\/Santiago$/,
  /^America\/Montevideo$/,
  /^America\/Asuncion$/,
  /^America\/La_Paz$/,
  /^Australia\//,
  /^Pacific\/Auckland$/,
  /^Africa\/Johannesburg$/,
  /^Africa\/Windhoek$/,
];

function inferHemisphere(timeZone: string): Hemisphere {
  return SOUTHERN_HEMISPHERE_PATTERNS.some((pattern) => pattern.test(timeZone)) ? "south" : "north";
}

const NORTH_SEASON_BY_MONTH: Season[] = [
  "winter", "winter", "spring", "spring", "spring", "summer",
  "summer", "summer", "fall", "fall", "fall", "winter",
]; // índice 0 = janeiro

const SEASON_OPPOSITE: Record<Season, Season> = {
  spring: "fall",
  summer: "winter",
  fall: "spring",
  winter: "summer",
};

// Estação atual na perspectiva da loja (mês real no fuso dela, não no de
// quem está rodando o servidor).
export function currentSeasonInTimezone(timeZone: string, from: Date = new Date()): Season {
  const monthStr = new Intl.DateTimeFormat("en-US", { timeZone, month: "numeric" }).format(from);
  const monthIndex = Number(monthStr) - 1; // 0-11
  const northSeason = NORTH_SEASON_BY_MONTH[monthIndex] ?? "spring";
  return inferHemisphere(timeZone) === "north" ? northSeason : SEASON_OPPOSITE[northSeason];
}

// Afinidade de estação por categoria de calçado (productType da Shopify).
// Categorias fora dessa lista (sneakers, pumps, e qualquer productType não
// mapeado) ficam neutras de propósito — não são tipicamente sazonais.
const SEASON_AFFINITY: Record<string, Season[]> = {
  sandals: ["spring", "summer"],
  mules: ["spring", "summer"],
  heels: ["spring", "summer"],
  loafers: ["fall", "winter", "spring"],
  boots: ["fall", "winter"],
  ballerinas: ["fall", "winter", "spring"],
};

// Empurrão de ranking pra estação atual — nem exclui fora de estação, nem
// domina sinais comerciais fortes (mesma ordem de grandeza do bônus de
// capital imobilizado, ver rankProductsForWeek). Positivo quando a
// categoria combina com a estação, negativo quando é claramente da
// estação oposta, zero pra categoria sem afinidade sazonal definida.
const SEASON_SCORE_WEIGHT = 15;

export function seasonScoreBoost(productType: string | null, season: Season): number {
  const affinity = SEASON_AFFINITY[productType?.toLowerCase().trim() ?? ""];
  if (!affinity) return 0;
  return affinity.includes(season) ? SEASON_SCORE_WEIGHT : -SEASON_SCORE_WEIGHT;
}
