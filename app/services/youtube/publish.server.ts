import { YOUTUBE_UPLOAD_URL } from "./api.server";

export interface YouTubeTarget {
  accessToken: string;
}

// Diferente do Meta/TikTok (pull-from-URL — a plataforma busca os bytes
// numa URL pública nossa), o videos.insert do YouTube não aceita URL: exige
// receber os bytes do vídeo direto num upload multipart/related (1ª parte
// = metadata JSON, 2ª parte = o vídeo em si). Publica público e direto,
// sem etapa de rascunho/confirmação manual (decisão de Patricia, 25/09/2026
// — diferente do TikTok, que só entrega na caixa de rascunhos por falta de
// aprovação do Direct Post). "#Shorts" na descrição + o próprio vídeo
// vertical curto é o sinal que o YouTube usa pra classificar como Short.
export async function uploadShort(
  target: YouTubeTarget,
  videoBuffer: Buffer,
  metadata: { title: string; description: string },
): Promise<string> {
  const boundary = "stockative_youtube_upload_boundary";
  const snippet = {
    snippet: {
      title: metadata.title,
      description: `${metadata.description}\n\n#Shorts`,
      categoryId: "26", // Howto & Style — melhor encaixe genérico pra conteúdo de moda/produto entre as categorias fixas do YouTube
    },
    status: {
      privacyStatus: "public",
      selfDeclaredMadeForKids: false,
    },
  };

  const body = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(snippet)}\r\n--${boundary}\r\nContent-Type: video/mp4\r\n\r\n`,
    ),
    videoBuffer,
    Buffer.from(`\r\n--${boundary}--`),
  ]);

  const response = await fetch(`${YOUTUBE_UPLOAD_URL}?uploadType=multipart&part=snippet,status`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${target.accessToken}`,
      "Content-Type": `multipart/related; boundary=${boundary}`,
      "Content-Length": String(body.length),
    },
    body,
  });

  const json = (await response.json()) as { id?: string; error?: { message?: string } };
  if (!response.ok || !json.id) {
    throw new Error(json.error?.message ?? `YouTube upload failed (${response.status})`);
  }
  return json.id;
}
