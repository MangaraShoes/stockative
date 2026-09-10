// Versão da Graph API — Meta muda isso com frequência, reconfirmar
// periodicamente (verificado via busca em 10/09/2026).
export const GRAPH_API_VERSION = "v23.0";
export const GRAPH_API_BASE = `https://graph.facebook.com/${GRAPH_API_VERSION}`;
export const FACEBOOK_OAUTH_DIALOG_BASE = `https://www.facebook.com/${GRAPH_API_VERSION}/dialog/oauth`;

// Fluxo "Facebook Login for Business" (não o mais novo "Instagram API with
// Instagram Login") — necessário porque Business Discovery (referência de
// concorrentes, ver ARCHITECTURE.md) só existe nesse fluxo clássico.
export const META_SCOPES = [
  "pages_show_list",
  "instagram_basic",
  "instagram_content_publish",
  "pages_read_engagement",
].join(",");

export class MetaGraphApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MetaGraphApiError";
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
    );
  }
  return json as T;
}
