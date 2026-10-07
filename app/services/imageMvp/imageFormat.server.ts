// Checa o formato pela assinatura do arquivo (magic bytes), não pelo
// mime type do data URL, que o cliente controla. Upload só aceita raster
// JPEG/PNG/WebP: SVG nunca chega ao Sharp, porque o decoder de SVG
// (librsvg) teve falha de memória explorável (auditoria de segurança,
// 07/10/2026, GHSA-wq5f-xc86-pv6w) e nenhum fluxo do app precisa de SVG.
export function isSupportedRasterImage(buffer: Buffer): boolean {
  if (buffer.length < 12) return false;

  const isJpeg = buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  const isPng =
    buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47;
  const isWebp =
    buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP";

  return isJpeg || isPng || isWebp;
}
