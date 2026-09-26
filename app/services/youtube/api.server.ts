export const YOUTUBE_AUTH_BASE = "https://accounts.google.com/o/oauth2/v2/auth";
export const YOUTUBE_TOKEN_URL = "https://oauth2.googleapis.com/token";
export const YOUTUBE_CHANNELS_URL = "https://www.googleapis.com/youtube/v3/channels";
export const YOUTUBE_UPLOAD_URL = "https://www.googleapis.com/upload/youtube/v3/videos";

// youtube.readonly além de youtube.upload porque a documentação do Google
// não deixa claro se upload sozinho cobre a leitura de identidade do canal
// (channels.list) logo depois de conectar — pedir os dois evita um 403
// surpresa nessa chamada. Espaço, não vírgula, como o Google espera.
export const YOUTUBE_SCOPES = [
  "https://www.googleapis.com/auth/youtube.upload",
  "https://www.googleapis.com/auth/youtube.readonly",
].join(" ");

export class YouTubeApiError extends Error {
  code: number | null;

  constructor(message: string, code: number | null = null) {
    super(message);
    this.name = "YouTubeApiError";
    this.code = code;
  }
}

// Resposta padrão de erro do Google: { error: { code, message, errors } } —
// sucesso devolve o recurso direto, sem envelope (diferente do TikTok, que
// sempre embrulha em { data, error }).
export async function youtubeApiRequest<T>(url: string, accessToken: string): Promise<T> {
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  const json = (await response.json()) as T & {
    error?: { code: number; message: string };
  };

  if (!response.ok || json.error) {
    throw new YouTubeApiError(
      json.error?.message ?? `YouTube API request failed (${response.status})`,
      json.error?.code ?? null,
    );
  }

  return json;
}
