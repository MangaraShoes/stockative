// Versão da Graph API — Meta muda isso com frequência, reconfirmar
// periodicamente (verificado via busca em 10/09/2026).
export const GRAPH_API_VERSION = "v23.0";
export const GRAPH_API_BASE = `https://graph.facebook.com/${GRAPH_API_VERSION}`;
export const FACEBOOK_OAUTH_DIALOG_BASE = `https://www.facebook.com/${GRAPH_API_VERSION}/dialog/oauth`;

// Fluxo "Facebook Login for Business" (não o mais novo "Instagram API with
// Instagram Login") — necessário porque Business Discovery (referência de
// concorrentes, ver ARCHITECTURE.md) só existe nesse fluxo clássico.
// O painel "API setup with Facebook login" do próprio app na Meta listava
// `instagram_content_publishing`, mas o dialog real de OAuth rejeitou esse
// nome ao vivo em 10/09/2026 ("Invalid Scope... check lower letter case or
// delimiter") — só essa permissão foi rejeitada, as outras 4 passaram.
// Tentando `instagram_content_publish` (sem "-ing") em seguida — nem o
// painel do app nem busca na web bateram com o que o endpoint de fato
// aceitou até agora, então isso só fica confirmado depois de testar ao vivo.
export const META_SCOPES = [
  "pages_show_list",
  "pages_read_engagement",
  "business_management",
  "instagram_basic",
  "instagram_content_publish",
].join(",");

export class MetaGraphApiError extends Error {
  // Código numérico do erro da Meta (ex.: 10 = "Application does not have
  // permission for this action", geralmente falta de Advanced Access via
  // App Review, não conta inválida — precisa ser distinguido de "não
  // encontrado" nos callers, ver businessDiscovery.server.ts).
  code: number | null;

  constructor(message: string, code: number | null = null) {
    super(message);
    this.name = "MetaGraphApiError";
    this.code = code;
  }
}

export async function graphApiRequest<T>(
  path: string,
  params: Record<string, string>,
  method: "GET" | "POST" = "GET",
): Promise<T> {
  const url = new URL(`${GRAPH_API_BASE}${path}`);
  const searchParams = new URLSearchParams(params);

  const response = await fetch(
    method === "GET" ? `${url}?${searchParams}` : url,
    method === "POST"
      ? { method: "POST", body: searchParams }
      : { method: "GET" },
  );

  const json = await response.json();
  if (!response.ok || json.error) {
    throw new MetaGraphApiError(
      json.error?.message ?? `Meta Graph API request failed (${response.status})`,
      typeof json.error?.code === "number" ? json.error.code : null,
    );
  }
  return json as T;
}
