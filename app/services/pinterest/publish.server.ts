import { pinterestApiRequest } from "./api.server";

export interface PinterestTarget {
  accessToken: string;
}

// Limites reais da API de Pins (v5) — title e description acima disso são
// rejeitados pela Graph API do Pinterest.
const TITLE_MAX_LENGTH = 100;
const DESCRIPTION_MAX_LENGTH = 500;

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1).trimEnd()}…`;
}

// Pinterest não tem conceito de carrossel como o Instagram — um Pin é
// sempre uma imagem só, por isso recebe direto a imageUrl (a hero do post),
// nunca uma lista.
export async function createPin(
  target: PinterestTarget,
  params: {
    boardId: string;
    imageUrl: string;
    title: string;
    description: string;
    link?: string | null;
  },
): Promise<string> {
  const json = await pinterestApiRequest<{ id: string }>("/pins", target.accessToken, {
    method: "POST",
    body: {
      board_id: params.boardId,
      media_source: { source_type: "image_url", url: params.imageUrl, is_standard: true },
      title: truncate(params.title, TITLE_MAX_LENGTH),
      description: truncate(params.description, DESCRIPTION_MAX_LENGTH),
      ...(params.link ? { link: params.link } : {}),
    },
  });
  return json.id;
}
