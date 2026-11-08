import sharp from "sharp";

// Enquadra uma imagem no canvas vertical do Reel ANTES do movimento — sem
// isso o zoom cortava o produto nas fotos de estúdio (03/11/2026, protótipo
// com o mocassim Cipó: no zoom máximo o bico e o calcanhar saíam do quadro).
// Canvas maior que o vídeo final (1080x1920) pro zoompan não tremer.
export const REEL_FRAME_WIDTH = 1404;
export const REEL_FRAME_HEIGHT = 2496;

// Produto de estúdio nunca ocupa mais que isso do quadro em zoom 1 — sobra
// margem pro zoom máximo (STUDIO_MAX_ZOOM em buildReel.server.ts).
const MAX_PRODUCT_WIDTH_SHARE = 0.78;
const MAX_PRODUCT_HEIGHT_SHARE = 0.7;

// Desvio-padrão máximo (0-255, por canal) da borda da imagem pra contar como
// fundo liso. Foto de estúdio com leve gradiente passa; cena com ambiente não.
const STUDIO_EDGE_MAX_STDDEV = 6;
const TRIM_THRESHOLD = 12;

export type ReelFrameKind = "studio" | "scene";

async function hasPlainEdges(input: Buffer): Promise<boolean> {
  const SAMPLE_WIDTH = 64;
  const SAMPLE_HEIGHT = 96;
  const RING = 2;
  const { data, info } = await sharp(input)
    .removeAlpha()
    .resize(SAMPLE_WIDTH, SAMPLE_HEIGHT, { fit: "fill" })
    .raw()
    .toBuffer({ resolveWithObject: true });

  const channels = info.channels;
  for (let channel = 0; channel < channels; channel++) {
    const values: number[] = [];
    for (let y = 0; y < SAMPLE_HEIGHT; y++) {
      for (let x = 0; x < SAMPLE_WIDTH; x++) {
        const onRing =
          x < RING || y < RING || x >= SAMPLE_WIDTH - RING || y >= SAMPLE_HEIGHT - RING;
        if (onRing) values.push(data[(y * SAMPLE_WIDTH + x) * channels + channel]);
      }
    }
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
    const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
    if (Math.sqrt(variance) > STUDIO_EDGE_MAX_STDDEV) return false;
  }
  return true;
}

// Caixa do produto dentro da foto de estúdio. null quando não dá pra achar
// (imagem toda lisa, ou o trim falha) — quem chama trata como cena.
async function findProductBox(input: Buffer, width: number, height: number) {
  try {
    const { info } = await sharp(input)
      .trim({ threshold: TRIM_THRESHOLD })
      .toBuffer({ resolveWithObject: true });
    const left = -(info.trimOffsetLeft ?? 0);
    const top = -(info.trimOffsetTop ?? 0);
    if (info.width >= width && info.height >= height) return null;
    return { left, top, width: info.width, height: info.height };
  } catch {
    return null;
  }
}

async function frameStudioImage(
  input: Buffer,
  width: number,
  height: number,
  box: { left: number; top: number; width: number; height: number },
  centerY: number,
): Promise<{ jpeg: Buffer; productBottom: number }> {
  // Nunca amplia além do que o corte normal já faria (produto em escala
  // real, sem "zoom" artificial): só reduz quando o produto não caberia.
  const coverScale = Math.max(REEL_FRAME_WIDTH / width, REEL_FRAME_HEIGHT / height);
  const scale = Math.min(
    coverScale,
    (REEL_FRAME_WIDTH * MAX_PRODUCT_WIDTH_SHARE) / box.width,
    (REEL_FRAME_HEIGHT * MAX_PRODUCT_HEIGHT_SHARE) / box.height,
  );
  const scaledWidth = Math.round(width * scale);
  const scaledHeight = Math.round(height * scale);

  // Produto centralizado no quadro (na vertical, em centerY).
  const left = Math.round(REEL_FRAME_WIDTH / 2 - (box.left + box.width / 2) * scale);
  const top = Math.round(REEL_FRAME_HEIGHT * centerY - (box.top + box.height / 2) * scale);

  const extendLeft = Math.max(0, left);
  const extendTop = Math.max(0, top);
  const extendRight = Math.max(0, REEL_FRAME_WIDTH - (left + scaledWidth));
  const extendBottom = Math.max(0, REEL_FRAME_HEIGHT - (top + scaledHeight));

  // extendWith "copy" repete a borda da própria foto: sem caixa visível
  // quando o fundo tem gradiente, o que uma cor única deixaria aparecer.
  const extended = await sharp(input)
    .resize(scaledWidth, scaledHeight)
    .extend({
      left: extendLeft,
      top: extendTop,
      right: extendRight,
      bottom: extendBottom,
      extendWith: "copy",
    })
    .toBuffer();

  const jpeg = await sharp(extended)
    .extract({
      left: Math.max(0, -left),
      top: Math.max(0, -top),
      width: REEL_FRAME_WIDTH,
      height: REEL_FRAME_HEIGHT,
    })
    .jpeg({ quality: 92 })
    .toBuffer();
  return { jpeg, productBottom: REEL_FRAME_HEIGHT * centerY + (box.height * scale) / 2 };
}

// productBottom: onde o produto termina no quadro (só estúdio), para a
// legenda ir embaixo dele e não em cima. centerY < 0.5 sobe o produto de
// estúdio e deixa espaço para a legenda embaixo.
export async function frameImageForReel(
  input: Buffer,
  { centerY = 0.5 }: { centerY?: number } = {},
): Promise<{ jpeg: Buffer; kind: ReelFrameKind; productBottom?: number }> {
  const { width, height } = await sharp(input).metadata();

  if (width && height && (await hasPlainEdges(input))) {
    const box = await findProductBox(input, width, height);
    if (box) {
      return { ...(await frameStudioImage(input, width, height, box, centerY)), kind: "studio" };
    }
  }

  // Cena com ambiente: não dá pra estender o fundo, então segue o corte
  // central de sempre (mesmo do Reel estático).
  const jpeg = await sharp(input)
    .resize(REEL_FRAME_WIDTH, REEL_FRAME_HEIGHT, { fit: "cover", position: "centre" })
    .jpeg({ quality: 92 })
    .toBuffer();
  return { jpeg, kind: "scene" };
}
