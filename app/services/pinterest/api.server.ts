export const PINTEREST_API_BASE = "https://api.pinterest.com/v5";
export const PINTEREST_OAUTH_DIALOG_BASE = "https://www.pinterest.com/oauth/";
export const PINTEREST_TOKEN_URL = "https://api.pinterest.com/v5/oauth/token";

// pins:read/pins:write pra criar Pins, boards:read/boards:write pra listar
// boards existentes e criar um novo por categoria de produto,
// user_accounts:read pra ler /v5/user_account (username da conta conectada) —
// sem esse escopo o callback falha com "token does not have sufficient
// permissions" bem no passo de identificar a conta (visto ao vivo em
// 11/09/2026: faltava esse escopo na autorização).
export const PINTEREST_SCOPES = [
  "pins:read",
  "pins:write",
  "boards:read",
  "boards:write",
  "user_accounts:read",
].join(",");

export class PinterestApiError extends Error {
  code: number | null;

  constructor(message: string, code: number | null = null) {
    super(message);
    this.name = "PinterestApiError";
    this.code = code;
  }
}

export async function pinterestApiRequest<T>(
  path: string,
  accessToken: string,
  options: { method?: "GET" | "POST"; body?: Record<string, unknown> } = {},
): Promise<T> {
  const response = await fetch(`${PINTEREST_API_BASE}${path}`, {
    method: options.method ?? "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(options.body ? { "Content-Type": "application/json" } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  const json = await response.json();
  if (!response.ok) {
    throw new PinterestApiError(
      json?.message ?? `Pinterest API request failed (${response.status})`,
      typeof json?.code === "number" ? json.code : null,
    );
  }
  return json as T;
}
