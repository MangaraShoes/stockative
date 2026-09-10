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

// Publica um único post de imagem. `imageUrl` precisa ser um JPEG
// publicamente acessível no momento da chamada (exigência da Graph API).
export async function publishSingleImage(
  target: PublishTarget,
  imageUrl: string,
  caption: string,
): Promise<string> {
  const containerId = await createContainer(target, { image_url: imageUrl, caption });
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
    imageUrls.map((imageUrl) =>
      createContainer(target, { image_url: imageUrl, is_carousel_item: "true" }),
    ),
  );

  const parentContainerId = await createContainer(target, {
    media_type: "CAROUSEL",
    children: childIds.join(","),
    caption,
  });

  return publishContainer(target, parentContainerId);
}
