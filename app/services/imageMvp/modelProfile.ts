// Perfil de foto por loja (Patricia, 05/10/2026, depois de uma imagem em
// que a modelo não combinava com a marca: "qual seriam os perfis de modelo
// para escolhermos?" → "acho que vale colocar etnia" → "isso iria em
// settings... incluir masculino e infantil ou imagem de família... festa ou
// reunião de negócios... grupo de amigos... melhora estas opções" → "pode
// ter múltipla escolha para cabelo, cor e se preso ou solto, e perfil de
// roupa... casual ou chic"). Editável a qualquer momento em Settings, vale
// pra toda imagem com pessoa; a direção de regeneração da lojista continua
// mandando por cima. Arquivo sem ".server" de propósito: as opções/rótulos
// também são usados pela tela.
//
// QUEM aparece é escolha única (com "a IA decide pelo produto") — sortear
// entre mulher e homem colocaria uma bota feminina num homem. Todo o resto
// é múltipla escolha: 1 marcada = sempre essa, várias = varia entre elas,
// nenhuma = varia entre todas (pra o feed não repetir sempre a mesma cara).
// O sorteio acontece uma vez por imagem (ver describeModel).
//
// Termos neutros sempre — nunca linguagem de peso ("acima do peso"), outras
// lojistas veem e usam estas opções.

export interface ModelProfile {
  subject: string;
  occasions: string[];
  outfitStyles: string[];
  ageRanges: string[];
  bodyTypes: string[];
  heights: string[];
  ethnicities: string[];
  hairColors: string[];
  hairStyles: string[];
  attitudes: string[];
  notes: string;
}

export interface ModelOption {
  value: string;
  label: string;
  prompt: string;
}

export type ModelProfileListField = Exclude<keyof ModelProfile, "subject" | "notes">;

export const MODEL_SUBJECTS: ModelOption[] = [
  { value: "auto", label: "Match the product (AI decides)", prompt: "" },
  { value: "woman", label: "Woman", prompt: "a woman" },
  { value: "man", label: "Man", prompt: "a man" },
  { value: "couple", label: "Couple", prompt: "a couple" },
  { value: "child", label: "Child", prompt: "a child aged roughly 4 to 10" },
  { value: "parent_child", label: "Parent and child", prompt: "a parent with their young child" },
  { value: "family", label: "Family", prompt: "a family — two parents with one or two young children" },
  { value: "friends", label: "Group of friends", prompt: "a small group of two or three friends" },
  { value: "colleagues", label: "Colleagues / team", prompt: "two or three colleagues" },
];

const SINGLE_ADULT_SUBJECTS = ["woman", "man"];
const CHILD_SUBJECTS = ["child", "parent_child", "family"];
// Uma família / pai+filho é uma família só — etnia sorteada uma vez, não "mistura".
const SINGLE_HOUSEHOLD_SUBJECTS = ["family", "parent_child"];

export const MODEL_OCCASIONS: ModelOption[] = [
  { value: "city", label: "City / street", prompt: "a stroll through elegant city streets" },
  { value: "home", label: "At home, cozy", prompt: "a calm, cozy moment at home in a beautifully styled interior" },
  { value: "weekend", label: "Weekend outdoors", prompt: "a relaxed weekend outdoors — a park, a garden or a countryside walk" },
  { value: "cafe", label: "Café / brunch", prompt: "a café or brunch with natural daylight" },
  { value: "travel", label: "Travel / vacation", prompt: "a travel or vacation moment in a beautiful destination" },
  { value: "beach", label: "Beach / resort", prompt: "a sunny beach or resort setting" },
  { value: "dinner", label: "Dinner / evening event", prompt: "an elegant dinner or evening event" },
  { value: "date", label: "Date night", prompt: "a romantic date night" },
  { value: "party", label: "Party / celebration", prompt: "a festive party or celebration" },
  { value: "wedding", label: "Wedding guest", prompt: "attending a wedding as a guest, in an elegant venue" },
  { value: "business", label: "Business meeting / office", prompt: "a business meeting in a refined, modern office or meeting room" },
  { value: "active", label: "Sport / active", prompt: "an active moment — a walk, a workout or a sport suited to the product" },
  { value: "holidays", label: "Holiday season", prompt: "the festive holiday season, with subtle seasonal decoration" },
];

