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

export const CONTENT_LANGUAGES = [
  { code: "en", label: "English" },
  { code: "fr", label: "French" },
  { code: "nl", label: "Dutch" },
  { code: "de", label: "German" },
  { code: "pt", label: "Portuguese" },
  { code: "es", label: "Spanish" },
] as const;

export type ContentLanguageCode = (typeof CONTENT_LANGUAGES)[number]["code"];
