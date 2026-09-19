import { graphApiRequest } from "./graphApi.server";

export interface PublishTarget {
  igBusinessAccountId: string;
  pageAccessToken: string;
}

async function createContainer(
  target: PublishTarget,
  params: Record<string, string>,
): Promise<string> {
  const json = await graphApiRequest<{ id: string }>(
    `/${target.igBusinessAccountId}/media`,
    { access_token: target.pageAccessToken, ...params },
    "POST",
  );
  return json.id;
}

async function publishContainer(
  target: PublishTarget,
  creationId: string,
): Promise<string> {
  const json = await graphApiRequest<{ id: string }>(
    `/${target.igBusinessAccountId}/media_publish`,
    { access_token: target.pageAccessToken, creation_id: creationId },
    "POST",
  );
  return json.id;
}

const CONTAINER_POLL_INTERVAL_MS = 1500;
const CONTAINER_POLL_TIMEOUT_MS = 30_000;

// A Graph API baixa/processa a imagem do container de forma assíncrona
// depois de criado — chamar media_publish (ou referenciar o container como
// filho de um carrossel) antes disso termina falhando com "Media ID is not
// available" (erro 9007/subcode 2207027), mesmo com a URL da imagem
// perfeitamente acessível. Nunca foi testado de ponta a ponta antes de
// 10/09/2026 — esse polling não existia. Espera o status virar FINISHED
// (ou falha explicitamente em ERROR/EXPIRED) antes de seguir.
async function waitForContainerReady(
  target: PublishTarget,
  containerId: string,
  pollIntervalMs = CONTAINER_POLL_INTERVAL_MS,
  timeoutMs = CONTAINER_POLL_TIMEOUT_MS,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const json = await graphApiRequest<{ status_code: string }>(`/${containerId}`, {
      access_token: target.pageAccessToken,
      fields: "status_code",
    });

    if (json.status_code === "FINISHED") return;
    if (json.status_code === "ERROR" || json.status_code === "EXPIRED") {
      throw new Error(`Instagram media container failed to process (status: ${json.status_code}).`);
    }

    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  throw new Error("Timed out waiting for Instagram to process the media container.");
}

// Vídeo demora muito mais que imagem pra processar — a própria Meta
// recomenda checar a cada ~1min por até 5min (pesquisa feita em 14/09/2026
// contra a documentação ao vivo antes de implementar Reels), bem diferente
// do polling rápido de imagem acima.
const VIDEO_CONTAINER_POLL_INTERVAL_MS = 5_000;
const VIDEO_CONTAINER_POLL_TIMEOUT_MS = 5 * 60 * 1000;

// Publica um único post de imagem. `imageUrl` precisa ser um JPEG
// publicamente acessível no momento da chamada (exigência da Graph API).
export async function publishSingleImage(
  target: PublishTarget,
  imageUrl: string,
  caption: string,
): Promise<string> {
  const containerId = await createContainer(target, { image_url: imageUrl, caption });
  await waitForContainerReady(target, containerId);
  return publishContainer(target, containerId);
}

// Publica um carrossel: um container por imagem (is_carousel_item=true),
// depois um container "pai" referenciando todos, depois publica o pai.
// A Graph API exige entre 2 e 10 itens num carrossel.
export async function publishCarousel(
  target: PublishTarget,
  imageUrls: string[],
  caption: string,
): Promise<string> {
  if (imageUrls.length < 2 || imageUrls.length > 10) {
    throw new Error(
      `Instagram carousels need between 2 and 10 images (got ${imageUrls.length})`,
    );
  }

  const childIds = await Promise.all(
    imageUrls.map(async (imageUrl) => {
      const childId = await createContainer(target, { image_url: imageUrl, is_carousel_item: "true" });
      await waitForContainerReady(target, childId);
      return childId;
    }),
  );

  const parentContainerId = await createContainer(target, {
    media_type: "CAROUSEL",
    children: childIds.join(","),
    caption,
  });
  await waitForContainerReady(target, parentContainerId);

  return publishContainer(target, parentContainerId);
}

// Publica um Story — SEM legenda, de propósito. Verificado ao vivo em
// 11/09/2026 depois de a Patricia questionar isso: um POST com `caption`
// nesse media_type não dá erro (a Graph API ignora parâmetro não
// reconhecido em silêncio), mas tentar LER esse campo de volta no mesmo
// container devolve "Tried accessing nonexisting field (caption)" — Stories
// genuinely não têm esse campo na API, confirmado, não é limitação nossa.
// Texto em Story só existe queimado na própria imagem (overlay), feature
// separada, não implementada ainda.
export async function publishStory(target: PublishTarget, imageUrl: string): Promise<string> {
  const containerId = await createContainer(target, { image_url: imageUrl, media_type: "STORIES" });
  await waitForContainerReady(target, containerId);
  return publishContainer(target, containerId);
}

