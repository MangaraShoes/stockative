// Cliente da API do HeyGen. Cada loja usa a própria chave e paga o próprio uso.
// Rotas conferidas em developers.heygen.com e testadas com a conta da Mangará
// (04/11/2026).
const BASE_URL = "https://api.heygen.com";
const REQUEST_TIMEOUT_MS = 30_000;

export class HeyGenError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function request<T>(apiKey: string, path: string, init?: { method: string; body: unknown }): Promise<T> {
  const response = await fetch(`${BASE_URL}${path}`, {
    method: init?.method ?? "GET",
    headers: { "X-Api-Key": apiKey, "Content-Type": "application/json" },
    body: init ? JSON.stringify(init.body) : undefined,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const json = (await response.json().catch(() => null)) as
    | { data?: T; error?: { message?: string } | string | null; message?: string }
    | null;
  if (!response.ok) {
    const detail =
      (typeof json?.error === "string" ? json.error : json?.error?.message) ?? json?.message ?? "";
    throw new HeyGenError(`HeyGen ${response.status}: ${detail}`.trim(), response.status);
  }
  return json?.data as T;
}

export interface HeyGenLook {
  id: string;
  name: string;
  avatarType: string;
  previewImageUrl: string | null;
  defaultVoiceId: string | null;
}

export async function listHeyGenLooks(apiKey: string): Promise<HeyGenLook[]> {
  const data = await request<
    Array<{
      id: string;
      name: string;
      avatar_type: string;
      preview_image_url?: string | null;
      default_voice_id?: string | null;
    }>
  >(apiKey, "/v3/avatars/looks?ownership=private&limit=50");
  return (data ?? []).map((look) => ({
    id: look.id,
    name: look.name,
    avatarType: look.avatar_type,
    previewImageUrl: look.preview_image_url ?? null,
    defaultVoiceId: look.default_voice_id ?? null,
  }));
}

export interface HeyGenVoice {
  id: string;
  name: string;
  language: string;
}

export async function listHeyGenVoices(apiKey: string): Promise<HeyGenVoice[]> {
  const data = await request<Array<{ voice_id: string; name: string; language: string }>>(
    apiKey,
    "/v3/voices?type=private&limit=50",
  );
  return (data ?? []).map((voice) => ({ id: voice.voice_id, name: voice.name, language: voice.language }));
}

export async function createHeyGenAvatarVideo(
  apiKey: string,
  params: { avatarId: string; voiceId: string; script: string; title: string },
): Promise<string> {
  const data = await request<{ video_id: string }>(apiKey, "/v3/videos", {
    method: "POST",
    body: {
      type: "avatar",
      title: params.title,
      avatar_id: params.avatarId,
      voice_id: params.voiceId,
      script: params.script,
      resolution: "1080p",
      aspect_ratio: "9:16",
      engine: { type: "avatar_iv" },
    },
  });
  return data.video_id;
}

export interface HeyGenVideoStatus {
  status: string;
  videoUrl: string | null;
  failureMessage: string | null;
}

export async function getHeyGenVideo(apiKey: string, videoId: string): Promise<HeyGenVideoStatus> {
  const data = await request<{ status: string; video_url?: string | null; failure_message?: string | null }>(
    apiKey,
    `/v3/videos/${encodeURIComponent(videoId)}`,
  );
  return {
    status: data.status,
    videoUrl: data.video_url ?? null,
    failureMessage: data.failure_message ?? null,
  };
}
