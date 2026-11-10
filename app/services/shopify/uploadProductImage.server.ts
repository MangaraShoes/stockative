import prisma from "../../db.server";

interface AdminGraphqlClient {
  graphql: (query: string, options?: { variables?: Record<string, unknown> }) => Promise<Response>;
}

function dataUrlToBuffer(dataUrl: string): { buffer: Buffer; mimeType: string } {
  const match = dataUrl.match(/^data:(.+);base64,(.*)$/);
  if (!match) throw new Error("Expected a base64 data URL.");
  return { buffer: Buffer.from(match[2], "base64"), mimeType: match[1] };
}

// Sobe uma imagem gerada pela IA (guardada como data: URL base64 em
// CreativeAsset.imageUrl) pra galeria de imagens do produto de verdade na
// Shopify — pedido da Patricia, 12/09/2026: opção manual de salvar a
// editorial gerada como foto real do produto, não só usar pra post social.
// Precisa do escopo write_products (adicionado em shopify.app.toml).
//
// Fluxo em 2 passos exigido pela Admin API — não dá pra mandar a imagem
// direto: primeiro pede uma URL assinada de upload (stagedUploadsCreate),
// sobe o binário nela, e só depois anexa esse resourceUrl ao produto
// (productCreateMedia). A nova mídia entra no FIM da galeria por padrão —
// nunca substitui a foto principal, então não muda a vitrine da loja
// (Patricia: "assim não altera o design do produto na loja").
export async function uploadGeneratedImageToProduct(
  admin: AdminGraphqlClient,
  params: { shopifyProductId: string; imageDataUrl: string; filename: string; alt: string },
): Promise<{ status: "success" } | { status: "error"; reason: string }> {
  return uploadMediaToProduct(admin, {
    kind: "IMAGE",
    shopifyProductId: params.shopifyProductId,
    dataUrl: params.imageDataUrl,
    filename: params.filename,
    alt: params.alt,
  });
}

// Mesmo fluxo de 2 passos, com resource/mediaContentType VIDEO. A Shopify
// processa o vídeo depois de anexado (status PROCESSING), então ele leva uns
// minutos pra aparecer na página do produto.
async function uploadMediaToProduct(
  admin: AdminGraphqlClient,
  params: { kind: "IMAGE" | "VIDEO"; shopifyProductId: string; dataUrl: string; filename: string; alt: string },
): Promise<{ status: "success" } | { status: "error"; reason: string }> {
  const { buffer, mimeType } = dataUrlToBuffer(params.dataUrl);

  const stagedResponse = await admin.graphql(
    `#graphql
      mutation stockativeStagedUpload($input: [StagedUploadInput!]!) {
        stagedUploadsCreate(input: $input) {
          stagedTargets {
            url
            resourceUrl
            parameters { name value }
          }
          userErrors { field message }
        }
      }`,
    {
      variables: {
        input: [
          {
            resource: params.kind,
            filename: params.filename,
            mimeType,
            httpMethod: "POST",
            fileSize: String(buffer.length),
          },
        ],
      },
    },
  );
  const stagedJson = await stagedResponse.json();
  const stagedErrors = stagedJson.data?.stagedUploadsCreate?.userErrors ?? [];
  if (stagedErrors.length > 0) {
    return { status: "error", reason: stagedErrors.map((e: { message: string }) => e.message).join("; ") };
  }
  const target = stagedJson.data?.stagedUploadsCreate?.stagedTargets?.[0];
  if (!target) return { status: "error", reason: "Shopify didn't return an upload target." };

  // O upload em si é um POST multipart direto pro storage (S3), fora da
  // Admin API — os `parameters` retornados têm que ir ANTES do campo do
  // arquivo, essa ordem é exigida pelo backend de upload.
  const form = new FormData();
  for (const { name, value } of target.parameters as { name: string; value: string }[]) {
    form.append(name, value);
  }
  form.append("file", new Blob([Uint8Array.from(buffer)], { type: mimeType }), params.filename);

  const uploadResponse = await fetch(target.url, { method: "POST", body: form });
  if (!uploadResponse.ok) {
    return { status: "error", reason: `Upload to storage failed (${uploadResponse.status}).` };
  }

  const mediaResponse = await admin.graphql(
    `#graphql
      mutation stockativeCreateMedia($productId: ID!, $media: [CreateMediaInput!]!) {
        productCreateMedia(productId: $productId, media: $media) {
          media { alt mediaContentType status }
          mediaUserErrors { field message }
        }
      }`,
    {
      variables: {
        productId: params.shopifyProductId,
        media: [{ originalSource: target.resourceUrl, mediaContentType: params.kind, alt: params.alt }],
      },
    },
  );
  const mediaJson = await mediaResponse.json();
  const mediaErrors = mediaJson.data?.productCreateMedia?.mediaUserErrors ?? [];
  if (mediaErrors.length > 0) {
    return { status: "error", reason: mediaErrors.map((e: { message: string }) => e.message).join("; ") };
  }

  return { status: "success" };
}

