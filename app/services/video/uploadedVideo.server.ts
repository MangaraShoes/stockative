import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import prisma from "../../db.server";
import { ensurePlannedReel } from "./generateReelForContentItem.server";
import { resolveFfmpegPath, runFfmpegCommand } from "./buildReel.server";

// Vídeo próprio da lojista no lugar do Reel montado pelo app (Patricia,
// 04/11/2026: vídeos com o avatar dela, gerados fora do app). O app só
// padroniza o arquivo e publica; não gasta crédito.
export const MAX_UPLOADED_VIDEO_BYTES = 200 * 1024 * 1024;
const MAX_STORED_VIDEO_BYTES = 50 * 1024 * 1024; // o vídeo fica no banco, como os outros Reels
const MIN_DURATION_SEC = 3;
const MAX_DURATION_SEC = 60;
const MIN_VERTICAL_RATIO = 1.6;
const MAX_VERTICAL_RATIO = 1.9;
const TRANSCODE_TIMEOUT_MS = 180_000;

export type UploadedVideoResult = { status: "success" } | { status: "error"; reason: string };

class InvalidVideoError extends Error {}

export interface VideoInfo {
  width: number;
  height: number;
  durationSec: number;
}

// "ffmpeg -i" sempre sai com erro por não ter saída: o que interessa é o stderr.
function readFfmpegOutput(ffmpegPath: string, inputPath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpegPath, ["-hide_banner", "-i", inputPath]);
    let stderr = "";
    proc.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    proc.on("error", reject);
    proc.on("close", () => resolve(stderr));
  });
}

export function parseVideoInfo(ffmpegOutput: string): VideoInfo | null {
  const duration = /Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/.exec(ffmpegOutput);
  const size = /Stream #\d+:\d+[^\n]*Video:[^\n]*?, (\d{2,5})x(\d{2,5})/.exec(ffmpegOutput);
  if (!duration || !size) return null;
  const durationSec = Number(duration[1]) * 3600 + Number(duration[2]) * 60 + Number(duration[3]);
  const rawWidth = Number(size[1]);
  const rawHeight = Number(size[2]);
  // Vídeo de celular vem deitado, com a rotação só nos metadados.
  const rotated = /rotation of -?(90|270)(?:\.0+)? degrees|rotate\s*:\s*(90|270)/.test(ffmpegOutput);
  return {
    width: rotated ? rawHeight : rawWidth,
    height: rotated ? rawWidth : rawHeight,
    durationSec,
  };
}

export async function readVideoInfo(ffmpegPath: string, inputPath: string): Promise<VideoInfo | null> {
  return parseVideoInfo(await readFfmpegOutput(ffmpegPath, inputPath));
}

export function validateVideoInfo(info: VideoInfo): string | null {
  if (info.durationSec < MIN_DURATION_SEC) {
    return `This video is too short. It needs at least ${MIN_DURATION_SEC} seconds.`;
  }
  if (info.durationSec > MAX_DURATION_SEC) {
    return `This video is ${Math.round(info.durationSec)} seconds long. The limit is ${MAX_DURATION_SEC} seconds.`;
  }
  const ratio = info.height / info.width;
  if (ratio < MIN_VERTICAL_RATIO || ratio > MAX_VERTICAL_RATIO) {
    return "This video needs to be vertical (9:16), like a Reel.";
  }
  return null;
}

// Padroniza pro que Instagram, TikTok e YouTube aceitam, e reduz o arquivo.
export async function normalizeUploadedVideo(input: Buffer): Promise<Buffer> {
  const ffmpegPath = await resolveFfmpegPath();
  const workDir = await mkdtemp(path.join(tmpdir(), "uploaded-video-"));
  try {
    const inputPath = path.join(workDir, "input");
    const outputPath = path.join(workDir, "output.mp4");
    await writeFile(inputPath, input);

    const info = await readVideoInfo(ffmpegPath, inputPath);
    if (!info) throw new InvalidVideoError("That file isn't a video we can read. Please upload an MP4.");
    const invalidReason = validateVideoInfo(info);
    if (invalidReason) throw new InvalidVideoError(invalidReason);

    await runFfmpegCommand(
      ffmpegPath,
      [
        "-y",
        "-i",
        inputPath,
        "-map",
        "0:v:0",
        "-map",
        "0:a:0?",
        "-vf",
        "scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2,fps=30,format=yuv420p,setsar=1",
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
      TRANSCODE_TIMEOUT_MS,
    );
    return await readFile(outputPath);
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

async function findEditableItem(shopId: string, contentItemId: string) {
  const item = await prisma.contentItem.findFirst({ where: { id: contentItemId, shopId } });
  if (!item) return null;
  return ["draft", "approved"].includes(item.status) ? item : null;
}

export async function applyUploadedVideoToPost(params: {
  shopId: string;
  contentItemId: string;
  file: File;
}): Promise<UploadedVideoResult> {
  const editable = await findEditableItem(params.shopId, params.contentItemId);
  if (!editable) {
    return { status: "error", reason: "This post has already been scheduled or published." };
  }
  if (editable.avatarVideoStatus === "processing" || editable.avatarVideoStatus === "composing") {
    return { status: "error", reason: "An avatar video is still being generated for this post." };
  }
  if (params.file.size === 0) return { status: "error", reason: "Choose a video first." };
  if (params.file.size > MAX_UPLOADED_VIDEO_BYTES) {
    return { status: "error", reason: "This video is larger than 200 MB. Please export a smaller file." };
  }

  let normalized: Buffer;
  try {
    normalized = await normalizeUploadedVideo(Buffer.from(await params.file.arrayBuffer()));
  } catch (error) {
    if (error instanceof InvalidVideoError) return { status: "error", reason: error.message };
    console.error(`Failed to process uploaded video for content item ${params.contentItemId}:`, error);
    return { status: "error", reason: "We couldn't process this video. Please try another MP4." };
  }
  if (normalized.length > MAX_STORED_VIDEO_BYTES) {
    return { status: "error", reason: "This video is still too large after processing. Please use a shorter one." };
  }

  await prisma.contentItem.update({
    where: { id: params.contentItemId },
    data: {
      videoUrl: `data:video/mp4;base64,${normalized.toString("base64")}`,
      videoGeneratedAt: new Date(),
      videoUploadedAt: new Date(),
      videoSavedToShopifyAt: null,
      format: "reel",
      requiresApproval: false,
      avatarVideoStatus: null,
      avatarVideoError: null,
    },
  });
  return { status: "success" };
}

// Volta ao que o post era antes: Reel do plano é remontado sem gastar crédito
// (videoGeneratedAt continua preenchido); post comum volta a ser imagem.
export async function removeUploadedVideoFromPost(params: {
  shopId: string;
  contentItemId: string;
}): Promise<UploadedVideoResult> {
  const editable = await findEditableItem(params.shopId, params.contentItemId);
  if (!editable) {
    return { status: "error", reason: "This post has already been scheduled or published." };
  }
  await prisma.contentItem.update({
    where: { id: params.contentItemId },
    data: {
      videoUrl: null,
      videoUploadedAt: null,
      videoSavedToShopifyAt: null,
      requiresApproval: false,
      avatarVideoStatus: null,
      avatarVideoError: null,
      ...(editable.plannedAsReel ? {} : { format: "post", videoGeneratedAt: null }),
    },
  });
  await ensurePlannedReel(params.contentItemId, params.shopId);
  return { status: "success" };
}
