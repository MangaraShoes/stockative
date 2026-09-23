// Helpers de fuso horário sem dependência nova — o Node já embarca ICU
// completo, então Intl.DateTimeFormat já sabe converter pra qualquer fuso
// IANA (ex.: "America/Sao_Paulo", "Europe/Brussels") sem biblioteca externa.
// Criado 12/09/2026 (Patricia: "precisamos considerar sim o fuso horario da
// loja queremos vender este app no brasil e Europa principalmente").

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
};

function partsOf(date: Date, timeZone: string, extra: Intl.DateTimeFormatOptions = {}) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    weekday: "short",
    ...extra,
  });
  return formatter.formatToParts(date).reduce<Record<string, string>>((acc, part) => {
    acc[part.type] = part.value;
    return acc;
  }, {});
}

// Quantos minutos somar a um instante UTC pra chegar ao horário de parede
// desse fuso, naquele instante específico (cobre horário de verão: o
// offset pode mudar dependendo da época do ano).
function offsetMinutesAt(date: Date, timeZone: string): number {
  const parts = partsOf(date, timeZone);
  const asUTC = Date.UTC(
    Number(parts.year), Number(parts.month) - 1, Number(parts.day),
    Number(parts.hour), Number(parts.minute), Number(parts.second),
  );
  return (asUTC - date.getTime()) / 60000;
}

// Próxima ocorrência futura de um dia da semana + horário, tratados como
// horário DE PAREDE no fuso da loja (não no fuso do servidor nem do
// navegador) — devolve o instante UTC correspondente, pronto pra gravar em
// scheduledAt. weekday: 0=domingo. Se hoje já é o dia mas a hora já passou,
// pula pra semana seguinte.
// Reagendar manualmente pra um horário que já passou nesta semana não deve
// esperar 7 dias — a lojista claramente quer "o quanto antes" (achado ao
// vivo, 23/09/2026: "se for terça as 14 e eu programar terça as 14:05 ele
// deve postar em 5 minutos... precisamos mudar esta regra" — em vez disso,
// escolher hoje/um dia já passado nesta semana empurrava silenciosamente
// pra semana seguinte). Empurrar pra semana seguinte só faz sentido pro
// planejamento automático da PRÓXIMA semana (planWeeklyContent), nunca pra
// um reagendamento manual de um post que já existe — ver rescheduleWeeklyPlanSlot.
const SOON_BUFFER_MS = 2 * 60 * 1000;

export function nextWeeklyOccurrenceInTimezone(
  weekday: number,
  hour: number,
  minute: number,
  timeZone: string,
  from: Date = new Date(),
  // "next-week" (padrão, usado no planejamento automático): se o horário já
  // passou nesta semana, pula pra semana seguinte. "soon": em vez de pular
  // uma semana inteira, agenda pra daqui a pouco (usado no reagendamento
  // manual, onde a lojista quer o post o mais breve possível, não daqui a 7 dias).
  pastBehavior: "next-week" | "soon" = "next-week",
): Date {
  const todayParts = partsOf(from, timeZone);
  const todayWeekday = WEEKDAY_INDEX[todayParts.weekday] ?? 0;
  const daysUntil = (weekday - todayWeekday + 7) % 7;

  // Palpite tratando os componentes como se já fossem UTC — depois
  // corrigido pelo offset real do fuso NAQUELE instante (o offset pode ser
  // diferente do offset de `from`, se houver uma troca de horário de verão
  // entre os dois — por isso recalcula a partir da data-calendário, nunca
  // soma milissegundos a um instante já corrigido).
  const resolve = (days: number): Date => {
    const guessDay = Number(todayParts.day) + days;
    const guess = new Date(
      Date.UTC(Number(todayParts.year), Number(todayParts.month) - 1, guessDay, hour, minute, 0),
    );
    return new Date(guess.getTime() - offsetMinutesAt(guess, timeZone) * 60000);
  };

  let result = resolve(daysUntil);
  // Bug corrigido em 12/09/2026 (achado de revisão externa, reproduzido:
  // "next Sunday 12:00" em Bruxelas pedido depois do meio-dia de 18/10
  // devolvia 11:00 em 25/10, dia da troca pro horário de inverno europeu) —
  // a versão antiga somava 7×24h em milissegundos ao resultado já corrigido,
  // reaplicando o offset de HOJE em vez de recalcular o offset da data de
  // destino. Resolver de novo a partir da data-calendário (daysUntil + 7)
  // corrige o offset certo pra semana seguinte.
  if (result <= from) {
    result = pastBehavior === "soon" ? new Date(from.getTime() + SOON_BUFFER_MS) : resolve(daysUntil + 7);
  }
  return result;
}

// Dia da semana (0=domingo) e "HH:MM" de um instante, na perspectiva do
// fuso da loja — usado pra pré-preencher os seletores de dia/horário com o
// valor certo, em vez do fuso de quem está com o navegador aberto.
export function weekdayInTimezone(date: Date, timeZone: string): number {
  const parts = partsOf(date, timeZone, { weekday: "short" });
  return WEEKDAY_INDEX[parts.weekday] ?? 0;
}

export function timeInTimezone(date: Date, timeZone: string): string {
  const parts = partsOf(date, timeZone);
  return `${parts.hour}:${parts.minute}`;
}
