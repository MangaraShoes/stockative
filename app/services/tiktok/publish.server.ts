import { TIKTOK_INBOX_UPLOAD_INIT_URL, tiktokApiRequest } from "./api.server";

export interface TikTokTarget {
  accessToken: string;
}

// "Upload to inbox": o vídeo cai na caixa de rascunhos do TikTok da própria
// lojista, e ela precisa abrir o app e confirmar a publicação de lá — modo
// que a Content Posting API libera SEM a auditoria de Direct Post (Patricia,
// 20/09/2026, mesma mitigação já usada pro Instagram enquanto o App Review
// não sai, ver ARCHITECTURE.md). PULL_FROM_URL exige que o domínio do
// videoUrl já esteja verificado no TikTok for Developers (feito via a
// verificação de "Domain" em stockative.com, que também cobre
// app.stockative.com como subdomínio).
//
// Retorna o publish_id — não é um post público, só um identificador do
// upload em si, usado aqui só pra não reenviar o mesmo vídeo de novo num
// retry (ver tiktokExternalPostId em ContentItem).
export async function uploadVideoToInbox(
  target: TikTokTarget,
  videoUrl: string,
): Promise<string> {
  const data = await tiktokApiRequest<{ publish_id: string }>(
    TIKTOK_INBOX_UPLOAD_INIT_URL,
    target.accessToken,
    {
      method: "POST",
      body: {
        source_info: {
          source: "PULL_FROM_URL",
          video_url: videoUrl,
        },
      },
    },
  );
  return data.publish_id;
}
