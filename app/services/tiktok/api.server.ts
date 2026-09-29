export const TIKTOK_AUTHORIZE_BASE = "https://www.tiktok.com/v2/auth/authorize/";
export const TIKTOK_TOKEN_URL = "https://open.tiktokapis.com/v2/oauth/token/";
export const TIKTOK_USER_INFO_URL = "https://open.tiktokapis.com/v2/user/info/";
export const TIKTOK_INBOX_UPLOAD_INIT_URL =
  "https://open.tiktokapis.com/v2/post/publish/inbox/video/init/";

// video.upload é o que libera o upload pra caixa de rascunhos
// (uploadVideoToInbox) — sem ele toda chamada falha com "The user did not
// authorize the scope required" (0 de 4 reels publicados até 27/09/2026, ver
// TIKTOK-API-REVIEW.md). O comentário antigo daqui (22/09/2026) dizia que
// video.upload "não existia": na real o app ainda não tinha o produto
// Content Posting API adicionado, então o escopo nem aparecia pra pedir, e
// pedir um escopo que o app não tem derruba o login inteiro. Achado ao vivo,
// 29/09/2026: com o produto adicionado no Sandbox, video.upload aparece na
// lista de Scopes. Precisa do mesmo produto adicionado também em Production
// (e aprovado na revisão) antes de usar as credenciais de produção.
export const TIKTOK_SCOPES = ["user.info.profile", "video.upload"].join(",");
export const TIKTOK_REQUIRED_PUBLISH_SCOPE = "video.upload";

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
