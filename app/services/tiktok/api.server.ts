export const TIKTOK_AUTHORIZE_BASE = "https://www.tiktok.com/v2/auth/authorize/";
export const TIKTOK_TOKEN_URL = "https://open.tiktokapis.com/v2/oauth/token/";
export const TIKTOK_USER_INFO_URL = "https://open.tiktokapis.com/v2/user/info/";
export const TIKTOK_INBOX_UPLOAD_INIT_URL =
  "https://open.tiktokapis.com/v2/post/publish/inbox/video/init/";

// Achado ao vivo, 22/09/2026: "user.info.basic" e "video.upload" não
// existem como escopos de usuário de verdade neste app (nem aparecem na
// lista de "Add scopes" do TikTok for Developers) — pedir eles na
// autorização derrubava o login inteiro com um erro genérico de
// "client_key" que na real era o escopo sendo rejeitado. user.info.profile
// é o único que existe e já cobre open_id + username (o que
// getTikTokAccount usa). O direito de enviar pra caixa de rascunhos do
// TikTok (Content Posting API em modo inbox, sem a auditoria de Direct
// Post) vem de o PRODUTO Content Posting API estar habilitado no app, não
// de um escopo separado do usuário — por isso não falta nada aqui pra
// uploadVideoToInbox funcionar.
export const TIKTOK_SCOPES = ["user.info.profile"].join(",");

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