export const MODEL_OUTFIT_STYLES: ModelOption[] = [
  { value: "casual", label: "Casual", prompt: "relaxed casual — well-fitted everyday pieces, effortless" },
  { value: "smart_casual", label: "Smart casual", prompt: "smart casual — polished but relaxed" },
  { value: "chic", label: "Chic / elegant", prompt: "chic and elegant, refined fabrics and tailoring" },
  { value: "minimalist", label: "Minimalist", prompt: "minimalist — clean lines, few pieces, a restrained palette" },
  { value: "classic", label: "Classic / timeless", prompt: "classic and timeless" },
  { value: "bohemian", label: "Bohemian", prompt: "bohemian — flowing fabrics, natural textures" },
  { value: "streetwear", label: "Streetwear", prompt: "contemporary streetwear" },
  { value: "sporty", label: "Sporty", prompt: "sporty and athleisure" },
  { value: "glam", label: "Glamorous / evening", prompt: "glamorous evening wear" },
  { value: "formal", label: "Business / formal", prompt: "business formal — sharp tailoring" },
];

export const MODEL_AGE_RANGES: ModelOption[] = [
  { value: "20_30", label: "20–30", prompt: "in their twenties" },
  { value: "30_40", label: "30–40", prompt: "in their thirties" },
  { value: "40_55", label: "40–55", prompt: "aged roughly 40 to 55" },
  { value: "55_plus", label: "55+", prompt: "over 55, with natural, graceful signs of age" },
];

export const MODEL_BODY_TYPES: ModelOption[] = [
  { value: "petite", label: "Petite", prompt: "a petite, small-framed build" },
  { value: "slender", label: "Slender", prompt: "a slender build" },
  { value: "athletic", label: "Athletic", prompt: "an athletic, toned build" },
  { value: "average", label: "Average", prompt: "an average build" },
  { value: "hourglass", label: "Hourglass", prompt: "an hourglass figure" },
  { value: "curvy", label: "Curvy / plus-size", prompt: "a curvy, plus-size build" },
];

export const MODEL_HEIGHTS: ModelOption[] = [
  { value: "tall", label: "Tall, long legs", prompt: "tall, with long legs and elongated proportions" },
  { value: "natural", label: "Natural proportions", prompt: "natural, everyday proportions" },
];

export const MODEL_ETHNICITIES: ModelOption[] = [
  { value: "european", label: "White / European", prompt: "of European descent" },
  { value: "latina", label: "Latin American", prompt: "of Latin American descent" },
  { value: "black", label: "Black", prompt: "Black" },
  { value: "east_asian", label: "East Asian", prompt: "East Asian" },
  { value: "south_asian", label: "South Asian", prompt: "South Asian" },
  { value: "middle_eastern", label: "Middle Eastern / North African", prompt: "of Middle Eastern or North African descent" },
  { value: "mixed", label: "Mixed heritage", prompt: "of mixed heritage" },
];

export const MODEL_HAIR_COLORS: ModelOption[] = [
  { value: "black", label: "Black", prompt: "black" },
  { value: "dark_brown", label: "Dark brown", prompt: "dark brown" },
  { value: "light_brown", label: "Light brown", prompt: "light brown" },
  { value: "blonde", label: "Blonde", prompt: "blonde" },
  { value: "red", label: "Red / auburn", prompt: "red or auburn" },
  { value: "grey", label: "Grey / silver", prompt: "grey or silver" },
];

// `forMen`: quais penteados podem sair pra homem quando nada foi marcado
// (achado no teste: "coque elegante" saindo pra homem).
interface HairStyleOption extends ModelOption {
  forMen: boolean;
}

export const MODEL_HAIR_STYLES: HairStyleOption[] = [
  { value: "tied", label: "Tied back (bun / ponytail)", prompt: "worn tied back in an elegant bun or low ponytail", forMen: false },
  { value: "loose", label: "Loose / worn down", prompt: "worn loose", forMen: false },
  { value: "short", label: "Short", prompt: "cut short", forMen: true },
  { value: "medium", label: "Medium length", prompt: "medium length", forMen: true },
  { value: "curly", label: "Curly / natural texture", prompt: "in natural curls or coils", forMen: true },
];

