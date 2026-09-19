import { graphApiRequest } from "./graphApi.server";

export type TopOnlineHoursResult =
  | { status: "success"; hours: number[] } // horas do dia (0-23), da mais ativa pra menos, tamanho até topN
  | { status: "error"; reason: string };

interface OnlineFollowersResponse {
  data?: { values?: { value?: Record<string, number> }[] }[];
}

// Métrica online_followers do Instagram: distribuição real de quando os
// seguidores da conta costumam estar online, por hora do dia (0-23). Usada
// pra escolher o HORÁRIO real da audiência dela em vez de um horário
// genérico de mercado — o dia da semana continua vindo da pesquisa de
// mercado (DEFAULT_WEEKLY_SCHEDULE em planWeek.server.ts), porque essa
// métrica não tem granularidade por dia da semana, só por hora. Falha de
// forma esperada (não é bug) em conta nova sem seguidores/histórico
// suficiente ainda — quem chama trata "error" caindo pro horário padrão.
export async function getTopOnlineHours(
  igBusinessAccountId: string,
  accessToken: string,
  topN = 3,
): Promise<TopOnlineHoursResult> {
  try {
    const json = await graphApiRequest<OnlineFollowersResponse>(
      `/${igBusinessAccountId}/insights`,
      { metric: "online_followers", period: "lifetime", access_token: accessToken },
    );

    const hourly = json.data?.[0]?.values?.[0]?.value;
    if (!hourly || Object.keys(hourly).length === 0) {
      return { status: "error", reason: "No online-followers data available yet for this account." };
    }

    const hours = Object.entries(hourly)
      .map(([hour, count]) => ({ hour: Number(hour), count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, topN)
      .map((entry) => entry.hour);

    return { status: "success", hours };
  } catch (error) {
    return {
      status: "error",
      reason: error instanceof Error ? error.message : "Unknown error fetching online-followers insights.",
    };
  }
}
