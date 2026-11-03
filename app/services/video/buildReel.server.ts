import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { frameImageForReel, type ReelFrameKind } from "./reelFraming.server";

// Monta um Reel (MP4 vertical) a partir de imagens JÁ geradas e aprovadas
// pela checagem de fidelidade (ver generateProductImage.server.ts). Nunca
// gera pixel novo — só enquadra cada imagem existente, com zoom leve e
// transição (ver runMotionFfmpeg; runFfmpeg é o Reel estático de reserva), então
// não reabre o risco de fidelidade que já levou a abandonar
// stills gerados por IA na Mangará real (ver
// /Users/patriciacossettin/Mangara-Nano-Banana/CLAUDE.md).

const CANVAS_WIDTH = 1080;
const CANVAS_HEIGHT = 1920;
const FPS = 30;
// Baixado de 3.5s pra 1.8s (Patricia, 24/09/2026: "o reel esta demorando
// muito em cada imagem") — sem o efeito de zoom (removido antes por travar
// o ffmpeg, ver comentário abaixo), 3.5s parado numa imagem estática ficava
// lento de mais pro ritmo normal de Reel/TikTok.
const SECONDS_PER_IMAGE = 1.8;
// Reel com movimento (Patricia, 03/11/2026, em vez de API de vídeo paga): cada
// imagem fica mais tempo porque agora se mexe e parte dela é transição.
const MOTION_SECONDS_PER_IMAGE = 2.6;
const CROSSFADE_SECONDS = 0.35;
// Zoom bem leve. Na cena não dá pra garantir margem em volta do produto (é o
// corte central de sempre), então o zoom é menor que no estúdio, onde
// reelFraming.server.ts já deixou o produto com folga no quadro.
const STUDIO_MAX_ZOOM = 1.07;
const SCENE_MAX_ZOOM = 1.04;
// Passou disso, desiste do movimento e cai pro Reel estático: um ffmpeg
// travado não pode segurar a montagem do Reel nem a publicação.
const MOTION_COMMAND_TIMEOUT_MS = 90_000;
// Achado ao vivo, 22/09/2026, depois de 3 tentativas erradas (resolução,
// paralelismo, zoompan): o stderr do x264 revelou "threads=60" — o ffmpeg
// autodetecta o número de threads pela CONTAGEM DE CPU DA MÁQUINA FÍSICA
// por trás do container (60), não pelo limite real de 2 vCPU do cgroup do
// Railway. x264 pré-aloca buffers de lookahead/referência PROPORCIONAIS a
// esse número de threads antes de codificar o primeiro frame — por isso
// toda tentativa morria em "frame=0", mesmo num encode trivial sem
// zoompan: travava na alocação de memória do encoder, não na codificação
// em si. Limitar threads explicitamente corrige na raiz, sem precisar
// adivinhar limite de memória/resolução de novo.
const FFMPEG_THREADS = 2;

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
    const startedAt = Date.now();
    try {
      await runMotionFfmpeg(images, workDir, outputPath);
      console.log(`[reel] built with motion: ${images.length} images in ${Date.now() - startedAt}ms`);
    } catch (error) {
      // Melhor um Reel parado do que nenhum Reel.
      console.error("[reel] motion failed, falling back to static Reel:", error);
      await runFfmpeg(localImagePaths, outputPath);
    }

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

