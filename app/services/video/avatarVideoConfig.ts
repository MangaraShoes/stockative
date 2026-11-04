// Só a Mangará por enquanto (Patricia, 04/11/2026): ainda falta confirmar nos
// termos do HeyGen o uso para clientes do app e como ficam dados de rosto e voz
// na Europa. Abrir para outras lojas é acrescentar o domínio aqui.
const AVATAR_VIDEO_SHOPS = new Set(["cdcfc8-47.myshopify.com"]);

export function isAvatarVideoEnabled(shopDomain: string | null | undefined): boolean {
  return Boolean(shopDomain && AVATAR_VIDEO_SHOPS.has(shopDomain));
}

export const MAX_AVATAR_VIDEO_ATTEMPTS = 3;
export const MAX_AVATAR_SCRIPT_CHARS = 840;

// Medido em 04/11/2026: 75 caracteres em francês deram 5,25s e custaram $0,20
// (Avatar IV, 1080p). É estimativa para a lojista decidir, não o valor cobrado.
const CHARS_PER_SECOND = 14;
const USD_PER_SECOND = 0.04;

export function estimateAvatarVideoCostUsd(script: string): number {
  return (script.trim().length / CHARS_PER_SECOND) * USD_PER_SECOND;
}
