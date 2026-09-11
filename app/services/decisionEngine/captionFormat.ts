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

export function buildFinalCaption(params: {
  captionText: string;
  cta?: string | null;
  hashtags: string[];
}): string {
  const parts = [
    params.captionText.trim(),
    params.cta?.trim() || null,
    formatHashtags(params.hashtags) || null,
  ];
  return parts.filter((part): part is string => Boolean(part)).join("\n\n");
}