export const MODEL_ATTITUDES: ModelOption[] = [
  { value: "serene", label: "Elegant and serene", prompt: "a calm, serene, quietly elegant expression" },
  { value: "softly_happy", label: "Softly happy (subtle smile)", prompt: "a softly happy expression with a subtle, natural smile" },
  { value: "warm", label: "Warm and smiling", prompt: "a warm, open, genuinely smiling expression" },
  { value: "radiant", label: "Happy and radiant", prompt: "a radiant, openly happy expression" },
  { value: "nostalgic", label: "Nostalgic / dreamy", prompt: "a gentle, nostalgic, dreamy mood, gaze softly away from the camera" },
  { value: "joyful", label: "Joyful and playful", prompt: "a joyful, playful, carefree energy" },
  { value: "relaxed", label: "Relaxed and natural", prompt: "a relaxed, natural, candid expression" },
  { value: "editorial", label: "Editorial and confident", prompt: "a confident, editorial presence" },
];

const LIST_OPTIONS: Record<ModelProfileListField, ModelOption[]> = {
  occasions: MODEL_OCCASIONS,
  outfitStyles: MODEL_OUTFIT_STYLES,
  ageRanges: MODEL_AGE_RANGES,
  bodyTypes: MODEL_BODY_TYPES,
  heights: MODEL_HEIGHTS,
  ethnicities: MODEL_ETHNICITIES,
  hairColors: MODEL_HAIR_COLORS,
  hairStyles: MODEL_HAIR_STYLES,
  attitudes: MODEL_ATTITUDES,
};

export const MODEL_NOTES_MAX_LENGTH = 300;

export const DEFAULT_MODEL_PROFILE: ModelProfile = {
  subject: "auto",
  occasions: [],
  outfitStyles: [],
  ageRanges: [],
  bodyTypes: [],
  heights: [],
  ethnicities: [],
  hairColors: [],
  hairStyles: [],
  attitudes: [],
  notes: "",
};

// Criança em imagem de marketing (roupa/calçado infantil é caso real) —
// sempre com estas salvaguardas, sem exceção, e nunca sob as regras de
// corpo/altura/atitude/roupa de adulto.
const CHILD_SAFETY =
  "Any child shown is fully and age-appropriately dressed in ordinary children's clothing, in a natural, playful, wholesome everyday pose — never posed or styled like an adult model, never with makeup, never in swimwear or underwear.";

function randomItem<T>(items: T[], random: () => number): T {
  return items[Math.floor(random() * items.length)];
}

// Marcadas → sorteia entre elas; nenhuma → sorteia entre `fallback`.
function pickFrom<T extends ModelOption>(options: T[], selected: string[], random: () => number, fallback: T[] = options): T {
  const chosen = options.filter((option) => selected.includes(option.value));
  return randomItem(chosen.length ? chosen : fallback, random);
}

export function parseModelProfile(raw: unknown): ModelProfile | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  const profile: ModelProfile = {
    ...DEFAULT_MODEL_PROFILE,
    subject: MODEL_SUBJECTS.some((option) => option.value === value.subject) ? String(value.subject) : "auto",
    notes: typeof value.notes === "string" ? value.notes.slice(0, MODEL_NOTES_MAX_LENGTH) : "",
  };
  for (const field of Object.keys(LIST_OPTIONS) as ModelProfileListField[]) {
    const list = value[field];
    profile[field] = Array.isArray(list)
      ? list.filter((item): item is string => LIST_OPTIONS[field].some((option) => option.value === item))
      : [];
  }
  return profile;
}

// Perfil sem nenhuma escolha = sem preferência; não entra no prompt.
export function isDefaultModelProfile(profile: ModelProfile): boolean {
  return JSON.stringify({ ...profile, notes: profile.notes.trim() }) === JSON.stringify(DEFAULT_MODEL_PROFILE);
}

