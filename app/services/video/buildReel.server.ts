import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

// Monta um Reel (MP4 vertical) a partir de imagens JÁ geradas e aprovadas
// pela checagem de fidelidade (ver generateProductImage.server.ts). Nunca
// gera pixel novo — só aplica movimento (Ken Burns) e corte às imagens
// existentes, então não reabre o risco de fidelidade que já levou a
// abandonar stills gerados por IA na Mangará real (ver
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

async function runFfmpeg(imagePaths: string[], outputPath: string): Promise<void> {
  const ffmpegPath = await resolveFfmpegPath();
  const zoomFrames = Math.round(SECONDS_PER_IMAGE * FPS);
  // Achado ao vivo, 22/09/2026: numa loja real, gerar o Reel obrigatório da
  // semana matou o processo do ffmpeg no meio (code:null — morto por sinal,
  // não erro de codec: os heartbeats de progresso paravam sem mensagem
  // nenhuma, "frame=0" pelos ~7s inteiros antes de sumir). O supersample
  // de 2x (4x os pixels do canvas final) pra cada branch zoompan, RODANDO
  // EM PARALELO pra cada imagem do carrossel, é pesado demais pro container
  // de produção. 1.3x ainda cobre o zoom máximo de 1.15x com folga (evita
  // upscaling visível no crop final) por uma fração do custo de memória/CPU.
  const SUPERSAMPLE_FACTOR = 1.3;
  const superWidth = Math.round(CANVAS_WIDTH * SUPERSAMPLE_FACTOR);
  const superHeight = Math.round(CANVAS_HEIGHT * SUPERSAMPLE_FACTOR);

  // Sem "-t" aqui: o loop fica infinito e cada branch é cortado no número
  // exato de frames pelo "trim" abaixo. Limitar a duração já na leitura do
  // input (como fazia antes) faz o demuxer entregar várias cópias do frame
  // em timestamps diferentes, e o zoompan trata cada uma como uma imagem
  // nova — multiplicando "d" por frame de entrada em vez de gerar só um
  // ciclo de zoom (bug real, encontrado testando com imagens reais: um
  // reel de 2 imagens de 7s saía com 10min16s).
  const inputArgs: string[] = [];
  imagePaths.forEach((imgPath) => {
    inputArgs.push("-loop", "1", "-i", imgPath);
  });

  const filterBranches: string[] = [];
  const branchLabels: string[] = [];
  imagePaths.forEach((_, index) => {
    // Alterna zoom-in/zoom-out entre imagens pra não repetir sempre o mesmo
    // movimento (mesmo princípio de variar composição do CLAUDE.md da Mangará).
    const zoomingIn = index % 2 === 0;
    const zoomExpr = zoomingIn
      ? "min(zoom+0.0015,1.15)"
      : "if(eq(on,0),1.15,max(zoom-0.0015,1.0))";
    const label = `v${index}`;
    filterBranches.push(
      `[${index}:v]scale=${superWidth}:${superHeight}:force_original_aspect_ratio=increase,` +
        `crop=${superWidth}:${superHeight},` +
        `zoompan=z='${zoomExpr}':d=${zoomFrames}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=${CANVAS_WIDTH}x${CANVAS_HEIGHT}:fps=${FPS},` +
        `setsar=1,trim=start_frame=0:end_frame=${zoomFrames},setpts=PTS-STARTPTS[${label}]`,
    );
    branchLabels.push(`[${label}]`);
  });

  const concatFilter = `${branchLabels.join("")}concat=n=${imagePaths.length}:v=1:a=0[vconcat]`;
  const totalDuration = SECONDS_PER_IMAGE * imagePaths.length;
  const fadeOutStart = Math.max(totalDuration - 0.5, 0);
  const fadeFilter = `[vconcat]fade=t=in:st=0:d=0.4,fade=t=out:st=${fadeOutStart}:d=0.5[vout]`;

  const filterComplex = [...filterBranches, concatFilter, fadeFilter].join(";");

  // Instagram Reels exige uma trilha de áudio no container — sem música
  // licenciada ainda (fica pra depois), gera uma trilha muda do tamanho do vídeo.
  const audioInputIndex = imagePaths.length;

  const args = [
    ...inputArgs,
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
  ];

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
