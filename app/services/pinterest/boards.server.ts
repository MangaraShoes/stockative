import prisma from "../../db.server";
import { pinterestApiRequest } from "./api.server";

export interface PinterestTarget {
  accessToken: string;
}

function formatBoardName(category: string): string {
  return category
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

// Um board por categoria de produto — pedido direto da Patricia, 11/09/2026:
// "cria um app automatico separando todos os posts por categorias dentro do
// pinterest, cada categoria de produto organizado dentro do seu proprio
// board". A categoria vem de ProductCache.productType (ex.: "sandals",
// "loafers"). Guarda o board criado em PinterestBoard pra reaproveitar da
// próxima vez que a mesma categoria publicar, sem criar board duplicado.
export async function getOrCreateBoardForCategory(
  shopId: string,
  target: PinterestTarget,
  category: string,
): Promise<string> {
  const existing = await prisma.pinterestBoard.findUnique({
    where: { shopId_category: { shopId, category } },
  });
  if (existing) return existing.pinterestBoardId;

  const boardName = formatBoardName(category);

  // Confere se já existe um board com esse nome na conta antes de criar um
  // novo — evita duplicar se a lojista já tinha um board manual com esse
  // nome antes de conectar o app.
  const existingBoards = await pinterestApiRequest<{
    items: { id: string; name: string }[];
  }>("/boards?page_size=100", target.accessToken);

  const matchingBoard = existingBoards.items?.find(
    (board) => board.name.trim().toLowerCase() === boardName.toLowerCase(),
  );

  const pinterestBoardId = matchingBoard
    ? matchingBoard.id
    : (
        await pinterestApiRequest<{ id: string }>("/boards", target.accessToken, {
          method: "POST",
          body: { name: boardName, privacy: "PUBLIC" },
        })
      ).id;

  await prisma.pinterestBoard.upsert({
    where: { shopId_category: { shopId, category } },
    create: { shopId, category, pinterestBoardId, name: boardName },
    update: { pinterestBoardId, name: boardName },
  });

  return pinterestBoardId;
}
