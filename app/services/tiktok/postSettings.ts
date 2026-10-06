// Configuração de um Reel no TikTok via Direct Post (Patricia, 30/09/2026:
// "claro que o app deve poder postar sozinho sem precisar entrar no tiktok
// e autorizar"). Sem .server de propósito: a tela do Weekly Plan usa os
// mesmos tipos, textos e validação que o servidor, pra nunca divergir do
// que o TikTok exige nas diretrizes de UX da Content Posting API
// (https://developers.tiktok.com/doc/content-sharing-guidelines), que são
// o que a auditoria do Direct Post confere:
// - privacidade escolhida manualmente, sem valor padrão, só entre as
//   opções que o creator_info devolve;
// - comentário/duet/stitch desligados por padrão, e desabilitados quando a
//   conta da lojista desliga isso no próprio TikTok;
// - divulgação de conteúdo comercial (toggle desligado por padrão; se
//   ligado, "Your brand" e/ou "Branded content" obrigatório);
// - conteúdo de marca de terceiros nunca pode ser "Only me";
// - declaração de consentimento com o texto exato do TikTok, e nada é
//   enviado antes do consentimento expresso.

export const TIKTOK_PRIVACY_LEVELS = [
  "PUBLIC_TO_EVERYONE",
  "MUTUAL_FOLLOW_FRIENDS",
  "FOLLOWER_OF_CREATOR",
  "SELF_ONLY",
] as const;
export type TikTokPrivacyLevel = (typeof TIKTOK_PRIVACY_LEVELS)[number];

export const TIKTOK_PRIVACY_LABELS: Record<TikTokPrivacyLevel, string> = {
  PUBLIC_TO_EVERYONE: "Everyone",
  MUTUAL_FOLLOW_FRIENDS: "Friends",
  FOLLOWER_OF_CREATOR: "Followers",
  SELF_ONLY: "Only me",
};

// Limite de caracteres do título/legenda do Direct Post (UTF-16).
export const TIKTOK_TITLE_MAX_LENGTH = 2200;

export const TIKTOK_MUSIC_USAGE_URL = "https://www.tiktok.com/legal/page/global/music-usage-confirmation/en";
export const TIKTOK_BRANDED_CONTENT_POLICY_URL = "https://www.tiktok.com/legal/page/global/bc-policy/en";

// O que o creator_info devolve e a tela precisa respeitar.
export interface TikTokCreatorInfo {
  nickname: string;
  username: string;
  avatarUrl: string | null;
  privacyLevelOptions: TikTokPrivacyLevel[];
  commentDisabled: boolean;
  duetDisabled: boolean;
  stitchDisabled: boolean;
  maxVideoPostDurationSec: number;
  // Enquanto o app não passar pela auditoria do Direct Post, o TikTok só
  // aceita post "Only me" numa conta privada (ver queryTikTokCreatorInfo).
  // unauditedOnlyMe = as opções já foram cortadas pra SELF_ONLY;
  // accountIsPublic = a conta ainda é pública, então até o "Only me" falha.
  unauditedOnlyMe: boolean;
  accountIsPublic: boolean;
}

export interface TikTokPostSettings {
  privacyLevel: TikTokPrivacyLevel;
  allowComment: boolean;
  allowDuet: boolean;
  allowStitch: boolean;
  // Divulgação comercial: brandOrganic = "Your brand" (promove o próprio
  // negócio, rótulo "Promotional content"); brandedContent = "Branded
  // content" (promove terceiro, rótulo "Paid partnership").
  commercialContent: boolean;
  brandOrganic: boolean;
  brandedContent: boolean;
  title: string;
  consentedAt: string; // ISO — quando a lojista confirmou este post pro TikTok
}

export function tiktokDeclarationText(settings: {
  commercialContent: boolean;
  brandedContent: boolean;
}): { hasBrandedContentPolicy: boolean } {
  return { hasBrandedContentPolicy: settings.commercialContent && settings.brandedContent };
}

export function tiktokCommercialLabel(settings: {
  commercialContent: boolean;
  brandOrganic: boolean;
  brandedContent: boolean;
}): string | null {
  if (!settings.commercialContent) return null;
  if (settings.brandedContent) return "Paid partnership";
  if (settings.brandOrganic) return "Promotional content";
  return null;
}

// Mesma validação na tela (pra desabilitar o botão) e no servidor (pra
// nunca aceitar um POST forjado). Devolve o motivo em texto, ou null se
// está tudo certo.
export function validateTikTokPostSettings(
  settings: Omit<TikTokPostSettings, "consentedAt"> | (Omit<TikTokPostSettings, "consentedAt" | "privacyLevel"> & { privacyLevel: TikTokPrivacyLevel | "" }),
  creator: TikTokCreatorInfo,
): string | null {
  if (!settings.privacyLevel) return "Choose who can see this post on TikTok.";
  if (!creator.privacyLevelOptions.includes(settings.privacyLevel)) {
    return "That visibility option isn't available for your TikTok account.";
  }
  if (settings.commercialContent && !settings.brandOrganic && !settings.brandedContent) {
    return "You need to indicate if your content promotes yourself, a third party, or both.";
  }
  if (settings.commercialContent && settings.brandedContent && settings.privacyLevel === "SELF_ONLY") {
    return "Branded content visibility cannot be set to private.";
  }
  if (settings.allowComment && creator.commentDisabled) return "Comments are turned off on your TikTok account.";
  if (settings.allowDuet && creator.duetDisabled) return "Duet is turned off on your TikTok account.";
  if (settings.allowStitch && creator.stitchDisabled) return "Stitch is turned off on your TikTok account.";
  if (settings.title.length > TIKTOK_TITLE_MAX_LENGTH) {
    return `The TikTok caption can have at most ${TIKTOK_TITLE_MAX_LENGTH} characters.`;
  }
  return null;
}

export function parseStoredTikTokSettings(value: unknown): TikTokPostSettings | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Partial<TikTokPostSettings>;
  if (!v.privacyLevel || !TIKTOK_PRIVACY_LEVELS.includes(v.privacyLevel) || !v.consentedAt) return null;
  return {
    privacyLevel: v.privacyLevel,
    allowComment: Boolean(v.allowComment),
    allowDuet: Boolean(v.allowDuet),
    allowStitch: Boolean(v.allowStitch),
    commercialContent: Boolean(v.commercialContent),
    brandOrganic: Boolean(v.brandOrganic),
    brandedContent: Boolean(v.brandedContent),
    title: typeof v.title === "string" ? v.title : "",
    consentedAt: v.consentedAt,
  };
}
