import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

// Monta um Reel (MP4 vertical) a partir de imagens JÁ geradas e aprovadas
// pela checagem de fidelidade (ver generateProductImage.server.ts). Nunca
// gera pixel novo — só corta e segura cada imagem existente por um tempo
// fixo (sem pan/zoom animado, ver comentário de runFfmpeg abaixo pro
// motivo), então não reabre o risco de fidelidade que já levou a abandonar
// stills gerados por IA na Mangará real (ver
// /Users/patriciacossettin/Mangara-Nano-Banana/CLAUDE.md).

const CANVAS_WIDTH = 1080;
const CANVAS_HEIGHT = 1920;
const FPS = 30;
const SECONDS_PER_IMAGE = 3.5;

export interface BuildReelParams {
  // Buffers já resolvidos (não URLs) — quem chama decide de onde vêm
  // (creativeAsset em base64, still do Shopify, etc.), buildReel só monta.
  images: Buffer[];
}

export async function buildReel({ images }: BuildReelParams): Promise<Buffer> {
  if (images.length === 0) {
    throw new Error("buildReel precisa de pelo menos 1 imagem");
  }

  const workDir = await mkdtemp(path.join(tmpdir(), "reel-"));
  try {
    const localImagePaths = await Promise.all(
      images.map((buffer, index) => {
        const destPath = path.join(workDir, `img-${index}.jpg`);
        return writeFile(destPath, buffer).then(() => destPath);
      }),
    );

    const outputPath = path.join(workDir, "output.mp4");
    await runFfmpeg(localImagePaths, outputPath);

    return await readFile(outputPath);
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

async function resolveFfmpegPath(): Promise<string> {
  if (process.env.FFMPEG_PATH) return process.env.FFMPEG_PATH;
  // Só usado em dev local (fora do Docker) — no Docker, FFMPEG_PATH sempre
  // aponta pro binário real instalado via apk, porque o binário baixado por
  // este pacote é linkado contra glibc e não roda no Alpine (musl).
  //
  // O import precisa ser totalmente dinâmico (string montada em variável,
  // não um literal) — sem isso o Rollup tenta RESOLVER o pacote em tempo de
  // build mesmo sendo condicional em runtime, e falha, porque ffmpeg-static
  // é devDependency e "npm ci --omit=dev" no Dockerfile nem instala o
  // pacote. Achado real, 19/09/2026, derrubou os dois primeiros deploys de
  // produção: "Rollup failed to resolve import ffmpeg-static". Um
  // comentário `@vite-ignore` sozinho NÃO resolveu — o Rollup ainda tentava
  // resolver de verdade no build de SSR. Só variável funciona, porque aí o
  // Rollup não tem como saber em build-time qual módulo será pedido; essa
  // linha nunca roda em produção mesmo (o "if" acima sempre retorna antes,
  // já que FFMPEG_PATH está setado no Docker).
  const ffmpegStaticModuleId = "ffmpeg-static";
  const ffmpegStatic = await import(ffmpegStaticModuleId);
  return ffmpegStatic.default as unknown as string;
}

function runFfmpegCommand(ffmpegPath: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpegPath, args);
    let stderr = "";
    proc.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    proc.on("error", reject);
    proc.on("close", (code, signal) => {
      if (code === 0) resolve();
      // code=null + signal preenchido = processo morto por sinal externo
      // (o caso real de 22/09/2026 era SIGKILL, provável OOM) — sem logar o
      // signal, "código null" sozinho não dava pra distinguir isso de um
      // crash normal do próprio ffmpeg.
      else
        reject(
          new Error(
            `ffmpeg saiu com código ${code}${signal ? ` (sinal ${signal})` : ""}: ${stderr.slice(-2000)}`,
          ),
        );
    });
  });
}

