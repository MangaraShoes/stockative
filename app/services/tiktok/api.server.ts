export const TIKTOK_AUTHORIZE_BASE = "https://www.tiktok.com/v2/auth/authorize/";
export const TIKTOK_TOKEN_URL = "https://open.tiktokapis.com/v2/oauth/token/";
export const TIKTOK_USER_INFO_URL = "https://open.tiktokapis.com/v2/user/info/";
export const TIKTOK_INBOX_UPLOAD_INIT_URL =
  "https://open.tiktokapis.com/v2/post/publish/inbox/video/init/";

// user.info.basic pro perfil da conta conectada (username, exibido em
// app.social.tsx); video.upload pra colocar o Reel na caixa de rascunhos do
// TikTok da lojista — modo que NÃO exige a auditoria de Direct Post da
// Content Posting API (Patricia, 20/09/2026: mitigação enquanto a auditoria
// não sai, mesmo raciocínio já usado pro Instagram em ARCHITECTURE.md).
// video.publish (postar direto, sem a lojista confirmar no app) fica de fora
// de propósito até a auditoria ser aprovada.
export const TIKTOK_SCOPES = ["user.info.basic", "video.upload"].join(",");

export class TikTokApiError extends Error {
  code: string | null;

  constructor(message: string, code: string | null = null) {
    super(message);
    this.name = "TikTokApiError";
    this.code = code;
  }
}

// Toda resposta da API v2 do TikTok vem envelopada em { data, error: { code,
// message, log_id } } — error.code é "ok" mesmo em chamadas bem-sucedidas,
// nunca ausente, então o jeito certo de detectar falha é comparar com "ok"
// explicitamente, não checar se o campo existe.
export async function tiktokApiRequest<T>(
  url: string,
  accessToken: string,
  options: { method?: "GET" | "POST"; body?: Record<string, unknown> } = {},
): Promise<T> {
  const response = await fetch(url, {
    method: options.method ?? "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json; charset=UTF-8",
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  const json = (await response.json()) as {
    data?: T;
    error?: { code: string; message: string; log_id?: string };
  };

  if (!response.ok || (json.error && json.error.code !== "ok")) {
    throw new TikTokApiError(
      json.error?.message ?? `TikTok API request failed (${response.status})`,
      json.error?.code ?? null,
    );
  }

  return json.data as T;
}
