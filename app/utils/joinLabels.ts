// "a, b and c" — fica fora de socialReminders.server.ts porque a Home usa no
// próprio componente (um módulo .server não pode chegar ao navegador).
export function joinLabels(labels: string[]): string {
  if (labels.length <= 1) return labels.join("");
  return `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`;
}
