import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { resolveFfmpegPath, runFfmpegCommand } from "./buildReel.server";
import { frameImageForReel } from "./reelFraming.server";
import { readVideoInfo } from "./uploadedVideo.server";
import { parseSilences, segmentsFromShots, sentenceSpans, splitSentences } from "./avatarShots.server";

const WIDTH = 1080;
const HEIGHT = 1920;
const FPS = 30;
const MAX_CUTAWAYS = 4;
// Produto maior no fechamento: 55% da tela (era 45%). Patricia, 08/11/2026:
// "mais destaque ao produto".
const SPLIT_TOP_HEIGHT = 860;
const SPLIT_BOTTOM_HEIGHT = HEIGHT - SPLIT_TOP_HEIGHT;
const COMPOSE_TIMEOUT_MS = 240_000;
const HOOK_SIZES = [
  { maxChars: 26, fontSize: 56 },
  { maxChars: 34, fontSize: 44 },
];

export interface AvatarSegment {
  kind: "avatar" | "image" | "split";
  start: number;
  end: number;
  imageIndex?: number;
}

// O avatar fala e o produto entra em fotos reais, nunca redesenhado pela IA
// (regra de fidelidade). Avatar abre, fotos no meio, avatar + produto no fim.
export function planAvatarSegments(durationSec: number, imageCount: number): AvatarSegment[] {
  const cutaways = Math.min(imageCount, MAX_CUTAWAYS);
  if (cutaways === 0 || durationSec < 6) return [{ kind: "avatar", start: 0, end: durationSec }];
  const introEnd = durationSec * 0.4;
  const outroStart = durationSec * 0.8;
  const each = (outroStart - introEnd) / cutaways;
  const segments: AvatarSegment[] = [{ kind: "avatar", start: 0, end: introEnd }];
  for (let index = 0; index < cutaways; index++) {
    segments.push({
      kind: "image",
      start: introEnd + each * index,
      end: introEnd + each * (index + 1),
      imageIndex: index,
    });
  }
  segments.push({ kind: "split", start: outroStart, end: durationSec, imageIndex: 0 });
  return segments;
}

