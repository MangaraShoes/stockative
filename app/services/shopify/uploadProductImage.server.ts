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
  const { buffer, mimeType } = dataUrlToBuffer(params.imageDataUrl);

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
            resource: "IMAGE",
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
        media: [{ originalSource: target.resourceUrl, mediaContentType: "IMAGE", alt: params.alt }],
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