// Botão "Save image to Shopify" (Patricia, 04/11/2026): a imagem principal do
// post vai à galeria sem esperar a publicação, e a publicação não a repete.
export async function saveHeroImageToShopify(
  admin: AdminGraphqlClient,
  params: { shopId: string; contentItemId: string },
): Promise<{ status: "success" } | { status: "error"; reason: string }> {
  const item = await prisma.contentItem.findFirst({
    where: { id: params.contentItemId, shopId: params.shopId },
    include: {
      product: true,
      images: { where: { position: 1 }, include: { creativeAsset: true } },
    },
  });
  const asset = item?.images[0]?.creativeAsset;
  if (!item?.product || !asset) {
    return { status: "error", reason: "This post has no AI image to save." };
  }

  // Reserva antes de enviar: um clique duplo não duplica a foto na loja.
  const claimed = await prisma.creativeAsset.updateMany({
    where: { id: asset.id, savedToShopifyAt: null },
    data: { savedToShopifyAt: new Date() },
  });
  if (claimed.count === 0) return { status: "success" };

  const result = await uploadGeneratedImageToProduct(admin, {
    shopifyProductId: item.product.shopifyProductId,
    imageDataUrl: asset.imageUrl,
    filename: `${item.product.title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-ai-editorial.jpg`,
    alt: `${item.product.title} — AI-generated editorial photo`,
  }).catch((error: unknown) => {
    console.error(`Failed to save image of content item ${item.id} to Shopify:`, error);
    return { status: "error" as const, reason: "We couldn't save this image to Shopify. Please try again." };
  });
  if (result.status === "error") {
    await prisma.creativeAsset.update({ where: { id: asset.id }, data: { savedToShopifyAt: null } });
  }
  return result;
}


// Botão "Save Reel to Shopify" (Patricia, 10/11/2026): só manual, nunca na
// publicação — o Reel tem texto na tela e legendas, e nem toda loja quer vídeo
// na página do produto. Entra no fim da galeria, como a imagem.
export async function saveReelToShopify(
  admin: AdminGraphqlClient,
  params: { shopId: string; contentItemId: string },
): Promise<{ status: "success" } | { status: "error"; reason: string }> {
  const item = await prisma.contentItem.findFirst({
    where: { id: params.contentItemId, shopId: params.shopId },
    select: { id: true, videoUrl: true, product: { select: { title: true, shopifyProductId: true } } },
  });
  if (!item?.product || !item.videoUrl?.startsWith("data:")) {
    return { status: "error", reason: "This post has no Reel to save." };
  }
  const videoUrl = item.videoUrl;

  // Reserva antes de enviar, e só pra este vídeo: se ele mudou no meio, a
  // reserva não pega e nada sobe.
  const claimed = await prisma.contentItem.updateMany({
    where: { id: item.id, videoSavedToShopifyAt: null, videoUrl },
    data: { videoSavedToShopifyAt: new Date() },
  });
  if (claimed.count === 0) return { status: "success" };

  const result = await uploadMediaToProduct(admin, {
    kind: "VIDEO",
    shopifyProductId: item.product.shopifyProductId,
    dataUrl: videoUrl,
    filename: `${item.product.title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-reel.mp4`,
    alt: `${item.product.title} — video`,
  }).catch((error: unknown) => {
    console.error(`Failed to save Reel of content item ${item.id} to Shopify:`, error);
    return { status: "error" as const, reason: "We couldn't save this Reel to Shopify. Please try again." };
  });
  if (result.status === "error") {
    await prisma.contentItem.update({ where: { id: item.id }, data: { videoSavedToShopifyAt: null } });
  }
  return result;
}
