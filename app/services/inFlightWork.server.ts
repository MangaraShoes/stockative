// Trabalho longo em andamento agora (agendador + ações da tela que chamam a
// IA), pra o desligamento do redeploy esperar por ele antes de sair.
//
// Achado ao vivo, 28/10/2026: um deploy às 13:01 matou no meio a
// regeneração de imagem da Smile XS — o agendador só esperava os próprios
// jobs e chamava process.exit, derrubando a requisição HTTP que já tinha
// gastado a única regeneração do post. Ver waitForInFlightJobsThenExit em
// scheduler.server.ts.

const inFlight = new Set<Promise<unknown>>();

export function trackInFlight<T>(promise: Promise<T>): Promise<T> {
  const tracked = promise.finally(() => inFlight.delete(tracked));
  inFlight.add(tracked);
  return tracked;
}

// Envolve uma action de rota: a requisição inteira conta como trabalho em
// andamento até responder.
export function withInFlight<Args extends unknown[], R>(fn: (...args: Args) => Promise<R>) {
  return (...args: Args) => trackInFlight(fn(...args));
}

export function inFlightCount(): number {
  return inFlight.size;
}

// true se o prazo acabou antes de tudo terminar.
export async function waitForInFlight(timeoutMs: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = await Promise.race([
    Promise.allSettled([...inFlight]).then(() => false),
    new Promise<boolean>((resolve) => {
      timer = setTimeout(() => resolve(true), timeoutMs);
    }),
  ]);
  clearTimeout(timer);
  return timedOut;
}
