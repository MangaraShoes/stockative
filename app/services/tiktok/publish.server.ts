import {
  TIKTOK_CREATOR_INFO_URL,
  TIKTOK_DIRECT_POST_INIT_URL,
  TIKTOK_PUBLISH_STATUS_URL,
  TikTokApiError,
  tiktokApiRequest,
} from "./api.server";
import {
  TIKTOK_PRIVACY_LEVELS,
  type TikTokCreatorInfo,
  type TikTokPostSettings,
  type TikTokPrivacyLevel,
} from "./postSettings";

export interface TikTokTarget {
  accessToken: string;
}

interface CreatorInfoResponse {
  creator_avatar_url?: string;
  creator_username?: string;
  creator_nickname?: string;
  privacy_level_options?: string[];
  comment_disabled?: boolean;
  duet_disabled?: boolean;
  stitch_disabled?: boolean;
  max_video_post_duration_sec?: number;
}

// Consulta obrigatória antes de cada Direct Post (diretrizes do TikTok):
// quem é a conta, quais privacidades ela aceita, se comentário/duet/stitch
// estão desligados na conta, e a duração máxima de vídeo. Também é o que
// diz se a conta bateu o limite diário de posts — nesse caso a própria
// chamada falha com spam_risk_* e o post não é enviado.
export async function queryTikTokCreatorInfo(target: TikTokTarget): Promise<TikTokCreatorInfo> {
  const data = await tiktokApiRequest<CreatorInfoResponse>(TIKTOK_CREATOR_INFO_URL, target.accessToken, {
    method: "POST",
  });
  return {
    nickname: data.creator_nickname ?? data.creator_username ?? "",
    username: data.creator_username ?? "",
    avatarUrl: data.creator_avatar_url ?? null,
    privacyLevelOptions: (data.privacy_level_options ?? []).filter((level): level is TikTokPrivacyLevel =>
      (TIKTOK_PRIVACY_LEVELS as readonly string[]).includes(level),
    ),
    commentDisabled: Boolean(data.comment_disabled),
    duetDisabled: Boolean(data.duet_disabled),
    stitchDisabled: Boolean(data.stitch_disabled),
    maxVideoPostDurationSec: data.max_video_post_duration_sec ?? 0,
  };
}

// Direct Post (Patricia, 30/09/2026) — substitui o antigo upload pra caixa
// de rascunhos: o vídeo sai direto no perfil, com a configuração que a
// lojista confirmou no Weekly Plan. PULL_FROM_URL exige o domínio do
// videoUrl verificado no TikTok for Developers (stockative.com, cobre
// app.stockative.com). Enquanto o app não passar pela auditoria do Direct
// Post, o TikTok só aceita post "Only me" e numa conta privada (erro
// unaudited_client_can_only_post_to_private_accounts) — limitação da
// plataforma, não do código.
//
// Retorna o publish_id — o post em si é processado de forma assíncrona,
// ver fetchTikTokPublishStatus.
export async function directPostVideoToTikTok(
  target: TikTokTarget,
  videoUrl: string,
  settings: TikTokPostSettings,
): Promise<string> {
  const data = await tiktokApiRequest<{ publish_id: string }>(TIKTOK_DIRECT_POST_INIT_URL, target.accessToken, {
    method: "POST",
    body: {
      post_info: {
        title: settings.title,
        privacy_level: settings.privacyLevel,
        disable_comment: !settings.allowComment,
        disable_duet: !settings.allowDuet,
        disable_stitch: !settings.allowStitch,
        brand_organic_toggle: settings.commercialContent && settings.brandOrganic,
        brand_content_toggle: settings.commercialContent && settings.brandedContent,
      },
      source_info: {
        source: "PULL_FROM_URL",
        video_url: videoUrl,
      },
    },
  });
  return data.publish_id;
}

// PROCESSING_DOWNLOAD / PROCESSING_UPLOAD → PUBLISH_COMPLETE ou FAILED
// (com fail_reason). SEND_TO_USER_INBOX só aparece em upload pra rascunho.
export async function fetchTikTokPublishStatus(target: TikTokTarget, publishId: string): Promise<string> {
  const data = await tiktokApiRequest<{ status: string; fail_reason?: string }>(
    TIKTOK_PUBLISH_STATUS_URL,
    target.accessToken,
    { method: "POST", body: { publish_id: publishId } },
  );
  return data.status === "FAILED" && data.fail_reason ? `FAILED: ${data.fail_reason}` : data.status;
}

const STATUS_POLL_INTERVAL_MS = 10 * 1000;
const STATUS_POLL_ATTEMPTS = 9;

// O TikTok baixa e processa o vídeo depois de aceitar o pedido — espera um
// pouco pelo resultado final, pra falha de verdade (ex.: vídeo rejeitado)
// aparecer no log e no status do post em vez de sumir. Não trava a
// publicação pra sempre: depois de ~90s devolve o último status visto.
export async function waitForTikTokPublishResult(target: TikTokTarget, publishId: string): Promise<string> {
  let status = "PROCESSING_DOWNLOAD";
  for (let attempt = 0; attempt < STATUS_POLL_ATTEMPTS; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, STATUS_POLL_INTERVAL_MS));
    try {
      status = await fetchTikTokPublishStatus(target, publishId);
    } catch (error) {
      if (error instanceof TikTokApiError && error.code === "rate_limit_exceeded") continue;
      throw error;
    }
    if (status === "PUBLISH_COMPLETE" || status.startsWith("FAILED")) break;
  }
  return status;
}
