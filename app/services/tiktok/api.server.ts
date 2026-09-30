export const TIKTOK_AUTHORIZE_BASE = "https://www.tiktok.com/v2/auth/authorize/";
export const TIKTOK_TOKEN_URL = "https://open.tiktokapis.com/v2/oauth/token/";
export const TIKTOK_USER_INFO_URL = "https://open.tiktokapis.com/v2/user/info/";
export const TIKTOK_CREATOR_INFO_URL = "https://open.tiktokapis.com/v2/post/publish/creator_info/query/";
export const TIKTOK_DIRECT_POST_INIT_URL = "https://open.tiktokapis.com/v2/post/publish/video/init/";
export const TIKTOK_PUBLISH_STATUS_URL = "https://open.tiktokapis.com/v2/post/publish/status/fetch/";

// video.publish (Direct Post, Patricia, 30/09/2026: "o app deve poder postar
// sozinho sem precisar entrar no tiktok") — publica direto no perfil. Precisa
// do Direct Post ligado no produto Content Posting API do app no TikTok for
// Developers (Sandbox e Production); se o app pedir um escopo que não tem, o
// login inteiro falha com "Something went wrong – scope".
//
// Achado ao vivo, 30/09/2026: pedir video.upload JUNTO com video.publish
// derruba o login com esse mesmo erro de "scope", mesmo com os dois
// liberados no Sandbox — cada um sozinho funciona (testado com
// user.info.profile + um de cada vez). video.upload (caixa de rascunhos) não
// é mais usado desde a troca pro Direct Post, então fica de fora.
export const TIKTOK_SCOPES = ["user.info.profile", "video.publish"].join(",");
export const TIKTOK_REQUIRED_PUBLISH_SCOPE = "video.publish";

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
