// Fatos de origem e autoria por linha de produto (Patricia, 04/11/2026). A
// descrição da marca é uma só, mas o catálogo pode não ser: a da Mangará dizia
// "each pair is handcrafted in Brazil" e a IA levou isso para as bolsas, que
// são feitas na Itália e não foram desenhadas pela fundadora (post real da
// Stella, 28/10/2026). Cada produto só vê os fatos da própria linha, casada
// pelo productType da Shopify. Loja sem linhas salvas segue como antes.
export interface ProductLine {
  name: string;
  productTypes: string[];
  facts: string;
  founderDesigned: boolean;
}

export interface ProductLineContext {
  configured: boolean;
  line: ProductLine | null;
}

export function parseProductLines(raw: unknown): ProductLine[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const { name, productTypes, facts, founderDesigned } = entry as Record<string, unknown>;
    const types = Array.isArray(productTypes)
      ? productTypes.map((type) => String(type).trim()).filter(Boolean)
      : [];
    const factsText = typeof facts === "string" ? facts.trim() : "";
    if (types.length === 0 || !factsText) return [];
    return [
      {
        name: typeof name === "string" && name.trim() ? name.trim() : types[0],
        productTypes: types,
        facts: factsText,
        founderDesigned: founderDesigned === true,
      },
    ];
  });
}

export function resolveProductLine(raw: unknown, productType: string | null): ProductLineContext {
  const lines = parseProductLines(raw);
  const type = productType?.trim().toLowerCase();
  const line = type
    ? lines.find((candidate) => candidate.productTypes.some((t) => t.toLowerCase() === type)) ?? null
    : null;
  return { configured: lines.length > 0, line };
}

// Texto dos prompts. Vazio quando a loja não configurou linhas.
export function describeProductLine({ configured, line }: ProductLineContext): string {
  if (!configured) return "";
  if (!line) {
    return "Origin and design facts for this product: NONE on file. Never state where it is made, where its materials come from, or who designed it, unless the product title or description says so. Anything about origin, manufacture or design in the brand description or content pillar does not apply to this product.";
  }
  const founderRule = line.founderDesigned
    ? ""
    : " The founder did not design this product: never say or imply that she or he designed, signed, chose or personally made it, and never tie it to the founder's biography or roots.";
  return `Facts for this product line (${line.name}), the ONLY source for where it is made, where its materials come from and who designed it: ${line.facts}${founderRule} Anything about origin, manufacture or design in the brand description, content pillar or creative brief that is not stated here does not apply to this product, and these facts override them.`;
}
