import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import { request as httpsRequest } from "node:https";
import { BlockList, isIP } from "node:net";

// GET de URL externa que o merchant controla (domínio da loja, imagens),
// protegido contra SSRF (auditoria de segurança, 07/10/2026, H2): sem isso,
// um domínio (ou redirect) apontando pra 127.0.0.1, rede interna do Railway
// ou IP privado fazia o servidor buscar recursos internos.
//
// - só HTTPS, porta padrão;
// - o IP é conferido DENTRO do `lookup` da própria conexão, então o IP
//   validado é o mesmo IP conectado (fecha DNS rebinding, que uma checagem
//   antes do fetch não fecha);
// - redirect seguido manualmente, cada salto validado de novo;
// - timeout e limite de bytes lidos, pra não segurar conexão nem memória.

const BLOCKED = new BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) {
  BLOCKED.addSubnet(network, prefix, "ipv4");
}
for (const [network, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["64:ff9b::", 96],
  ["2001:db8::", 32],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
] as const) {
  BLOCKED.addSubnet(network, prefix, "ipv6");
}

export function isPublicAddress(address: string): boolean {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
  if (mapped) return isPublicAddress(mapped[1]);

  const family = isIP(address);
  if (family === 4) return !BLOCKED.check(address, "ipv4");
  if (family === 6) return !BLOCKED.check(address, "ipv6");
  return false;
}

export class UnsafeUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsafeUrlError";
  }
}

// Assinatura do `lookup` aceito por https.request — com `all: true`
// (usado pelo autoSelectFamily do Node 20+) devolve a lista inteira.
function safeLookup(
  hostname: string,
  options: { all?: boolean; family?: number },
  callback: (error: Error | null, address: string | LookupAddress[], family?: number) => void,
) {
  dnsLookup(hostname, { family: options.family, all: true }, (error, addresses) => {
    if (error) return callback(error, "");
    if (addresses.length === 0 || addresses.some((entry) => !isPublicAddress(entry.address))) {
      return callback(new UnsafeUrlError(`Refusing non-public address for ${hostname}`), "");
    }
    if (options.all) return callback(null, addresses);
    callback(null, addresses[0].address, addresses[0].family);
  });
}

export interface SafeFetchResult {
  status: number;
  ok: boolean;
  url: string;
  contentType: string | null;
  body: Buffer;
}

interface SafeFetchOptions {
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
  headers?: Record<string, string>;
}

function assertSafeUrl(rawUrl: string): URL {
  const url = new URL(rawUrl);
  if (url.protocol !== "https:") throw new UnsafeUrlError("Only https URLs are allowed");
  if (url.port && url.port !== "443") throw new UnsafeUrlError("Only the default https port is allowed");
  if (url.username || url.password) throw new UnsafeUrlError("Credentials in URL are not allowed");
  // IP literal não passa pelo lookup, então confere aqui.
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(host) && !isPublicAddress(host)) throw new UnsafeUrlError("Refusing non-public address");
  return url;
}

function getOnce(url: URL, options: Required<SafeFetchOptions>): Promise<SafeFetchResult & { location: string | null }> {
  return new Promise((resolve, reject) => {
    const req = httpsRequest(
      url,
      { method: "GET", headers: options.headers, lookup: safeLookup as never },
      (res) => {
        const status = res.statusCode ?? 0;
        const location = typeof res.headers.location === "string" ? res.headers.location : null;
        const contentType = res.headers["content-type"] ?? null;

        if (status >= 300 && status < 400) {
          res.resume();
          return resolve({ status, ok: false, url: url.toString(), contentType, body: Buffer.alloc(0), location });
        }

        const declared = Number(res.headers["content-length"]);
        if (Number.isFinite(declared) && declared > options.maxBytes) {
          res.destroy();
          return reject(new UnsafeUrlError(`Response too large (${declared} bytes)`));
        }

        const chunks: Buffer[] = [];
        let received = 0;
        res.on("data", (chunk: Buffer) => {
          received += chunk.length;
          if (received > options.maxBytes) {
            res.destroy();
            reject(new UnsafeUrlError(`Response exceeded ${options.maxBytes} bytes`));
            return;
          }
          chunks.push(chunk);
        });
        res.on("end", () =>
          resolve({
            status,
            ok: status >= 200 && status < 300,
            url: url.toString(),
            contentType,
            body: Buffer.concat(chunks),
            location: null,
          }),
        );
        res.on("error", reject);
      },
    );
    // Prazo total (não só de inatividade): um servidor que manda um byte por
    // vez nunca dispararia o `timeout` de socket do Node.
    const deadline = setTimeout(
      () => req.destroy(new Error(`Request to ${url.hostname} timed out`)),
      options.timeoutMs,
    );
    req.on("close", () => clearTimeout(deadline));
    req.on("error", reject);
    req.end();
  });
}

export async function safeFetch(rawUrl: string, options: SafeFetchOptions = {}): Promise<SafeFetchResult> {
  const resolved: Required<SafeFetchOptions> = {
    timeoutMs: options.timeoutMs ?? 10_000,
    maxBytes: options.maxBytes ?? 5 * 1024 * 1024,
    maxRedirects: options.maxRedirects ?? 3,
    headers: options.headers ?? {},
  };

  let url = assertSafeUrl(rawUrl);
  for (let hop = 0; hop <= resolved.maxRedirects; hop++) {
    const result = await getOnce(url, resolved);
    if (!result.location) {
      const { location: _location, ...response } = result;
      return response;
    }
    url = assertSafeUrl(new URL(result.location, url).toString());
  }
  throw new UnsafeUrlError("Too many redirects");
}
