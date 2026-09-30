// Duração de um MP4 lida direto do box "mvhd" (sem ffprobe) — usado pra
// checar o Reel contra o max_video_post_duration_sec do TikTok antes do
// Direct Post, como as diretrizes da Content Posting API exigem. Devolve
// null quando não consegue ler (ex.: vídeo guardado como URL externa em
// vez de data: URL), e aí a checagem é pulada — o próprio TikTok ainda
// recusa um vídeo longo demais.
export function mp4DurationSecondsFromDataUrl(videoUrl: string | null): number | null {
  if (!videoUrl?.startsWith("data:")) return null;
  const base64 = videoUrl.slice(videoUrl.indexOf(",") + 1);
  const buffer = Buffer.from(base64, "base64");
  const index = buffer.indexOf("mvhd");
  if (index < 0) return null;
  const version = buffer[index + 4];
  if (version === 1) {
    const timescale = buffer.readUInt32BE(index + 24);
    const duration = Number(buffer.readBigUInt64BE(index + 28));
    return timescale ? duration / timescale : null;
  }
  const timescale = buffer.readUInt32BE(index + 16);
  const duration = buffer.readUInt32BE(index + 20);
  return timescale ? duration / timescale : null;
}
