// Cliente da API da Creatify (https://docs.creatify.ai) — protótipo do Reel
// com avatar de IA falando (estilo UGC, como o Arcads.ai), avaliado em
// 14/09/2026 contra HeyGen e Arcads. Escolhida pra prototipar primeiro
// porque usa a URL de imagem do produto direto (já temos isso via Shopify,
// sem precisar do scraping de URL que a Creatify também oferece) e tem
// plano de API self-serve mais barato pra testar ($99/mês).
//
// Schemas abaixo conferidos ao vivo contra a documentação em 14/09/2026
// (não assumidos) — ver docs.creatify.ai/api-reference. Dois fluxos
// diferentes, cada um com uma limitação real encontrada na pesquisa:
//   1) generateCreatifyAvatarVideo: roteiro exato (texto literal), mas SEM
//      o produto na mão do avatar.
//   2) generateCreatifyProductAvatarVideo: produto na mão (foto real via
//      URL), mas o roteiro é só uma descrição solta (video_prompt), não
//      texto literal — a IA da Creatify escreve a fala a partir disso, não
//      fala o texto exato do Decision Engine. Esse é o ponto a validar no
//      protótipo: se a fala gerada fica boa o suficiente sem controle exato.
//
// Não é chamado em nenhum fluxo de produção ainda — só existe pra rodar o
// protótipo manual (ver .creatify-prototype.mts) até decidirmos se vale
// virar feature de verdade.
//
// Achado da Patricia testando manualmente no app.creatify.ai em 14/09/2026:
// o fluxo deles pede 3 imagens do produto (não 1) e um descritivo da marca.
// generateCreatifyProductAvatarVideo abaixo só manda 1 imagem (product_url)
// e nenhum texto de marca, porque é tudo que os campos documentados em
// /product_to_videos/gen_image aceitam — não achei campo pra mais imagens
// nem pra descritivo de marca na doc da API. Duas hipóteses a checar quando
// tivermos a chave: (1) é só a UI web pedindo mais input pra gerar melhor,
// mas a API aceita menos; ou (2) existe campo real que a doc não mostrou
// direito e o vídeo sai pior sem ele. De qualquer forma, os dois dados já
// existem no nosso banco — ProductImage tem a galeria toda (não só o hero
// de ProductCache.imageUrl) e Shop.brandDescription já existe — então dar
// os 3 melhores ângulos + a descrição da marca pro protótipo é barato de
// fazer assim que isso for confirmado.
//
// Segundo achado da Patricia no mesmo teste manual: a UI tem um passo
// "Choose or create your script" com DUAS abas — "Choose script from AI"
// (a Creatify gera variações prontas, cada uma com um nome de ângulo tipo
// "Endurance Confort"/"Problem-Solution" e um seletor de tom — o mesmo
// conceito do nosso creativeAngle do Decision Engine, Stage1Output) e "Use
// your own script". Isso confirma que dá pra pular a geração de roteiro
// deles e mandar o texto que o nosso Stage 2 (generateCreativeCopy) já
// produz, em vez de perder o controle de voz de marca pro copywriter de IA
// deles — bate com o campo `text` já documentado no endpoint /lipsyncs/
// (fluxo 1 acima). O endpoint de geração de roteiro deles ("AI Scripts", 1
// crédito/chamada, achado na pesquisa de preço) não foi explorado — não
// precisa, dado que "Use your own script" já resolve.

const CREATIFY_API_BASE = "https://api.creatify.ai/api";

function getCreatifyAuthHeaders(): Record<string, string> {
  const apiId = process.env.CREATIFY_API_ID;
  const apiKey = process.env.CREATIFY_API_KEY;
  if (!apiId || !apiKey) {
    throw new Error(
      "CREATIFY_API_ID / CREATIFY_API_KEY não configuradas — assine o plano de API em creatify.ai e adicione as chaves no .env.",
    );
  }
  return { "X-API-ID": apiId, "X-API-KEY": apiKey, "Content-Type": "application/json" };
}

async function creatifyRequest<T>(
  path: string,
  init?: { method?: "GET" | "POST"; body?: unknown },
): Promise<T> {
  const response = await fetch(`${CREATIFY_API_BASE}${path}`, {
    method: init?.method ?? "GET",
    headers: getCreatifyAuthHeaders(),
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
  });

  const json = await response.json();
  if (!response.ok) {
    throw new Error(`Creatify API error (${response.status}) on ${path}: ${JSON.stringify(json)}`);
  }
  return json as T;
}

export type CreatifyAspectRatio = "9x16" | "16x9" | "1x1";

// Shape exato de persona/voz não está documentado publicamente (só o
// endpoint e que cada item tem "id") — tipado solto de propósito, ajustar
// depois de ver a resposta real na primeira chamada do protótipo.
export interface CreatifyPersona {
  id: string;
  name?: string;
  [key: string]: unknown;
}