function wrapWords(sentence: string, maxChars: number): string[] {
  const lines: string[] = [];
  let current = "";
  for (const word of sentence.split(/\s+/).filter(Boolean)) {
    if (current && `${current} ${word}`.length > maxChars) {
      lines.push(current);
      current = word;
    } else {
      current = current ? `${current} ${word}` : word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

// Primeira frase do roteiro. Frase longa usa letra menor em vez de sumir da
// tela (a primeira frase da Laurence, com 54 caracteres, ficou sem gancho).
export function hookLayout(script: string): { lines: string[]; fontSize: number } | null {
  const sentence = /^[^.!?]+[.!?]?/.exec(script.trim())?.[0].trim() ?? "";
  if (!sentence) return null;
  for (const { maxChars, fontSize } of HOOK_SIZES) {
    const lines = wrapWords(sentence, maxChars);
    if (lines.length <= 2) return { lines, fontSize };
  }
  const { maxChars, fontSize } = HOOK_SIZES[HOOK_SIZES.length - 1];
  const lines = wrapWords(sentence, maxChars);
  return lines.length <= 3 ? { lines, fontSize } : null;
}

function escapeXml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

async function renderHook(lines: string[], size: number, outputPath: string): Promise<void> {
  const lineHeight = Math.round(size * 1.28);
  const padding = 26;
  const boxX = 70;
  const boxWidth = WIDTH - 210; // os botões das redes ficam à direita
  const boxY = 1180;
  const boxHeight = lines.length * lineHeight + padding * 2 - 10;
  const text = lines
    .map(
      (line, index) =>
        `<text x="${boxX + boxWidth / 2}" y="${boxY + padding + size + index * lineHeight - 6}" text-anchor="middle" font-family="DejaVu Sans, Helvetica Neue, Helvetica, Arial, sans-serif" font-weight="600" font-size="${size}" fill="#fff">${escapeXml(line)}</text>`,
    )
    .join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}"><rect x="${boxX}" y="${boxY}" width="${boxWidth}" height="${boxHeight}" rx="20" fill="#000" fill-opacity="0.62"/>${text}</svg>`;
  await sharp(Buffer.from(svg)).png().toFile(outputPath);
}

const CAPTION_FONT_SIZE = 50;
const CAPTION_MAX_CHARS = 30;
const CAPTION_TOP_Y = 1180;
const CAPTION_BAND_HEIGHT = 200;

// Legenda de uma frase. Durante o fechamento (avatar em cima, produto embaixo)
// ela sobe para cima da divisão, para não cobrir o produto.
export function captionBox(
  text: string,
  overProductSplit: boolean,
): { lines: string[]; fontSize: number; y: number; height: number } | null {
  // No fechamento a metade de cima é pequena: letra menor, para cobrir só o
  // peito e não o rosto.
  let fontSize = overProductSplit ? 40 : CAPTION_FONT_SIZE;
  let lines = wrapWords(text, overProductSplit ? 38 : CAPTION_MAX_CHARS);
  if (lines.length > 3) {
    fontSize = 42;
    lines = wrapWords(text, 36);
  }
  if (lines.length === 0 || lines.length > 4) return null;
  const lineHeight = Math.round(fontSize * 1.28);
  const height = lines.length * lineHeight + 52 - 10;
  const y = overProductSplit ? SPLIT_TOP_HEIGHT + Math.max(8, (CAPTION_BAND_HEIGHT - height) / 2) : CAPTION_TOP_Y;
  return { lines, fontSize, y, height };
}

async function renderCaption(
  box: { lines: string[]; fontSize: number; y: number; height: number },
  outputPath: string,
): Promise<void> {
  const lineHeight = Math.round(box.fontSize * 1.28);
  const padding = 26;
  const boxX = 70;
  const boxWidth = WIDTH - 210; // os botões das redes ficam à direita
  const text = box.lines
    .map(
      (line, index) =>
        `<text x="${boxX + boxWidth / 2}" y="${box.y + padding + box.fontSize + index * lineHeight - 6}" text-anchor="middle" font-family="DejaVu Sans, Helvetica Neue, Helvetica, Arial, sans-serif" font-weight="600" font-size="${box.fontSize}" fill="#fff">${escapeXml(line)}</text>`,
    )
    .join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}"><rect x="${boxX}" y="${box.y}" width="${boxWidth}" height="${box.height}" rx="20" fill="#000" fill-opacity="0.62"/>${text}</svg>`;
  await sharp(Buffer.from(svg)).png().toFile(outputPath);
}

// Cartão mais largo que alto: sapato e bolsa de estúdio são horizontais.
const CARD_X = 40;
const CARD_Y = 820;
const CARD_WIDTH = 360;
const CARD_HEIGHT = 300;

// Foto de estúdio tem muita margem branca: o sapato saía minúsculo no cartão e
// no fechamento. Corta a margem e deixa uma folga de 6% em volta.
async function trimWhiteMargin(image: Buffer): Promise<Buffer> {
  try {
    const trimmed = await sharp(image).flatten({ background: "#ffffff" }).trim({ background: "#ffffff", threshold: 18 }).toBuffer({ resolveWithObject: true });
    const pad = Math.round(Math.max(trimmed.info.width, trimmed.info.height) * 0.06);
    return await sharp(trimmed.data)
      .extend({ top: pad, bottom: pad, left: pad, right: pad, background: "#ffffff" })
      .jpeg({ quality: 92 })
      .toBuffer();
  } catch {
    return image;
  }
}

// Cartão pequeno com a foto real do produto enquanto o avatar fala, para o
// produto aparecer desde o primeiro segundo.
async function renderProductCard(image: Buffer, outputPath: string): Promise<void> {
  const inner = await sharp(await trimWhiteMargin(image))
    .resize(CARD_WIDTH - 20, CARD_HEIGHT - 20, { fit: "contain", background: "#ffffff" })
    .flatten({ background: "#ffffff" })
    .png()
    .toBuffer();
  const mask = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${CARD_WIDTH}" height="${CARD_HEIGHT}"><rect width="${CARD_WIDTH}" height="${CARD_HEIGHT}" rx="22" fill="#fff"/></svg>`,
  );
  const card = await sharp({
    create: { width: CARD_WIDTH, height: CARD_HEIGHT, channels: 4, background: "#ffffff" },
  })
    .composite([
      { input: inner, left: 10, top: 10 },
      { input: mask, blend: "dest-in" },
    ])
    .png()
    .toBuffer();
  await sharp({ create: { width: WIDTH, height: HEIGHT, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: card, left: CARD_X, top: CARD_Y }])
    .png()
    .toFile(outputPath);
}

