import sharp from "sharp";

function dataUrlToBuffer(dataUrl: string): Buffer {
  const base64 = dataUrl.split(",")[1] ?? dataUrl;
  return Buffer.from(base64, "base64");
}

function bufferToPngDataUrl(buffer: Buffer): string {
  return `data:image/png;base64,${buffer.toString("base64")}`;
}

// Um logo já tem "transparência real" se tiver canal alpha E pelo menos
// alguns pixels não totalmente opacos — um PNG sem fundo tratado normalmente
// vem com alpha=255 em todo pixel, mesmo tendo canal alpha.
async function hasRealTransparency(buffer: Buffer): Promise<boolean> {
  const image = sharp(buffer);
  const metadata = await image.metadata();
  if (!metadata.hasAlpha) return false;

  const { data, info } = await image
    .raw()
    .toBuffer({ resolveWithObject: true });
  const channels = info.channels;
  for (let i = 3; i < data.length; i += channels) {
    if (data[i] < 250) return true;
  }
  return false;
}

export class LogoNotTransparentError extends Error {
  constructor() {
    super("This image doesn't have a transparent background. Please upload a PNG with a transparent background.");
    this.name = "LogoNotTransparentError";
  }
}

function colorDistance(r1: number, g1: number, b1: number, r2: number, g2: number, b2: number) {
  return Math.sqrt((r1 - r2) ** 2 + (g1 - g2) ** 2 + (b1 - b2) ** 2);
}

// Só vale tentar remover o fundo automaticamente quando os 4 cantos da
// imagem concordam entre si numa cor — sinal de fundo sólido de cor única.
// Fundo com foto/gradiente/textura tem cantos que divergem, e não deve
// disparar a remoção automática (o resultado sairia ruim).
async function sampleCornersIfFlat(
  buffer: Buffer,
): Promise<{ r: number; g: number; b: number } | null> {
  const { data, info } = await sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;

  const offsets = [
    0,
    (width - 1) * channels,
    (height - 1) * width * channels,
    ((height - 1) * width + (width - 1)) * channels,
  ];
  const corners = offsets.map((o) => ({ r: data[o], g: data[o + 1], b: data[o + 2] }));

  for (let i = 0; i < corners.length; i++) {
    for (let j = i + 1; j < corners.length; j++) {
      const distance = colorDistance(
        corners[i].r, corners[i].g, corners[i].b,
        corners[j].r, corners[j].g, corners[j].b,
      );
      if (distance > 15) return null;
    }
  }

  const avg = corners.reduce(
    (acc, c) => ({ r: acc.r + c.r / 4, g: acc.g + c.g / 4, b: acc.b + c.b / 4 }),
    { r: 0, g: 0, b: 0 },
  );
  return avg;
}

// Remove um fundo de cor sólida já confirmada: torna transparente qualquer
// pixel parecido o bastante com ela.
async function removeSolidBackground(
  buffer: Buffer,
  background: { r: number; g: number; b: number },
): Promise<Buffer | null> {
  const { data, info } = await sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;

  const threshold = 30;
  let transparentPixels = 0;
  let opaquePixels = 0;
  const totalPixels = width * height;
  for (let i = 0; i < data.length; i += channels) {
    const distance = colorDistance(data[i], data[i + 1], data[i + 2], background.r, background.g, background.b);
    if (distance < threshold) {
      data[i + 3] = 0;
      transparentPixels++;
    } else {
      opaquePixels++;
    }
  }

  // Sanity check: precisa ter removido pelo menos algum fundo (senão os
  // cantos não eram mesmo o fundo) e sobrado pelo menos alguns pixels do
  // próprio logo (senão apagamos tudo, ex.: logo monocromático igual ao
  // fundo) — mas um logo de linhas finas legitimamente pode deixar só uma
  // fração pequena de pixels opacos, então o mínimo é baixo e absoluto.
  if (transparentPixels / totalPixels < 0.02) return null;
  if (opaquePixels < 20) return null;

  return sharp(data, { raw: { width, height, channels } }).png().toBuffer();
}

// Valida e normaliza um logo recém-enviado pela lojista, sempre retornando
// como data URI PNG. Se já tem transparência real, mantém como está. Se não
// tem mas o fundo é claramente de cor sólida, remove automaticamente sem
// perguntar nada — é o caso comum (logo exportado com fundo branco). Só
// rejeita, pedindo um PNG transparente, quando não dá pra saber com
// segurança qual é o fundo (foto, gradiente, textura).
export async function prepareLogo(logoDataUrl: string): Promise<string> {
  const buffer = dataUrlToBuffer(logoDataUrl);

  if (await hasRealTransparency(buffer)) {
    return bufferToPngDataUrl(await sharp(buffer).png().toBuffer());
  }

  const flatBackground = await sampleCornersIfFlat(buffer);
  if (flatBackground) {
    const withoutBackground = await removeSolidBackground(buffer, flatBackground);
    if (withoutBackground) return bufferToPngDataUrl(withoutBackground);
  }

  throw new LogoNotTransparentError();
}

// Sobrepõe o logo já preparado no canto inferior direito da imagem gerada.
// O logo é redimensionado pra ~14% da largura da imagem principal, com uma
// margem proporcional — nunca desenhado pela IA, só composição determinística.
export async function applyLogoOverlay(
  imageDataUrl: string,
  logoDataUrl: string,
): Promise<string> {
  const imageBuffer = dataUrlToBuffer(imageDataUrl);
  const logoBuffer = dataUrlToBuffer(logoDataUrl);

  const baseImage = sharp(imageBuffer);
  const baseMetadata = await baseImage.metadata();
  const baseWidth = baseMetadata.width ?? 1024;

  const logoWidth = Math.round(baseWidth * 0.14);
  const margin = Math.round(baseWidth * 0.03);

  const resizedLogo = await sharp(logoBuffer)
    .resize({ width: logoWidth })
    .png()
    .toBuffer();

  // sharp's "northeast" gravity places flush against the edge — pad the
  // logo itself with transparent margin so it doesn't touch the corner.
  // Canto superior direito, não inferior: o produto costuma ocupar a parte
  // de baixo do quadro (ex.: o sapato nos pés), então um logo embaixo
  // competiria visualmente com ele (Patricia, 11/09/2026).
  const paddedLogo = await sharp(resizedLogo)
    .extend({
      top: margin,
      bottom: margin,
      left: margin,
      right: margin,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toBuffer();

  const finalImage = await baseImage
    .composite([{ input: paddedLogo, gravity: "northeast" }])
    .png()
    .toBuffer();

  return bufferToPngDataUrl(finalImage);
}