function runFfmpegCommand(ffmpegPath: string, args: string[], timeoutMs?: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpegPath, args);
    const timeoutId = timeoutMs ? setTimeout(() => proc.kill("SIGKILL"), timeoutMs) : null;
    let stderr = "";
    proc.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    proc.on("error", reject);
    proc.on("close", (code, signal) => {
      if (timeoutId) clearTimeout(timeoutId);
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

// Reel com zoom suave e transição entre as imagens. Sem fade pra preto nem no
// começo nem no fim (mesmo achado de 23/09/2026, ver runFfmpeg): o xfade só
// funde uma imagem real na outra, e o vídeo começa e termina em imagem real.
async function runMotionFfmpeg(images: Buffer[], workDir: string, outputPath: string): Promise<void> {
  const ffmpegPath = await resolveFfmpegPath();
  const frames = Math.round(MOTION_SECONDS_PER_IMAGE * FPS);

  const clipPaths: string[] = [];
  for (let index = 0; index < images.length; index++) {
    const { jpeg, kind } = await frameImageForReel(images[index]);
    const framedPath = path.join(workDir, `framed-${index}.jpg`);
    await writeFile(framedPath, jpeg);

    const clipPath = path.join(workDir, `motion-${index}.mp4`);
    await runFfmpegCommand(
      ffmpegPath,
      [
        "-i",
        framedPath,
        "-vf",
        `setsar=1,zoompan=z='${zoomExpression(index, kind, frames)}':` +
          `x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=${CANVAS_WIDTH}x${CANVAS_HEIGHT}:fps=${FPS}`,
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-threads",
        String(FFMPEG_THREADS),
        "-pix_fmt",
        "yuv420p",
        "-y",
        clipPath,
      ],
      MOTION_COMMAND_TIMEOUT_MS,
    );
    clipPaths.push(clipPath);
  }

  const concatInputArgs: string[] = [];
  clipPaths.forEach((clipPath) => concatInputArgs.push("-i", clipPath));

  let filterComplex = "[0:v]null[vout]";
  if (clipPaths.length > 1) {
    const clipDuration = frames / FPS;
    const steps: string[] = [];
    let previous = "[0:v]";
    for (let index = 1; index < clipPaths.length; index++) {
      const offset = (index * (clipDuration - CROSSFADE_SECONDS)).toFixed(3);
      const label = index === clipPaths.length - 1 ? "[vout]" : `[x${index}]`;
      steps.push(
        `${previous}[${index}:v]xfade=transition=fade:duration=${CROSSFADE_SECONDS}:offset=${offset}${label}`,
      );
      previous = label;
    }
    filterComplex = steps.join(";");
  }

  await runFfmpegCommand(
    ffmpegPath,
    [
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
      `${clipPaths.length}:a`,
      "-shortest",
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-threads",
      String(FFMPEG_THREADS),
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
    ],
    MOTION_COMMAND_TIMEOUT_MS,
  );
}

// Alterna aproximar/afastar. A 1ª imagem sempre começa sem zoom: esse frame
// vira a capa automática do Reel.
function zoomExpression(index: number, kind: ReelFrameKind, frames: number): string {
  const extra = (kind === "studio" ? STUDIO_MAX_ZOOM : SCENE_MAX_ZOOM) - 1;
  return index % 2 === 0
    ? `1+${extra.toFixed(3)}*on/${frames}`
    : `${(1 + extra).toFixed(3)}-${extra.toFixed(3)}*on/${frames}`;
}

// Histórico de 22/09/2026: 3 tentativas erradas antes de achar a causa raiz
// de verdade (ver FFMPEG_THREADS acima — threads=60 do x264). Nessa ordem:
// (1) supersample 2x→1.3x, (2) branches de zoompan em paralelo→sequencial,
// (3) removido zoompan (efeito Ken Burns) inteiramente, achando que o
// FILTRO era o problema. Nenhuma resolveu — a 4ª tentativa (essa) foi a
// primeira a realmente ler o stderr do x264 até o fim em vez de só olhar
// "SIGKILL" e assumir OOM por resolução/paralelismo. O zoompan foi
// removido antes da causa raiz ficar clara; deixado assim por ora (plano
// estático por imagem) — pode voltar a ter o efeito de zoom se fizer
// sentido, agora que o -threads devia resolver o crash de verdade.
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
      "-threads",
      String(FFMPEG_THREADS),
      "-pix_fmt",
      "yuv420p",
      "-y",
      clipPath,
    ]);
    clipPaths.push(clipPath);
  }

  // Etapa 2: concatena os clipes já pequenos (mesma resolução final, sem
  // supersample) + adiciona a trilha muda exigida pelo Instagram Reels
  // (sem música licenciada ainda, fica pra depois). Sem fade nenhum — ver
  // comentário abaixo.
  const concatInputArgs: string[] = [];
  clipPaths.forEach((clipPath) => concatInputArgs.push("-i", clipPath));
  // Achado ao vivo, 23/09/2026, duas vezes: primeiro o fade-in deixava o
  // frame 0 preto (virava a capa automática do Reel no Instagram/TikTok);
  // depois, removido o fade-in mas mantido o fade-out, o ÚLTIMO frame
  // ficava preto na tela ao terminar de reproduzir, quando devia continuar
  // mostrando a última imagem. Removidos os dois — sem fade nenhum, o
  // vídeo começa e termina exatamente na imagem real, nunca em preto.
  const concatFilter =
    clipPaths.map((_, index) => `[${index}:v]`).join("") +
    `concat=n=${clipPaths.length}:v=1:a=0[vout]`;
  const filterComplex = concatFilter;
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
    "-threads",
    String(FFMPEG_THREADS),
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
