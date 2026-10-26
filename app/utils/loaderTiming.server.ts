// Tempo por etapa de um loader, numa linha só no log do servidor — o Weekly
// plan levava ~20s pra abrir (medido ao vivo, 26/10/2026) sem dar pra saber
// qual etapa. Ler na Hetzner com: docker compose ... logs app | grep "[timing]"
export function startLoaderTimer(label: string) {
  const startedAt = performance.now();
  let lastAt = startedAt;
  const steps: string[] = [];
  return {
    step(name: string) {
      const now = performance.now();
      steps.push(`${name}=${Math.round(now - lastAt)}ms`);
      lastAt = now;
    },
    // Pra etapas que rodam em paralelo: mede do início até a promessa
    // terminar, em vez do intervalo desde a etapa anterior.
    time<T>(name: string, promise: Promise<T>): Promise<T> {
      const stepStartedAt = performance.now();
      return promise.finally(() => {
        steps.push(`${name}=${Math.round(performance.now() - stepStartedAt)}ms`);
      });
    },
    done() {
      console.log(`[timing] ${label} total=${Math.round(performance.now() - startedAt)}ms ${steps.join(" ")}`);
    },
  };
}