// Publica um Reel: vídeo já montado (ver buildReel.server.ts, nunca gera
// pixel/frame novo por IA) a partir de imagens já aprovadas. share_to_feed
// fica sempre explícito — a documentação da Meta não deixa claro o default
// quando omitido (achado da pesquisa de 14/09/2026), então não dá pra confiar
// no comportamento implícito.
export async function publishReel(
  target: PublishTarget,
  videoUrl: string,
  caption: string,
): Promise<string> {
  const containerId = await createContainer(target, {
    media_type: "REELS",
    video_url: videoUrl,
    caption,
    share_to_feed: "true",
  });
  await waitForContainerReady(
    target,
    containerId,
    VIDEO_CONTAINER_POLL_INTERVAL_MS,
    VIDEO_CONTAINER_POLL_TIMEOUT_MS,
  );
  return publishContainer(target, containerId);
}

export interface FacebookPageTarget {
  pageId: string;
  pageAccessToken: string;
}

// Publica uma única foto na timeline da Página. Diferente do Instagram, a
// Graph API de Página não usa o fluxo container→publish: o próprio POST em
// /photos já cria o post publicado e devolve o post_id da Página (não o ID
// da foto) em post_id — é esse ID que queremos guardar.
async function publishFacebookPhoto(
  target: FacebookPageTarget,
  imageUrl: string,
  caption: string,
): Promise<string> {
  const json = await graphApiRequest<{ id: string; post_id?: string }>(
    `/${target.pageId}/photos`,
    { access_token: target.pageAccessToken, url: imageUrl, caption },
    "POST",
  );
  return json.post_id ?? json.id;
}

// Publica um álbum: sobe cada foto como "unpublished" (published=false, não
// aparece na timeline sozinha), depois cria um post no feed anexando todas
// via attached_media[N]={"media_fbid": "<id>"} — é assim que o Facebook
// monta um post com várias fotos, não existe "carrossel" como no Instagram.
async function publishFacebookAlbum(
  target: FacebookPageTarget,
  imageUrls: string[],
  caption: string,
): Promise<string> {
  const photoIds = await Promise.all(
    imageUrls.map(async (imageUrl) => {
      const json = await graphApiRequest<{ id: string }>(
        `/${target.pageId}/photos`,
        { access_token: target.pageAccessToken, url: imageUrl, published: "false" },
        "POST",
      );
      return json.id;
    }),
  );

  const attachedMediaParams = Object.fromEntries(
    photoIds.map((id, index) => [`attached_media[${index}]`, JSON.stringify({ media_fbid: id })]),
  );

  const json = await graphApiRequest<{ id: string }>(
    `/${target.pageId}/feed`,
    { access_token: target.pageAccessToken, message: caption, ...attachedMediaParams },
    "POST",
  );
  return json.id;
}

// Espelha o mesmo post do Instagram (imagem(ns) + legenda) na Página do
// Facebook vinculada — pedido direto da Patricia, 11/09/2026: "precisamos
// fazer o mesmo post do IG no facebook". Usa o mesmo Page access token já
// obtido na conexão do Instagram (toda conta Instagram Business é
// tecnicamente acessada através de uma Página do Facebook).
export async function publishToFacebookPage(
  target: FacebookPageTarget,
  imageUrls: string[],
  caption: string,
): Promise<string> {
  return imageUrls.length === 1
    ? publishFacebookPhoto(target, imageUrls[0], caption)
    : publishFacebookAlbum(target, imageUrls, caption);
}

// Espelha um Reel como vídeo de verdade na Página (não como imagem) —
// Patricia, 14/09/2026: "cobre o Facebook mirror publicando como vídeo
// também". Diferente do Instagram, a Graph API de Página de novo não usa
// container→publish pra vídeo: POST em /videos com file_url já cria o post
// e devolve o ID do vídeo na hora (o processamento/transcodificação
// continua em segundo plano, mas o post já existe e é isso que guardamos).
// Ainda não testado ao vivo contra uma Página real — mesma ressalva que já
// vale pro resto do fluxo de vídeo: confirmar no primeiro post de verdade.
export async function publishFacebookVideo(
  target: FacebookPageTarget,
  videoUrl: string,
  caption: string,
): Promise<string> {
  const json = await graphApiRequest<{ id: string }>(
    `/${target.pageId}/videos`,
    { access_token: target.pageAccessToken, file_url: videoUrl, description: caption },
    "POST",
  );
  return json.id;
}
