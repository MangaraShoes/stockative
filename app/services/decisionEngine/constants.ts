// Constantes compartilhadas entre código de servidor (Estágios 1/2) e o
// componente de tela (que roda no navegador). Precisam ficar FORA dos
// arquivos `.server.ts` — o React Router corta esses arquivos do bundle do
// navegador, e uma tela que importasse uma constante de lá quebraria o build
// ("Server-only module referenced by client").

export const CREATIVE_ARCHETYPES = [
  "educational",
  "problem_solution",
  "product_benefit",
  "social_proof",
  "lifestyle_aspiration",
  "founder_story",
  "behind_the_scenes",
  "comparison",
  "urgency",
  "newness",
  "ugc_style",
  "objection_handling",
] as const;

export type CreativeArchetype = (typeof CREATIVE_ARCHETYPES)[number];

export const NARRATIVE_FRAMEWORKS = [
  "hook_value_proof_cta",
  "pas",
  "aida",
  "before_after",
] as const;

export type NarrativeFramework = (typeof NARRATIVE_FRAMEWORKS)[number];

export const COMMERCIAL_OBJECTIVES = [
  "awareness",
  "engagement",
  "traffic",
  "conversion",
  "inventory",
] as const;

export type CommercialObjective = (typeof COMMERCIAL_OBJECTIVES)[number];

// Rótulos em linguagem simples pros 5 objetivos comerciais — a lojista não
// precisa reconhecer o termo técnico de marketing pra escolher. Compartilhado
// entre app.plan-week.tsx e app.content-pillars.tsx (13/09/2026, quando o
// objetivo passou a ser escolhido antes de gerar os pillares também).
export const OBJECTIVE_LABELS: Record<CommercialObjective, string> = {
  awareness: "Introduce it (new arrival)",
  engagement: "Build engagement",
  traffic: "Drive traffic to the shop",
  conversion: "Drive sales",
  inventory: "Clear excess stock",
};

// Preferência de ESTILO de imagem da loja, capturada no onboarding
// (Patricia, 24/09/2026: "podemos tbem perguntar que tipo de imagem a
// pessoa deseja... para ja começarmos a criar de forma asseritva... sem
// precisar regenerar tantas vezes"). Mapeia quase 1:1 pras dimensões já
// existentes do Image MVP — ver STYLE_PREFERENCE_OVERRIDES em
// visualMode.server.ts. "ai_decide" (ou null, ainda não respondido) nunca
// muda o comportamento atual — só entra quando a lojista escolhe de
// verdade uma das 4 opções reais.
export const IMAGE_STYLE_PREFERENCES = [
  { value: "lifestyle", label: "Lifestyle with a model" },
  { value: "still", label: "Still editorial, product on a surface" },
  { value: "held", label: "Held in someone's hand" },
  { value: "studio", label: "Studio, neutral background" },
  { value: "ai_decide", label: "Let AI decide" },
] as const;

export type ImageStylePreference = (typeof IMAGE_STYLE_PREFERENCES)[number]["value"];

export const CONTENT_LANGUAGES = [
  { code: "en", label: "English" },
  { code: "fr", label: "French" },
  { code: "nl", label: "Dutch" },
  { code: "de", label: "German" },
  { code: "pt", label: "Portuguese" },
  { code: "es", label: "Spanish" },
] as const;

export type ContentLanguageCode = (typeof CONTENT_LANGUAGES)[number]["code"];

// Sugestões pré-clicáveis pro campo de explicação obrigatório ao regenerar
// uma imagem (Patricia, 24/09/2026: "podemos neste campo de explicação
// deixar pre preenchido na lingua do app algumas ideias que podem estar nao
// agradando"). Clicar preenche o textarea; a lojista ainda pode editar por
// cima — é um ponto de partida, não um valor fechado.
export const REGENERATION_REASON_SUGGESTIONS: Record<ContentLanguageCode, string[]> = {
  en: [
    "Background doesn't match the brand",
    "Product isn't visible enough",
    "Lighting looks off",
    "Angle doesn't flatter the product",
    "Feels too generic",
  ],
  fr: [
    "Le fond ne correspond pas à la marque",
    "Le produit n'est pas assez visible",
    "L'éclairage ne va pas",
    "L'angle ne met pas le produit en valeur",
    "Trop générique",
  ],
  nl: [
    "Achtergrond past niet bij het merk",
    "Product is niet zichtbaar genoeg",
    "Belichting klopt niet",
    "Hoek doet het product geen recht",
    "Voelt te generiek",
  ],
  de: [
    "Hintergrund passt nicht zur Marke",
    "Produkt ist nicht sichtbar genug",
    "Beleuchtung wirkt falsch",
    "Blickwinkel schmeichelt dem Produkt nicht",
    "Wirkt zu generisch",
  ],
  pt: [
    "O fundo não combina com a marca",
    "O produto está pouco visível",
    "A iluminação não ficou boa",
    "O ângulo não favorece o produto",
    "Parece genérico demais",
  ],
  es: [
    "El fondo no combina con la marca",
    "El producto no se ve lo suficiente",
    "La iluminación no quedó bien",
    "El ángulo no favorece al producto",
    "Se ve demasiado genérico",
  ],
};