// Resolve o perfil num retrato concreto pra UMA imagem. Chamado uma vez por
// geração, não por tentativa — as retentativas da mesma imagem mantêm as
// mesmas pessoas, roupa e ocasião.
export function describeModel(profile: ModelProfile, random: () => number = Math.random): string {
  const subject = MODEL_SUBJECTS.find((option) => option.value === profile.subject && option.value !== "auto");
  const isChild = subject?.value === "child";
  const isGroup = Boolean(subject) && !SINGLE_ADULT_SUBJECTS.includes(subject!.value) && !isChild;
  const involvesChild = !subject || CHILD_SUBJECTS.includes(subject.value);

  const selectedEthnicities = MODEL_ETHNICITIES.filter((option) => profile.ethnicities.includes(option.value));
  const ethnicity =
    isGroup && !SINGLE_HOUSEHOLD_SUBJECTS.includes(subject!.value) && selectedEthnicities.length !== 1
      ? `with a natural mix of backgrounds (${(selectedEthnicities.length ? selectedEthnicities : MODEL_ETHNICITIES).map((option) => option.prompt).join(", ")})`
      : pickFrom(MODEL_ETHNICITIES, profile.ethnicities, random).prompt;

  const hairStyleFallback =
    subject?.value === "man" ? MODEL_HAIR_STYLES.filter((option) => option.forMen) : MODEL_HAIR_STYLES;
  const hair = `${pickFrom(MODEL_HAIR_COLORS, profile.hairColors, random).prompt} hair ${pickFrom(MODEL_HAIR_STYLES, profile.hairStyles, random, hairStyleFallback).prompt}`;

  const parts: string[] = [];
  if (!subject) {
    parts.push(
      "The person shown is whoever would really wear or use this product (a woman, a man or a child, matching the product)",
    );
  } else if (isChild) {
    parts.push(`The person shown is ${subject.prompt}, ${ethnicity}, with ${hair}`);
  } else {
    const age = pickFrom(MODEL_AGE_RANGES, profile.ageRanges, random).prompt;
    parts.push(
      isGroup
        ? `The people shown are ${subject.prompt}; the adults are ${age}, ${ethnicity}`
        : `The person shown is ${subject.prompt} ${age.replace("their", subject.value === "man" ? "his" : "her")}, ${ethnicity}`,
      `with ${pickFrom(MODEL_BODY_TYPES, profile.bodyTypes, random).prompt}`,
      pickFrom(MODEL_HEIGHTS, profile.heights, random).prompt,
      hair,
      `and ${pickFrom(MODEL_ATTITUDES, profile.attitudes, random).prompt}`,
    );
  }
  if (isGroup) {
    parts.push("the product is worn or used by the person it's made for and stays the clear hero of the image");
  }

  let description = `${parts.join(", ")}.`;
  if (!isChild && profile.outfitStyles.length) {
    description += ` Outfit style (the adults' clothing around the product): ${pickFrom(MODEL_OUTFIT_STYLES, profile.outfitStyles, random).prompt}.`;
  }
  if (involvesChild) description += ` ${CHILD_SAFETY}`;
  if (profile.occasions.length) {
    description += ` Occasion: the scene is ${pickFrom(MODEL_OCCASIONS, profile.occasions, random).prompt} — this replaces the setting described further below.`;
  }
  if (profile.notes.trim()) description += ` Also: ${profile.notes.trim()}`;
  return description;
}

// Valores válidos por campo — usados pelo schema da sugestão automática no
// Brand Analysis (ver draftBrandVoice.server.ts).
export const MODEL_SUBJECT_VALUES = MODEL_SUBJECTS.map((option) => option.value);
export const MODEL_LIST_VALUES: Record<ModelProfileListField, string[]> = Object.fromEntries(
  (Object.keys(LIST_OPTIONS) as ModelProfileListField[]).map((field) => [
    field,
    LIST_OPTIONS[field].map((option) => option.value),
  ]),
) as Record<ModelProfileListField, string[]>;

// Resumo legível do perfil pra tela ("Woman · 30–40 · Slender · Chic …").
export function summarizeModelProfile(profile: ModelProfile): string {
  const subject = MODEL_SUBJECTS.find((option) => option.value === profile.subject)?.label ?? "";
  const lists = (Object.keys(LIST_OPTIONS) as ModelProfileListField[])
    .map((field) =>
      LIST_OPTIONS[field]
        .filter((option) => profile[field].includes(option.value))
        .map((option) => option.label)
        .join(" / "),
    )
    .filter(Boolean);
  return [subject, ...lists].join(" · ");
}