// Pausas da fala no próprio áudio do vídeo.
function readSilences(ffmpegPath: string, inputPath: string): Promise<number[]> {
  return new Promise((resolve) => {
    const proc = spawn(ffmpegPath, ["-hide_banner", "-i", inputPath, "-af", "silencedetect=n=-35dB:d=0.2", "-vn", "-f", "null", "-"]);
    let stderr = "";
    proc.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    proc.on("error", () => resolve([]));
    proc.on("close", () => resolve(parseSilences(stderr)));
  });
}

export async function buildAvatarReel(params: {
  avatarVideo: Buffer;
  images: Buffer[];
  script: string;
  // Foto de cada frase (índice em images, null = avatar), ver planAvatarShots.
  // Sem isso, os cortes são em tempos fixos.
  sentenceShots?: Array<number | null> | null;
  // Legenda de cada frase do roteiro (mesma ordem), já no idioma da tela.
  captions?: string[] | null;
}): Promise<Buffer> {
  const ffmpegPath = await resolveFfmpegPath();
  const workDir = await mkdtemp(path.join(tmpdir(), "avatar-reel-"));
  try {
    const avatarPath = path.join(workDir, "avatar.mp4");
    const outputPath = path.join(workDir, "output.mp4");
    await writeFile(avatarPath, params.avatarVideo);
    const info = await readVideoInfo(ffmpegPath, avatarPath);
    if (!info) throw new Error("Could not read the avatar video.");

    let segments = planAvatarSegments(info.durationSec, params.images.length);
    const sentences = splitSentences(params.script);
    const captions = params.captions && params.captions.length === sentences.length ? params.captions : null;
    const spans =
      params.sentenceShots || captions
        ? sentenceSpans(sentences, info.durationSec, await readSilences(ffmpegPath, avatarPath))
        : null;
    if (params.sentenceShots && spans) {
      const aligned = segmentsFromShots(spans, params.sentenceShots);
      // Fecha com o avatar acima do produto, como nos cortes fixos.
      const last = aligned[aligned.length - 1];
      if (aligned.some((segment) => segment.kind === "image") && last?.kind === "avatar") {
        last.kind = "split";
        segments = aligned;
      }
    }
    const inputs = ["-i", avatarPath];
    const filters = [
      `[0:v]scale=${WIDTH}:${HEIGHT}:force_original_aspect_ratio=increase,crop=${WIDTH}:${HEIGHT},fps=${FPS},format=yuv420p,setsar=1,split=${segments.length}${segments.map((_, i) => `[a${i}]`).join("")}`,
    ];
    let nextInput = 1;

    for (const [index, segment] of segments.entries()) {
      const duration = segment.end - segment.start;
      const trim = `trim=${segment.start.toFixed(3)}:${segment.end.toFixed(3)},setpts=PTS-STARTPTS`;
      filters.push(`[a${index}]${trim}[t${index}]`);

      if (segment.kind === "avatar") {
        filters.push(`[t${index}]null[s${index}]`);
        continue;
      }
      if (segment.kind === "image") {
        const source = params.images[segment.imageIndex ?? 0];
        const framed = await frameImageForReel(source);
        const imagePath = path.join(workDir, `image${index}.jpg`);
        await writeFile(imagePath, framed.jpeg);
        inputs.push("-i", imagePath);
        const frames = Math.max(1, Math.round(duration * FPS));
        filters.push(`[t${index}]nullsink`);
        filters.push(
          // Aproximação lenta, mais viva que foto parada (Patricia, 08/11/2026).
          `[${nextInput}:v]zoompan=z='1+0.10*on/${frames}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=${WIDTH}x${HEIGHT}:fps=${FPS},format=yuv420p,setsar=1[s${index}]`,
        );
      } else {
        // Foto de estúdio mostra o produto inteiro; cortar uma cena arrancava a
        // cabeça da modelo. Sem estúdio, a cena entra inteira, sem corte.
        const framedAll = await Promise.all(params.images.map((image) => frameImageForReel(image)));
        const studioIndex = framedAll.findIndex((framed) => framed.kind === "studio");
        const source =
          studioIndex >= 0 ? await trimWhiteMargin(params.images[studioIndex]) : params.images[0];
        const lowerPath = path.join(workDir, `lower${index}.jpg`);
        // Com legenda, o topo da metade do produto fica livre para ela: não
        // cobre nem o rosto nem o produto.
        const band = captions ? CAPTION_BAND_HEIGHT : 0;
        await sharp(source)
          .resize(WIDTH, SPLIT_BOTTOM_HEIGHT - band, { fit: "contain", background: "#ffffff" })
          .extend({ top: band, background: "#ffffff" })
          .flatten({ background: "#ffffff" })
          .jpeg({ quality: 92 })
          .toFile(lowerPath);
        inputs.push("-loop", "1", "-framerate", String(FPS), "-i", lowerPath);
        filters.push(`[t${index}]crop=${WIDTH}:${SPLIT_TOP_HEIGHT}:0:20[top${index}]`);
        filters.push(
          `[${nextInput}:v]trim=0:${duration.toFixed(3)},setpts=PTS-STARTPTS,format=yuv420p,setsar=1[low${index}]`,
        );
        filters.push(`[top${index}][low${index}]vstack=shortest=1,format=yuv420p,setsar=1[s${index}]`);
      }
      nextInput++;
    }
    filters.push(`${segments.map((_, i) => `[s${i}]`).join("")}concat=n=${segments.length}:v=1:a=0[base]`);

    let lastLabel = "base";
    const overlay = (pngPath: string, enable: string) => {
      inputs.push("-loop", "1", "-framerate", String(FPS), "-i", pngPath);
      const label = `ov${nextInput}`;
      filters.push(`[${lastLabel}][${nextInput}:v]overlay=0:0:enable='${enable}':shortest=1[${label}]`);
      lastLabel = label;
      nextInput++;
    };

    // Cartão do produto nos trechos em que só o avatar aparece.
    const avatarRanges = segments.filter((segment) => segment.kind === "avatar" && segment.end - segment.start >= 1);
    if (params.images.length > 0 && avatarRanges.length > 0) {
      const framedAll = await Promise.all(params.images.map((image) => frameImageForReel(image)));
      const studioIndex = framedAll.findIndex((framed) => framed.kind === "studio");
      const cardPath = path.join(workDir, "card.png");
      // Cena (modelo usando) não cabe num cartão: só foto de estúdio.
      if (studioIndex >= 0) {
        await renderProductCard(params.images[studioIndex], cardPath);
        // Entra depois de 1s, para o gancho abrir só com o rosto.
        const enable = avatarRanges
          .map((segment) => `between(t,${Math.max(segment.start, 1).toFixed(2)},${segment.end.toFixed(2)})`)
          .join("+");
        overlay(cardPath, enable);
      }
    }

    if (captions && spans) {
      const splitStart = segments.find((segment) => segment.kind === "split")?.start ?? Infinity;
      for (const [index, span] of spans.entries()) {
        // Frase que atravessa o início do fechamento troca de lugar no corte.
        const pieces = [
          { start: span.start, end: Math.min(span.end, splitStart), overSplit: false },
          { start: Math.max(span.start, splitStart), end: span.end, overSplit: true },
        ].filter((piece) => piece.end - piece.start > 0.05);
        for (const [pieceIndex, piece] of pieces.entries()) {
          const box = captionBox(captions[index], piece.overSplit);
          if (!box) continue;
          const captionPath = path.join(workDir, `caption${index}_${pieceIndex}.png`);
          await renderCaption(box, captionPath);
          overlay(captionPath, `between(t,${piece.start.toFixed(2)},${(piece.end - 0.04).toFixed(2)})`);
        }
      }
    } else {
      const hook = hookLayout(params.script);
      if (hook) {
        const hookPath = path.join(workDir, "hook.png");
        await renderHook(hook.lines, hook.fontSize, hookPath);
        overlay(hookPath, "between(t,0.15,3.3)");
      }
    }

    await runFfmpegCommand(
      ffmpegPath,
      [
        "-y",
        ...inputs,
        "-filter_complex",
        filters.join(";"),
        "-map",
        `[${lastLabel}]`,
        "-map",
        "0:a:0?",
        "-t",
        info.durationSec.toFixed(3),
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "23",
        "-maxrate",
        "6M",
        "-bufsize",
        "12M",
        "-threads",
        "2",
        "-c:a",
        "aac",
        "-b:a",
        "128k",
        "-movflags",
        "+faststart",
        outputPath,
      ],
      COMPOSE_TIMEOUT_MS,
    );
    return await readFile(outputPath);
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

