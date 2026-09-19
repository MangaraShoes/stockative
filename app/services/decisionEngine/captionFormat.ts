// Sem sufixo .server de propósito — usado tanto no preview (componente,
// roda no navegador) quanto na publicação real (servidor), pra nunca
// divergirem de novo (Patricia, 11/09/2026: "the preview and actual
// published result differ" — hashtags publicados sem #, CTA nunca incluído).
// Uma função só constrói a legenda final nos dois lugares.

export function formatHashtags(hashtags: string[]): string {
  return hashtags
    .map((tag) => tag.trim().replace(/^#/, ""))
    .filter(Boolean)
    .map((tag) => `#${tag}`)
    .join(" ");
}

export function parseStoredHashtags(hashtagsField: string | null): string[] {
  if (!hashtagsField) return [];
  return hashtagsField
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
}

// Limite real da Graph API pra caption de post — confirmado via busca em
// 11/09/2026 depois de um post bilíngue real falhar no publish com "The
// caption was too long" (FR completo + NL completo passava de 2200).
export const INSTAGRAM_CAPTION_LIMIT = 2200;
// Margem reservada pra CTA + hashtags + separadores, fora do texto principal.
const CTA_HASHTAGS_OVERHEAD = 300;

// Orçamento de caracteres pro Estágio 2 mirar na legenda no idioma
// PRINCIPAL — quando há segundo idioma, a legenda final é a soma das duas
// traduções completas, então cada uma precisa de bem menos que o limite
// total (0.85 é margem de segurança: línguas latinas podem traduzir um
// pouco mais longas que o original).
export function maxPrimaryCaptionChars(hasSecondaryLanguage: boolean): number {
  const available = INSTAGRAM_CAPTION_LIMIT - CTA_HASHTAGS_OVERHEAD;
  return hasSecondaryLanguage ? Math.floor((available * 0.85) / 2) : available;
}

// Rede de segurança — mesmo que o Estágio 2 não respeite o orçamento
// perfeitamente, a publicação nunca mais deveria falhar por causa disso.
export function truncateCaption(caption: string, limit: number = INSTAGRAM_CAPTION_LIMIT): string {
  if (caption.length <= limit) return caption;
  return `${caption.slice(0, limit - 1).trimEnd()}…`;
}

// Corrigido em 12/09/2026 (achado de revisão externa: "the fallback cuts
// the completed caption at the character limit. That can remove the
// second-language ending, CTA or hashtags"). Antes, o corte acontecia
// DEPOIS de já ter juntado tudo, então um texto principal longo demais
// podia levar CTA e hashtags junto no corte cego. Agora reserva o espaço
// de CTA + hashtags primeiro e só encurta o texto principal (que pode ter
// as duas traduções bilíngues juntas) se ainda faltar espaço — CTA e
// hashtags nunca são cortados.
export function buildFinalCaption(params: {
  captionText: string;
  cta?: string | null;
  hashtags: string[];
}): string {
  const ctaPart = params.cta?.trim() || "";
  const hashtagsPart = formatHashtags(params.hashtags) || "";
  const trailingParts = [ctaPart, hashtagsPart].filter(Boolean);
  // "\n\n" entre cada parte presente, inclusive entre o texto principal e a
  // primeira parte final — reservado à parte pra sobrar exatamente o espaço
  // certo pro texto principal.
  const separatorsReserved = ("\n\n".length) * (trailingParts.length > 0 ? trailingParts.length : 0);
  const trailingLength = trailingParts.join("").length + separatorsReserved;

  const mainText = params.captionText.trim();
  const maxForMainText = Math.max(INSTAGRAM_CAPTION_LIMIT - trailingLength, 0);
  const trimmedMainText =
    mainText.length > maxForMainText ? truncateCaption(mainText, maxForMainText) : mainText;

  const parts = [trimmedMainText, ctaPart || null, hashtagsPart || null];
  return parts.filter((part): part is string => Boolean(part)).join("\n\n");
}