// Achado ao vivo, 22/09/2026, TRÊS VEZES seguidas: gerar o Reel obrigatório
// da semana matava o processo do ffmpeg no meio por SIGKILL. Primeiro
// suspeito foi resolução (cortado supersample de 2x pra 1.3x), depois
// paralelismo (processar as N imagens ao mesmo tempo num único
// filter_complex, corrigido pra sequencial) — nenhum dos dois resolveu:
// mesmo já sequencial e em resolução final (sem supersample), uma ÚNICA
// imagem com zoompan ainda travava em "frame=0" por mais de 20s antes de
// ser morta, com CPU e memória do container dentro do limite (não bateu no
// teto de 1024MB nem de 2 vCPU) — ou seja, não é falta de recurso, é o
// FILTRO zoompan em si que trava/degenera nesse binário de produção
// (ffmpeg instalado via apk no Alpine, versão não fixada). Testado local
// com ffmpeg-static (build diferente) e funcionou instantâneo — reforça
// que é specífico do binário/ambiente de produção, não do comando em si.
// Removido zoompan inteiramente: cada imagem agora é um plano estático
// (scale+crop, sem pan/zoom animado, sem avaliação de expressão por
// frame), a forma mais simples e testada de segurar uma imagem por um
// tempo fixo. Perde o efeito Ken Burns, mas para de derrubar o Reel
// obrigatório da semana — pode ser revisitado depois com um ffmpeg com
// versão fixada, se fizer sentido.
async function runFfmpeg(imagePaths: string[], outputPath: string): Promise<void> {
  const ffmpegPath = await resolveFfmpegPath();
  const workDir = path.dirname(outputPath);

  // Etapa 1: um plano estático por imagem, um de cada vez.
  const clipPaths: string[] = [];
  for (let index = 0; index < imagePaths.length; index++) {
    const clipPath = path.join(workDir, `clip-${index}.mp4`);
    const filter =
      `scale=${CANVAS_WIDTH}:${CANVAS_HEIGHT}:force_original_aspect_ratio=increase,` +
      `crop=${CANVAS_WIDTH}:${CANVAS_HEIGHT},setsar=1,fps=${FPS}`;

    await runFfmpegCommand(ffmpegPath, [
      "-loop",
      "1",
      "-t",
      String(SECONDS_PER_IMAGE),
      "-i",
      imagePaths[index],
      "-vf",
      filter,
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-pix_fmt",
      "yuv420p",
      "-y",
      clipPath,
    ]);
    clipPaths.push(clipPath);
  }

  // Etapa 2: concatena os clipes já pequenos (mesma resolução final, sem
  // supersample) + aplica fade in/out + adiciona a trilha muda exigida
  // pelo Instagram Reels (sem música licenciada ainda, fica pra depois).
  const concatInputArgs: string[] = [];
  clipPaths.forEach((clipPath) => concatInputArgs.push("-i", clipPath));
  const concatFilter =
    clipPaths.map((_, index) => `[${index}:v]`).join("") +
    `concat=n=${clipPaths.length}:v=1:a=0[vconcat]`;
  const totalDuration = SECONDS_PER_IMAGE * clipPaths.length;
  const fadeOutStart = Math.max(totalDuration - 0.5, 0);
  const fadeFilter = `[vconcat]fade=t=in:st=0:d=0.4,fade=t=out:st=${fadeOutStart}:d=0.5[vout]`;
  const filterComplex = [concatFilter, fadeFilter].join(";");
  const audioInputIndex = clipPaths.length;

  await runFfmpegCommand(ffmpegPath, [
    ...concatInputArgs,
    "-f",
    "lavfi",
    "-i",
    "anullsrc=channel_layout=stereo:sample_rate=44100",
    "-filter_complex",
    filterComplex,
    "-map",
    "[vout]",
    "-map",
    `${audioInputIndex}:a`,
    "-shortest",
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-b:a",
    "128k",
    "-movflags",
    "+faststart",
    "-y",
    outputPath,
  ]);
}