export interface CreatifyVoice {
  id: string;
  name?: string;
  [key: string]: unknown;
}

export async function listCreatifyPersonas(): Promise<CreatifyPersona[]> {
  return creatifyRequest<CreatifyPersona[]>("/personas/");
}

export async function listCreatifyVoices(): Promise<CreatifyVoice[]> {
  return creatifyRequest<CreatifyVoice[]>("/voices/");
}

interface LipsyncTask {
  id: string;
  status: string; // pending | in_queue | running | failed | done (conferir na 1a chamada real)
  output: string | null;
  failed_reason: string | null;
}

const CREATIFY_POLL_INTERVAL_MS = 5_000;
const CREATIFY_POLL_TIMEOUT_MS = 10 * 60 * 1000; // generoso — turnaround real não documentado

async function pollCreatifyLipsync(id: string): Promise<string> {
  const deadline = Date.now() + CREATIFY_POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const task = await creatifyRequest<LipsyncTask>(`/lipsyncs/${id}/`);
    if (task.output) return task.output;
    if (task.status === "failed") {
      throw new Error(`Creatify lipsync falhou: ${task.failed_reason ?? "motivo não informado"}`);
    }
    await new Promise((resolve) => setTimeout(resolve, CREATIFY_POLL_INTERVAL_MS));
  }
  throw new Error("Tempo esgotado esperando a Creatify processar o vídeo (lipsync).");
}

// Fluxo 1 — roteiro exato, avatar falando, SEM produto na mão.
export async function generateCreatifyAvatarVideo(params: {
  script: string;
  personaId: string;
  voiceId: string;
  aspectRatio?: CreatifyAspectRatio;
}): Promise<string> {
  const created = await creatifyRequest<LipsyncTask>("/lipsyncs/", {
    method: "POST",
    body: {
      text: params.script,
      creator: params.personaId,
      accent: params.voiceId,
      aspect_ratio: params.aspectRatio ?? "9x16",
    },
  });
  if (created.output) return created.output;
  return pollCreatifyLipsync(created.id);
}

interface ProductToVideoTask {
  id: string;
  status:
    | "initializing"
    | "image_generating"
    | "image_generated"
    | "video_generating"
    | "video_generated"
    | "failed";
  generated_photo_url: string | null;
  generated_video_url: string | null;
  failed_reason: string | null;
}

async function pollProductToVideo(
  id: string,
  doneStatus: "image_generated" | "video_generated",
): Promise<ProductToVideoTask> {
  const deadline = Date.now() + CREATIFY_POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const task = await creatifyRequest<ProductToVideoTask>(`/product_to_videos/${id}/`);
    if (task.status === doneStatus) return task;
    if (task.status === "failed") {
      throw new Error(`Creatify product-to-video falhou: ${task.failed_reason ?? "motivo não informado"}`);
    }
    await new Promise((resolve) => setTimeout(resolve, CREATIFY_POLL_INTERVAL_MS));
  }
  throw new Error("Tempo esgotado esperando a Creatify processar o vídeo (product-to-video).");
}

// Fluxo 2 — produto de verdade na mão do avatar (foto real via URL), mas o
// roteiro é só uma descrição solta (video_prompt) que a IA usa pra escrever
// a fala — NÃO é o texto literal do Decision Engine. É exatamente isso que
// o protótipo precisa validar: a fala gerada fica próxima o suficiente do
// que pedimos?
export async function generateCreatifyProductAvatarVideo(params: {
  productImageUrl: string;
  videoPrompt: string;
  personaId?: string;
  aspectRatio?: CreatifyAspectRatio;
}): Promise<{ videoUrl: string; photoUrl: string }> {
  const imageTask = await creatifyRequest<ProductToVideoTask>("/product_to_videos/gen_image/", {
    method: "POST",
    body: {
      type: "product_avatar",
      product_url: params.productImageUrl,
      aspect_ratio: params.aspectRatio ?? "9x16",
      override_avatar: params.personaId,
    },
  });
  const readyImage =
    imageTask.status === "image_generated" ? imageTask : await pollProductToVideo(imageTask.id, "image_generated");

  const videoTask = await creatifyRequest<ProductToVideoTask>(
    `/product_to_videos/${readyImage.id}/gen_video/`,
    {
      method: "POST",
      body: {
        motion_style: "talking",
        video_prompt: params.videoPrompt,
      },
    },
  );
  const readyVideo =
    videoTask.status === "video_generated" ? videoTask : await pollProductToVideo(readyImage.id, "video_generated");

  if (!readyVideo.generated_video_url || !readyImage.generated_photo_url) {
    throw new Error("Creatify terminou mas não devolveu as URLs esperadas.");
  }
  return { videoUrl: readyVideo.generated_video_url, photoUrl: readyImage.generated_photo_url };
}
