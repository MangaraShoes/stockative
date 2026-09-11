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
): Promise<void> {
  const deadline = Date.now() + CONTAINER_POLL_TIMEOUT_MS;

  while (Date.now() < deadline) {
    const json = await graphApiRequest<{ status_code: string }>(`/${containerId}`, {
      access_token: target.pageAccessToken,
      fields: "status_code",
    });

    if (json.status_code === "FINISHED") return;
    if (json.status_code === "ERROR" || json.status_code === "EXPIRED") {
      throw new Error(`Instagram media container failed to process (status: ${json.status_code}).`);
    }

    await new Promise((resolve) => setTimeout(resolve, CONTAINER_POLL_INTERVAL_MS));
  }

  throw new Error("Timed out waiting for Instagram to process the media container.");
}

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
