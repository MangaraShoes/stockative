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

// Valida e normaliza um logo recém-enviado pela lojista: exige que já tenha
// fundo transparente (PNG com canal alpha) — não tenta adivinhar/remover o
// fundo automaticamente, pra evitar resultado ruim em fundo com foto/textura.
// Retorna sempre como data URI PNG.
export async function prepareLogo(logoDataUrl: string): Promise<string> {
  const buffer = dataUrlToBuffer(logoDataUrl);

  if (!(await hasRealTransparency(buffer))) {
    throw new LogoNotTransparentError();
  }

  return bufferToPngDataUrl(await sharp(buffer).png().toBuffer());
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

  // sharp's "southeast" gravity places flush against the edge — pad the
  // logo itself with transparent margin so it doesn't touch the corner.
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
    .composite([{ input: paddedLogo, gravity: "southeast" }])
    .png()
    .toBuffer();

  return bufferToPngDataUrl(finalImage);
}
