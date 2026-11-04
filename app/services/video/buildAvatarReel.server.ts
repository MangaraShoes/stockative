import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { resolveFfmpegPath, runFfmpegCommand } from "./buildReel.server";
import { frameImageForReel } from "./reelFraming.server";
import { readVideoInfo } from "./uploadedVideo.server";

const WIDTH = 1080;
const HEIGHT = 1920;
const FPS = 30;
const MAX_CUTAWAYS = 3;
const SPLIT_TOP_HEIGHT = 1060;
const SPLIT_BOTTOM_HEIGHT = HEIGHT - SPLIT_TOP_HEIGHT;
const COMPOSE_TIMEOUT_MS = 240_000;
const MAX_HOOK_LINE_CHARS = 26;

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

// Primeira frase do roteiro em até 2 linhas, ou nada se for longa demais.
export function hookLines(script: string): string[] {
  const sentence = /^[^.!?]+[.!?]?/.exec(script.trim())?.[0].trim() ?? "";
  const lines: string[] = [];
  let current = "";
  for (const word of sentence.split(/\s+/).filter(Boolean)) {
    if (current && `${current} ${word}`.length > MAX_HOOK_LINE_CHARS) {
      lines.push(current);
      current = word;
    } else {
      current = current ? `${current} ${word}` : word;
    }
  }
  if (current) lines.push(current);
  return lines.length > 0 && lines.length <= 2 ? lines : [];
}

function escapeXml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

async function renderHook(lines: string[], outputPath: string): Promise<void> {
  const size = 56;
  const lineHeight = 72;
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

export async function buildAvatarReel(params: {
  avatarVideo: Buffer;
  images: Buffer[];
  script: string;
}): Promise<Buffer> {
  const ffmpegPath = await resolveFfmpegPath();
  const workDir = await mkdtemp(path.join(tmpdir(), "avatar-reel-"));
  try {
    const avatarPath = path.join(workDir, "avatar.mp4");
    const outputPath = path.join(workDir, "output.mp4");
    await writeFile(avatarPath, params.avatarVideo);
    const info = await readVideoInfo(ffmpegPath, avatarPath);
    if (!info) throw new Error("Could not read the avatar video.");

    const segments = planAvatarSegments(info.durationSec, params.images.length);
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
          `[${nextInput}:v]zoompan=z='1+0.04*on/${frames}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=${WIDTH}x${HEIGHT}:fps=${FPS},format=yuv420p,setsar=1[s${index}]`,
        );
      } else {
        // Foto de estúdio mostra o produto inteiro; cortar uma cena arrancava a
        // cabeça da modelo. Sem estúdio, a cena entra inteira, sem corte.
        const framedAll = await Promise.all(params.images.map((image) => frameImageForReel(image)));
        const studioIndex = framedAll.findIndex((framed) => framed.kind === "studio");
        const source = params.images[studioIndex >= 0 ? studioIndex : 0];
        const lowerPath = path.join(workDir, `lower${index}.jpg`);
        await sharp(source)
          .resize(WIDTH, SPLIT_BOTTOM_HEIGHT, { fit: "contain", background: "#ffffff" })
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
    const lines = hookLines(params.script);
    if (lines.length > 0) {
      const hookPath = path.join(workDir, "hook.png");
      await renderHook(lines, hookPath);
      inputs.push("-loop", "1", "-framerate", String(FPS), "-i", hookPath);
      filters.push(`[base][${nextInput}:v]overlay=0:0:enable='between(t,0.15,3.3)':shortest=1[video]`);
      lastLabel = "video";
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

